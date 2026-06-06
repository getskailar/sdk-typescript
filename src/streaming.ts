/**
 * A dependency-free Server-Sent Events parser and the {@link ChatCompletionStream}
 * wrapper that exposes a chat completion SSE response as an abortable async iterable.
 *
 * @packageDocumentation
 */

import { SkailarAPIError, SkailarConnectionError, parseErrorBody } from "./errors";
import type { ChatCompletionChunk } from "./types/chat";

/**
 * Incrementally decode a byte stream into SSE `data:` payload strings, in
 * arrival order, excluding the terminal `[DONE]` sentinel.
 *
 * Implements just the slice of the SSE grammar the gateway emits: UTF-8 `data:`
 * lines separated by `\n`, events delimited by blank lines, terminated by a
 * literal `data: [DONE]`. A partial line left in the buffer across reads is
 * preserved and completed by the next chunk. Comment lines (`:` prefix) and
 * non-`data:` fields are ignored. Yielding stops at `[DONE]`; reaching
 * end-of-stream without `[DONE]` simply ends the generator.
 *
 * On any exit — normal completion, `[DONE]`, an error, or the consumer
 * abandoning the `for await` early — the reader is cancelled before its lock is
 * released, so the underlying fetch connection is torn down instead of leaving
 * bytes streaming from the network.
 *
 * @param stream - The response body as a stream of UTF-8 encoded bytes.
 * @param signal - Optional abort signal; aborting rejects the iteration.
 * @returns An async generator yielding the raw string after each `data:` field.
 * @throws {@link SkailarConnectionError} If the underlying read is aborted or fails.
 */
export async function* parseSSE(
  stream: ReadableStream<Uint8Array>,
  signal?: AbortSignal,
): AsyncGenerator<string, void, unknown> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      if (signal?.aborted) {
        throw new SkailarConnectionError({ message: "Stream aborted", cause: signal.reason });
      }

      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      let newlineIndex: number;
      while ((newlineIndex = buffer.indexOf("\n")) !== -1) {
        const rawLine = buffer.slice(0, newlineIndex);
        buffer = buffer.slice(newlineIndex + 1);
        const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;

        if (line === "" || line.startsWith(":")) continue;
        if (!line.startsWith("data:")) continue;

        const data = line.slice(5).trimStart();
        if (data === "[DONE]") return;
        yield data;
      }
    }

    const tail = buffer.trim();
    if (tail.startsWith("data:")) {
      const data = tail.slice(5).trimStart();
      if (data !== "[DONE]" && data !== "") yield data;
    }
  } catch (err) {
    if (err instanceof SkailarConnectionError) throw err;
    throw new SkailarConnectionError({ message: "Stream read failed", cause: err });
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

/**
 * An abortable async iterable of {@link ChatCompletionChunk} values, returned by
 * `chat.completions.create({ stream: true })`.
 *
 * Iterate it with `for await`; each iteration yields one decoded chunk. Mirrors
 * the ergonomics of `openai-node`'s stream, including the {@link ChatCompletionStream.controller}
 * for cancellation.
 *
 * @example
 * ```ts
 * const stream = await client.chat.completions.create({
 *   model: "gemini-2.5-flash-lite",
 *   messages: [{ role: "user", content: "hi" }],
 *   stream: true,
 * });
 * for await (const chunk of stream) {
 *   process.stdout.write(chunk.choices[0]?.delta?.content ?? "");
 * }
 * ```
 */
export class ChatCompletionStream implements AsyncIterable<ChatCompletionChunk> {
  /**
   * The {@link AbortController} governing the underlying HTTP request. Call
   * `stream.controller.abort()` to cancel an in-flight stream; the active
   * `for await` loop then terminates promptly.
   */
  readonly controller: AbortController;

  /** The raw SSE byte stream backing this iterator. */
  private readonly body: ReadableStream<Uint8Array>;

  /**
   * @param body - The response body stream of SSE bytes.
   * @param controller - The abort controller tied to the originating request.
   */
  constructor(body: ReadableStream<Uint8Array>, controller: AbortController) {
    this.body = body;
    this.controller = controller;
  }

  /**
   * Decode the SSE stream into typed chunks.
   *
   * Each `data:` payload is `JSON.parse`d. If a payload carries an `error` field
   * (the gateway's in-band failure signal), iteration throws the corresponding
   * {@link SkailarAPIError} instead of yielding. Malformed JSON payloads are
   * skipped defensively.
   *
   * @returns An async iterator over {@link ChatCompletionChunk} values.
   * @throws {@link SkailarAPIError} When the stream delivers an in-band error event.
   * @throws {@link SkailarConnectionError} When the stream is aborted or read fails.
   */
  async *[Symbol.asyncIterator](): AsyncIterator<ChatCompletionChunk> {
    for await (const data of parseSSE(this.body, this.controller.signal)) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(data);
      } catch {
        continue;
      }

      if (parsed !== null && typeof parsed === "object" && "error" in parsed) {
        const { code, message } = parseErrorBody(parsed);
        throw SkailarAPIError.from(
          500,
          { code, message: message ?? "Streaming error" },
          undefined,
          parsed,
        );
      }

      yield parsed as ChatCompletionChunk;
    }
  }
}
