/**
 * The chat resource, exposing `client.chat.completions.create(...)` with the
 * same call shape as `openai`'s chat completions.
 *
 * @packageDocumentation
 */

import type { RequestOptions, Skailar } from "../client";
import type { ChatCompletionStream } from "../streaming";
import type {
  ChatCompletion,
  ChatCompletionRequest,
} from "../types/chat";

/** A chat completion request that explicitly opts into streaming. */
interface StreamingRequest extends ChatCompletionRequest {
  stream: true;
}

/** A chat completion request that does not stream. */
interface NonStreamingRequest extends ChatCompletionRequest {
  stream?: false;
}

/**
 * The `completions` sub-namespace of the chat resource. Holds
 * {@link ChatCompletions.create}, whose return type is narrowed by the `stream`
 * field of the request via overloads.
 */
export class ChatCompletions {
  /** The owning client used to dispatch requests. */
  private readonly client: Skailar;

  /** @param client - The owning {@link Skailar} client. */
  constructor(client: Skailar) {
    this.client = client;
  }

  /**
   * Create a buffered (non-streamed) chat completion.
   *
   * @param body - The request with `stream` omitted or `false`.
   * @param options - Optional per-call signal, timeout and headers.
   * @returns The fully-formed {@link ChatCompletion}.
   */
  create(body: NonStreamingRequest, options?: RequestOptions): Promise<ChatCompletion>;
  /**
   * Create a streamed chat completion.
   *
   * @param body - The request with `stream: true`.
   * @param options - Optional per-call signal, timeout and headers. The stream
   * is also cancellable via its `.controller`.
   * @returns A {@link ChatCompletionStream} async-iterable of chunks, exposing
   * `.controller` for cancellation.
   */
  create(body: StreamingRequest, options?: RequestOptions): Promise<ChatCompletionStream>;
  /**
   * Create a chat completion whose mode is chosen at runtime. Use this form when
   * `stream` is a non-literal `boolean` (e.g. `stream: shouldStream`), where the
   * concrete return type cannot be known at compile time; narrow the result with
   * `instanceof ChatCompletionStream` or by checking the `stream` flag yourself.
   *
   * @param body - The request with a dynamic `stream` boolean.
   * @param options - Optional per-call signal, timeout and headers.
   * @returns Either a {@link ChatCompletion} or a {@link ChatCompletionStream}.
   */
  create(
    body: ChatCompletionRequest & { stream?: boolean },
    options?: RequestOptions,
  ): Promise<ChatCompletion | ChatCompletionStream>;
  /**
   * Implementation backing the public overloads.
   *
   * @param body - The chat completion request.
   * @param options - Optional per-call signal, timeout and headers.
   * @returns Either a {@link ChatCompletion} or a {@link ChatCompletionStream}
   * depending on `body.stream`.
   * @throws {@link SkailarBadRequestError} On HTTP 400 (malformed request).
   * @throws {@link SkailarAuthError} On HTTP 401 (bad key).
   * @throws {@link SkailarRateLimitError} On HTTP 429 (after exhausting retries).
   * @throws {@link SkailarUpstreamError} On HTTP 5xx (after exhausting retries).
   * @throws {@link SkailarConnectionError} On network failure, timeout or abort.
   */
  create(
    body: ChatCompletionRequest,
    options?: RequestOptions,
  ): Promise<ChatCompletion> | Promise<ChatCompletionStream> {
    if (body.stream === true) {
      return this.client.request({
        method: "POST",
        path: "/v1/chat/completions",
        body,
        expect: "stream",
        signal: options?.signal,
        timeout: options?.timeout,
        headers: options?.headers,
      });
    }
    return this.client.request<ChatCompletion>({
      method: "POST",
      path: "/v1/chat/completions",
      body,
      expect: "json",
      signal: options?.signal,
      timeout: options?.timeout,
      headers: options?.headers,
    });
  }
}

/** The chat resource root, mirroring `openai`'s `client.chat`. */
export class ChatResource {
  /** The chat completions namespace. */
  readonly completions: ChatCompletions;

  /** @param client - The owning {@link Skailar} client. */
  constructor(client: Skailar) {
    this.completions = new ChatCompletions(client);
  }
}
