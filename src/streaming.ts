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
 * lines terminated by any of `\n`, `\r\n` or `\r` (per the SSE spec), events
 * delimited by blank lines, terminated by a literal `data: [DONE]`. A partial
 * line left in the buffer across reads is preserved and completed by the next
 * chunk. Comment lines (`:` prefix) and non-`data:` fields are ignored. Yielding
 * stops at `[DONE]`; reaching end-of-stream without `[DONE]` simply ends the generator.
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

  /**
   * Extract the next complete line from `buffer`, consuming its terminator.
   * Recognizes `\n`, `\r\n` and a lone `\r` (the three SSE line terminators).
   * Returns `null` when no terminated line is buffered yet — including the case
   * of a trailing lone `\r` that might still be the start of a `\r\n` split
   * across reads, which is left buffered until the next chunk resolves it.
   *
   * @returns The line without its terminator, or `null` if none is complete.
   */
  function nextLine(): string | null {
    let i = -1;
    for (let j = 0; j < buffer.length; j++) {
      const c = buffer[j];
      if (c === "\n" || c === "\r") {
        i = j;
        break;
      }
    }
    if (i === -1) return null;
    const line = buffer.slice(0, i);
    if (buffer[i] === "\r") {
      if (i === buffer.length - 1) return null; // maybe `\r\n` split across reads
      buffer = buffer.slice(i + (buffer[i + 1] === "\n" ? 2 : 1));
    } else {
      buffer = buffer.slice(i + 1);
    }
    return line;
  }

  try {
    while (true) {
      if (signal?.aborted) {
        throw new SkailarConnectionError({ message: "Stream aborted", cause: signal.reason });
      }

      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      let line: string | null;
      while ((line = nextLine()) !== null) {
        if (line === "" || line.startsWith(":")) continue;
        if (!line.startsWith("data:")) continue;

        const data = line.slice(5).trimStart();
        if (data === "[DONE]") return;
        yield data;
      }
    }

    const tail = buffer.replace(/[\r\n]+$/, "");
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
   * Decode the SSE byte stream into typed chunks.
   *
   * Each `data:` payload is `JSON.parse`d. If a payload carries an `error` field
   * (the gateway's in-band failure signal), iteration throws the corresponding
   * {@link SkailarAPIError} instead of yielding. A payload that is not valid JSON
   * (e.g. a plain-text error injected by an intermediary) throws a
   * {@link SkailarConnectionError} rather than being dropped, so a malformed
   * stream cannot truncate the response silently.
   *
   * @returns An async generator over {@link ChatCompletionChunk} values.
   * @throws {@link SkailarAPIError} When the stream delivers an in-band error event.
   * @throws {@link SkailarConnectionError} When a payload is malformed, or the
   * stream is aborted or fails to read.
   */
  private async *decode(): AsyncGenerator<ChatCompletionChunk, void, unknown> {
    for await (const data of parseSSE(this.body, this.controller.signal)) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(data);
      } catch {
        // A non-JSON data payload (e.g. plain-text error from an intermediary) is
        // surfaced, not dropped, so a malformed stream cannot truncate silently.
        throw new SkailarConnectionError({
          message: `Malformed streaming event (not JSON): ${data.slice(0, 200)}`,
        });
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

  /**
   * Iterate the decoded chunks. Abandoning the iteration early (a `break` or
   * `return` inside a `for await`) invokes the returned iterator's `return()`,
   * which aborts {@link ChatCompletionStream.controller} so the underlying fetch
   * request is cancelled — not merely the body reader — and then runs the
   * generator's own cleanup ({@link parseSSE}'s `finally`: reader cancel +
   * lock release). Normal completion and thrown errors are unaffected.
   *
   * @returns An async iterator over {@link ChatCompletionChunk} values.
   */
  [Symbol.asyncIterator](): AsyncIterator<ChatCompletionChunk> {
    const inner = this.decode();
    const controller = this.controller;
    return {
      next: () => inner.next(),
      async return(value?: unknown): Promise<IteratorResult<ChatCompletionChunk>> {
        controller.abort();
        if (inner.return) await inner.return(value as undefined);
        return { done: true, value: undefined };
      },
      throw: (err) => (inner.throw ? inner.throw(err) : Promise.reject(err)),
    };
  }
}
