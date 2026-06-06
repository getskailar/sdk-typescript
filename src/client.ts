/**
 * The {@link Skailar} client: configuration, the shared fetch dispatch pipeline
 * (timeout, retry with backoff, error mapping) and the resource namespaces hung
 * off it.
 *
 * @packageDocumentation
 */

import {
  SkailarConnectionError,
  SkailarAPIError,
  SkailarRateLimitError,
  parseErrorBody,
} from "./errors";
import { ChatCompletionStream } from "./streaming";
import { ChatResource } from "./resources/chat";
import { ModelsResource } from "./resources/models";
import { ImagesResource } from "./resources/images";
import { AudioResource } from "./resources/audio";
import { UploadsResource } from "./resources/uploads";
import type { PingKeyResponse } from "./types/index";

/**
 * Configuration accepted by the {@link Skailar} constructor. Every field is
 * optional; omitted fields fall back to environment variables or library
 * defaults as documented per property.
 */
export interface SkailarOptions {
  /**
   * Skailar API key of the form `skl_live_<43 url-safe base64 chars>`. Defaults
   * to `process.env.SKAILAR_API_KEY`; if neither is provided the constructor throws.
   */
  apiKey?: string;
  /**
   * Base URL of the gateway, without a trailing `/v1` (default
   * `"https://api.skailar.com"`). The `/v1/...` path is appended by the SDK.
   * Point this at `http://localhost:8080` for a local gateway.
   */
  baseURL?: string;
  /**
   * Per-request timeout in milliseconds (default `60000`). Applies to each
   * attempt independently; a timed-out attempt becomes a
   * {@link SkailarConnectionError} and is eligible for retry.
   */
  timeout?: number;
  /**
   * Maximum automatic retries for transient failures (default `2`). Retries
   * apply only to HTTP 429, HTTP 5xx, and connection errors; non-429 4xx
   * responses are never retried.
   */
  maxRetries?: number;
  /**
   * Custom `fetch` implementation, primarily for testing (default global
   * `fetch`). No binding is applied; pass an already-bound function if your
   * implementation requires a specific receiver.
   */
  fetch?: typeof fetch;
  /**
   * Headers merged into every request. The SDK's own `Authorization`,
   * `Content-Type` and `Accept`, plus explicit per-call headers, take precedence.
   */
  defaultHeaders?: Record<string, string>;
}

/**
 * Per-call request options accepted as the trailing argument of every resource
 * method (e.g. `chat.completions.create(body, options)`). Mirrors the
 * `openai-node` convention so the wire body stays separate from transport
 * concerns. Every field is optional and overrides the client-level default for
 * this one call.
 */
export interface RequestOptions {
  /**
   * Signal to cancel this call. Aborting before the response arrives rejects the
   * call with a {@link SkailarConnectionError}; for streaming/audio bodies,
   * aborting mid-transfer tears down the connection.
   */
  signal?: AbortSignal;
  /**
   * Per-call timeout in milliseconds, overriding {@link SkailarOptions.timeout}
   * for this request only.
   */
  timeout?: number;
  /** Extra headers merged into this request, overriding client defaults. */
  headers?: Record<string, string>;
}

/** Internal description of a single HTTP request to dispatch. */
interface InternalRequest {
  method: "GET" | "POST";
  /** Path beginning with `/v1/...`, relative to {@link SkailarOptions.baseURL}. */
  path: string;
  /** Optional JSON body; serialized with `JSON.stringify`. */
  body?: unknown;
  /** Extra headers for this request only. */
  headers?: Record<string, string>;
  /** Expected response handling: parsed JSON, raw `Response`, or SSE stream. */
  expect: "json" | "response" | "stream";
  /**
   * External abort signal composed with the timeout. Used for streaming, where
   * the caller-visible {@link ChatCompletionStream.controller} drives cancellation.
   */
  signal?: AbortSignal;
  /** Per-call timeout override in ms; falls back to {@link Skailar.timeout}. */
  timeout?: number;
}

/**
 * Sleep for the given duration, rejecting early if the signal aborts.
 *
 * @param ms - Milliseconds to wait.
 * @param signal - Optional signal that, when aborted, rejects the sleep.
 * @returns A promise resolving after `ms`, or rejecting on abort.
 */
function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new SkailarConnectionError({ message: "Aborted", cause: signal.reason }));
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new SkailarConnectionError({ message: "Aborted", cause: signal?.reason }));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/**
 * Parse a `Retry-After` header value into seconds — the header's native unit
 * and the unit exposed on {@link SkailarRateLimitError.retryAfter}. Call sites
 * that need a millisecond delay multiply by 1000 themselves.
 *
 * @param header - The raw header value, a number of seconds or an HTTP date.
 * @returns The delay in seconds, or `undefined` if absent/unparseable.
 */
function parseRetryAfter(header: string | null): number | undefined {
  if (!header) return undefined;
  const seconds = Number(header);
  if (Number.isFinite(seconds)) return Math.max(0, seconds);
  const date = Date.parse(header);
  if (Number.isFinite(date)) return Math.max(0, Math.ceil((date - Date.now()) / 1000));
  return undefined;
}

/**
 * Wrap a byte stream so `onDone` runs exactly once when it terminates — whether
 * it closes normally, errors, or is cancelled by the consumer. Used to detach
 * the external-abort listener for `response`/`stream` results whose body outlives
 * the {@link Skailar.request} call, so a long-lived caller `AbortSignal` does not
 * accumulate listeners across requests.
 *
 * @param source - The original response body stream.
 * @param onDone - Idempotent cleanup to run on terminal state.
 * @returns A stream that mirrors `source` and triggers `onDone` when finished.
 */
function withCleanup(
  source: ReadableStream<Uint8Array>,
  onDone: () => void,
): ReadableStream<Uint8Array> {
  let done = false;
  const finish = () => {
    if (done) return;
    done = true;
    onDone();
  };
  const reader = source.getReader();
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { done: streamDone, value } = await reader.read();
        if (streamDone) {
          finish();
          controller.close();
          return;
        }
        controller.enqueue(value);
      } catch (err) {
        finish();
        controller.error(err);
      }
    },
    async cancel(reason) {
      finish();
      await reader.cancel(reason);
    },
  });
}

/**
 * Read the request-correlation id from a response's headers, checking the common
 * header spellings so the id is captured regardless of casing convention.
 *
 * @param headers - The response headers.
 * @returns The first present correlation id, or `undefined`.
 */
function extractRequestId(headers: Headers): string | undefined {
  return (
    headers.get("x-request-id") ??
    headers.get("x-skailar-request-id") ??
    headers.get("request-id") ??
    undefined
  );
}

/**
 * The official Skailar API client. Construct once and reuse. Resource namespaces
 * ({@link Skailar.chat}, {@link Skailar.models}, etc.) provide the
 * OpenAI-compatible and Skailar-native operations. All network access flows
 * through {@link Skailar.request}, which centralizes authentication, timeouts,
 * retries and error mapping.
 *
 * @example
 * ```ts
 * import Skailar from "@skailar-ai/sdk";
 * const client = new Skailar({ apiKey: "skl_live_..." });
 * const res = await client.chat.completions.create({
 *   model: "claude-sonnet-4-6",
 *   messages: [{ role: "user", content: "Hello!" }],
 * });
 * console.log(res.choices[0]?.message.content);
 * ```
 */
export class Skailar {
  /** Resolved API key sent as the bearer token. */
  readonly apiKey: string;
  /** Resolved base URL with any trailing slash removed. */
  readonly baseURL: string;
  /** Resolved per-attempt timeout in milliseconds. */
  readonly timeout: number;
  /** Resolved maximum retry count. */
  readonly maxRetries: number;
  /** Default headers merged into every request. */
  readonly defaultHeaders: Record<string, string>;

  /** The `fetch` implementation used for all requests. */
  private readonly fetchImpl: typeof fetch;

  /** Chat completions (OpenAI-compatible). */
  readonly chat: ChatResource;
  /** Model discovery. */
  readonly models: ModelsResource;
  /** Image generation. */
  readonly images: ImagesResource;
  /** Speech synthesis and transcription. */
  readonly audio: AudioResource;
  /** Direct uploads to Skailar storage. */
  readonly uploads: UploadsResource;

  /**
   * @param options - Client configuration; see {@link SkailarOptions}.
   * @throws If no API key is provided and `SKAILAR_API_KEY` is unset.
   */
  constructor(options: SkailarOptions = {}) {
    const env =
      typeof process !== "undefined" && process.env ? process.env["SKAILAR_API_KEY"] : undefined;
    const apiKey = options.apiKey ?? env;
    if (!apiKey) {
      throw new Error(
        "Missing Skailar API key. Pass { apiKey } or set the SKAILAR_API_KEY environment variable.",
      );
    }

    this.apiKey = apiKey;
    this.baseURL = (options.baseURL ?? "https://api.skailar.com").replace(/\/+$/, "");
    this.timeout = options.timeout ?? 60_000;
    this.maxRetries = options.maxRetries ?? 2;
    this.defaultHeaders = options.defaultHeaders ?? {};
    this.fetchImpl = options.fetch ?? globalThis.fetch;

    if (typeof this.fetchImpl !== "function") {
      throw new Error("No fetch implementation available; pass { fetch } explicitly.");
    }

    this.chat = new ChatResource(this);
    this.models = new ModelsResource(this);
    this.images = new ImagesResource(this);
    this.audio = new AudioResource(this);
    this.uploads = new UploadsResource(this);
  }

  /**
   * Verify the configured API key against `GET /v1/ping-key`.
   *
   * @param options - Optional per-call signal, timeout and headers.
   * @returns The `{ status, user_id }` payload when the key is valid.
   * @throws {@link SkailarAuthError} If the key is missing, invalid or revoked.
   */
  ping(options?: RequestOptions): Promise<PingKeyResponse> {
    return this.request<PingKeyResponse>({
      method: "GET",
      path: "/v1/ping-key",
      expect: "json",
      signal: options?.signal,
      timeout: options?.timeout,
      headers: options?.headers,
    });
  }

  /**
   * Dispatch a request expecting a JSON body, with retries.
   *
   * @typeParam T - The expected shape of the parsed JSON response.
   * @param options - The request description.
   * @returns The parsed JSON response body typed as `T`.
   */
  request<T>(options: InternalRequest & { expect: "json" }): Promise<T>;
  /**
   * Dispatch a request expecting the raw {@link Response}, with retries.
   *
   * @param options - The request description.
   * @returns The successful `Response`, body unread (e.g. for audio streams).
   */
  request(options: InternalRequest & { expect: "response" }): Promise<Response>;
  /**
   * Dispatch a streaming request, returning a chat completion stream.
   *
   * @param options - The request description with `expect: "stream"`.
   * @returns A {@link ChatCompletionStream} over the SSE response.
   */
  request(options: InternalRequest & { expect: "stream" }): Promise<ChatCompletionStream>;
  /**
   * Core dispatch implementation shared by all resources.
   *
   * Applies, per attempt: header assembly with bearer auth, a timeout-derived
   * {@link AbortSignal} composed with any caller signal, execution of
   * {@link SkailarOptions.fetch}, and error mapping. Retries HTTP 429, HTTP 5xx
   * and transient connection failures up to {@link Skailar.maxRetries}, backing
   * off with full-jitter exponential delay and honoring a server `Retry-After`
   * when present. Non-429 4xx responses fail fast.
   *
   * Transport failures are reported as {@link SkailarConnectionError} with a
   * message distinguishing three causes: an external `signal` abort
   * (non-retryable), an internal timeout once {@link Skailar.timeout} elapses
   * (retryable), and a generic network failure (retryable).
   *
   * @param options - The request description.
   * @returns The parsed JSON, raw `Response`, or {@link ChatCompletionStream}
   * depending on `options.expect`.
   */
  async request(
    options: InternalRequest,
  ): Promise<unknown> {
    const url = `${this.baseURL}${options.path}`;
    const isStream = options.expect === "stream";
    const timeoutMs = options.timeout ?? this.timeout;
    let attempt = 0;

    while (true) {
      const controller = new AbortController();
      const onExternalAbort = () => controller.abort(options.signal?.reason);
      if (options.signal) {
        if (options.signal.aborted) controller.abort(options.signal.reason);
        else options.signal.addEventListener("abort", onExternalAbort);
      }
      const detachExternal = () =>
        options.signal?.removeEventListener("abort", onExternalAbort);
      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        controller.abort(new Error("Request timed out"));
      }, timeoutMs);

      let response: Response;
      try {
        response = await this.fetchImpl(url, {
          method: options.method,
          headers: this.buildHeaders(options),
          body: options.body === undefined ? undefined : JSON.stringify(options.body),
          signal: controller.signal,
        });
      } catch (err) {
        clearTimeout(timer);
        detachExternal();
        const externallyAborted = options.signal?.aborted ?? false;
        const connErr = new SkailarConnectionError({
          message: externallyAborted
            ? "Request aborted"
            : timedOut
              ? `Request timed out after ${timeoutMs}ms`
              : "Network request to the Skailar API failed",
          cause: err,
        });
        if (externallyAborted || !this.shouldRetry(attempt)) throw connErr;
        attempt += 1;
        await delay(this.backoff(attempt), options.signal);
        continue;
      }

      clearTimeout(timer);

      if (!response.ok) {
        detachExternal();
        const apiError = await this.toApiError(response);
        const retryAfterMs =
          apiError instanceof SkailarRateLimitError && apiError.retryAfter !== undefined
            ? apiError.retryAfter * 1000
            : undefined;
        if (this.isRetryableStatus(response.status) && this.shouldRetry(attempt)) {
          attempt += 1;
          await delay(retryAfterMs ?? this.backoff(attempt), options.signal);
          continue;
        }
        throw apiError;
      }

      if (isStream || options.expect === "response") {
        if (!response.body) {
          detachExternal();
          throw new SkailarConnectionError({
            message: isStream ? "Streaming response had no body" : "Response had no body",
          });
        }
        const body = withCleanup(response.body, detachExternal);
        if (isStream) return new ChatCompletionStream(body, controller);
        return new Response(body, {
          status: response.status,
          statusText: response.statusText,
          headers: response.headers,
        });
      }

      detachExternal();
      return (await response.json()) as unknown;
    }
  }

  /**
   * Assemble the outgoing header set for a request, applying defaults, auth,
   * content-type and accept in precedence order.
   *
   * @param options - The request description.
   * @returns The header record to send.
   */
  private buildHeaders(options: InternalRequest): Record<string, string> {
    const headers: Record<string, string> = {
      ...this.defaultHeaders,
      Authorization: `Bearer ${this.apiKey}`,
      Accept: options.expect === "stream" ? "text/event-stream" : "application/json",
    };
    if (options.body !== undefined) headers["Content-Type"] = "application/json";
    if (options.headers) Object.assign(headers, options.headers);
    return headers;
  }

  /**
   * Convert a non-2xx {@link Response} into the most specific
   * {@link SkailarAPIError} subclass. Reads the body once, attempting JSON first
   * and falling back to raw text, then defers classification to
   * {@link SkailarAPIError.from}.
   *
   * @param response - The failed HTTP response.
   * @returns The mapped error.
   */
  private async toApiError(response: Response): Promise<SkailarAPIError> {
    const text = await response.text().catch(() => "");
    let raw: unknown = text;
    try {
      raw = text ? JSON.parse(text) : undefined;
    } catch {
      raw = text;
    }
    const parsed = parseErrorBody(raw);
    const requestId = extractRequestId(response.headers);
    const retryAfter =
      response.status === 429 ? parseRetryAfter(response.headers.get("retry-after")) : undefined;
    return SkailarAPIError.from(response.status, parsed, requestId, raw, retryAfter);
  }

  /**
   * Whether a status code is eligible for automatic retry (429 and any 5xx).
   *
   * @param status - The HTTP status code.
   * @returns `true` if retryable.
   */
  private isRetryableStatus(status: number): boolean {
    return status === 429 || status >= 500;
  }

  /**
   * Whether another attempt remains within the retry budget.
   *
   * @param attempt - The count of attempts already made (before increment).
   * @returns `true` if a retry is permitted.
   */
  private shouldRetry(attempt: number): boolean {
    return attempt < this.maxRetries;
  }

  /**
   * Compute a full-jitter exponential backoff delay: a random value in
   * `[0, min(cap, base * 2^attempt))`, capped at 8000ms. Jitter spreads retries
   * from many clients to avoid synchronized thundering-herd load on the gateway.
   *
   * @param attempt - The retry number, starting at 1 for the first retry.
   * @returns A randomized delay in milliseconds.
   */
  private backoff(attempt: number): number {
    const base = 500;
    const cap = 8000;
    const exponential = Math.min(cap, base * 2 ** attempt);
    return Math.random() * exponential;
  }
}
