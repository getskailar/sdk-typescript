/**
 * The typed error hierarchy thrown by the Skailar SDK.
 *
 * Every failure surfaces as a subclass of {@link SkailarError}, so a single
 * `catch (err) { if (err instanceof SkailarError) ... }` covers the whole SDK.
 * Transport/network failures become {@link SkailarConnectionError}; any non-2xx
 * HTTP response becomes the most specific {@link SkailarAPIError} subclass for
 * its status code.
 *
 * @packageDocumentation
 */

/**
 * Normalized shape extracted from a Skailar error response body.
 *
 * The gateway has been observed to return a flat body
 * (`{ "error": "invalid_api_key", "message": "..." }`) and, inside streams, a
 * nested body (`{ "error": { "type": "...", "message": "..." } }`).
 * {@link parseErrorBody} collapses both into this structure.
 */
export interface ParsedErrorBody {
  /** Machine-readable error code, e.g. `"invalid_api_key"`. */
  code: string | undefined;
  /** Human-readable error message. */
  message: string | undefined;
}

/**
 * Extract a `{ code, message }` pair from an arbitrary parsed error body.
 *
 * Tolerant of three layouts: flat (`{ error: "code", message: "msg" }`), nested
 * object (`{ error: { type|code, message } }`), and OpenAI-style
 * (`{ error: { code, message } }`). Unknown shapes yield two `undefined` values
 * rather than throwing.
 *
 * @param body - The already-JSON-parsed response body (or `undefined`).
 * @returns The normalized code and message, each possibly `undefined`.
 */
export function parseErrorBody(body: unknown): ParsedErrorBody {
  if (typeof body !== "object" || body === null) {
    return { code: undefined, message: undefined };
  }
  const root = body as Record<string, unknown>;
  const err = root["error"];

  if (typeof err === "string") {
    const message = typeof root["message"] === "string" ? (root["message"] as string) : err;
    return { code: err, message };
  }

  if (typeof err === "object" && err !== null) {
    const nested = err as Record<string, unknown>;
    const code =
      typeof nested["type"] === "string"
        ? (nested["type"] as string)
        : typeof nested["code"] === "string"
          ? (nested["code"] as string)
          : undefined;
    const message =
      typeof nested["message"] === "string" ? (nested["message"] as string) : undefined;
    return { code, message };
  }

  const topMessage = typeof root["message"] === "string" ? (root["message"] as string) : undefined;
  return { code: undefined, message: topMessage };
}

/** Fields shared by the constructors of every concrete SDK error. */
interface SkailarErrorOptions {
  /** Human-readable message; falls back to a per-class default. */
  message?: string | undefined;
  /** Machine-readable error code from the response body, if any. */
  code?: string | undefined;
  /** Value of the response `x-request-id` header, if present. */
  requestId?: string | undefined;
  /** The raw response body (parsed JSON or raw text) for diagnostics. */
  raw?: unknown;
  /** Underlying cause, e.g. the original network error. */
  cause?: unknown;
}

/**
 * Abstract base class for all errors thrown by the Skailar SDK.
 *
 * Not thrown directly; serves as the common `instanceof` target. The `abstract`
 * marker forbids `new SkailarError()` while still allowing subclasses to call `super`.
 */
export abstract class SkailarError extends Error {
  /** HTTP status code, or `null` for non-HTTP failures (e.g. network). */
  readonly status: number | null;
  /** Machine-readable error code from the body, if any. */
  readonly code: string | undefined;
  /** Correlation id from the `x-request-id` response header, if any. */
  readonly requestId: string | undefined;
  /** The raw response body captured for debugging. */
  readonly raw: unknown;

  /**
   * @param status - HTTP status, or `null` when not applicable.
   * @param options - Message, code, request id, raw body and cause.
   */
  protected constructor(status: number | null, options: SkailarErrorOptions = {}) {
    super(options.message ?? "Skailar SDK error", { cause: options.cause });
    this.name = new.target.name;
    this.status = status;
    this.code = options.code;
    this.requestId = options.requestId;
    this.raw = options.raw;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * Raised when the request never produced an HTTP response: DNS failures,
 * connection resets, TLS errors, and client-side timeouts/aborts driven by the
 * configured `timeout`. Its {@link SkailarError.status} is always `null`.
 */
export class SkailarConnectionError extends SkailarError {
  /** @param options - Message and originating cause. */
  constructor(options: { message?: string; cause?: unknown } = {}) {
    super(null, {
      message: options.message ?? "Failed to connect to the Skailar API",
      cause: options.cause,
    });
  }
}

/**
 * Base class for any non-2xx HTTP response from the gateway.
 * {@link SkailarAPIError.from} is the factory that inspects the status code and
 * returns the most specific subclass.
 */
export class SkailarAPIError extends SkailarError {
  /**
   * @param status - The HTTP status code of the response.
   * @param options - Message, code, request id and raw body.
   */
  constructor(status: number, options: SkailarErrorOptions = {}) {
    super(status, options);
  }

  /**
   * Build the most specific {@link SkailarAPIError} subclass for a status code.
   *
   * @param status - The HTTP status code returned by the gateway.
   * @param parsed - The normalized `{ code, message }` from {@link parseErrorBody}.
   * @param requestId - The `x-request-id` header value, if present.
   * @param raw - The raw response body for diagnostics.
   * @param retryAfter - Seconds from a `Retry-After` header, for 429 responses.
   * @returns A {@link SkailarAuthError}, {@link SkailarBadRequestError},
   * {@link SkailarNotFoundError}, {@link SkailarRateLimitError},
   * {@link SkailarUpstreamError}, or a plain {@link SkailarAPIError}.
   */
  static from(
    status: number,
    parsed: ParsedErrorBody,
    requestId: string | undefined,
    raw: unknown,
    retryAfter?: number | undefined,
  ): SkailarAPIError {
    const options: SkailarErrorOptions = {
      message: parsed.message,
      code: parsed.code,
      requestId,
      raw,
    };
    switch (status) {
      case 401:
        return new SkailarAuthError(options);
      case 400:
        return new SkailarBadRequestError(options);
      case 404:
        return new SkailarNotFoundError(options);
      case 429:
        return new SkailarRateLimitError({ ...options, retryAfter });
      default:
        if (status >= 500) return new SkailarUpstreamError(status, options);
        return new SkailarAPIError(status, options);
    }
  }
}

/** HTTP 401 — the API key is missing, malformed, or revoked. */
export class SkailarAuthError extends SkailarAPIError {
  /** @param options - Error details. */
  constructor(options: SkailarErrorOptions = {}) {
    super(401, { message: "Invalid or missing API key", ...options });
  }
}

/** HTTP 400 — the request was malformed or failed validation. */
export class SkailarBadRequestError extends SkailarAPIError {
  /** @param options - Error details. */
  constructor(options: SkailarErrorOptions = {}) {
    super(400, { message: "Bad request", ...options });
  }
}

/** HTTP 404 — the requested resource (e.g. a model id) does not exist. */
export class SkailarNotFoundError extends SkailarAPIError {
  /** @param options - Error details. */
  constructor(options: SkailarErrorOptions = {}) {
    super(404, { message: "Resource not found", ...options });
  }
}

/**
 * HTTP 429 — the account exceeded its rate limit.
 *
 * When the gateway provides a `Retry-After` header, its value (in seconds) is
 * exposed as {@link SkailarRateLimitError.retryAfter} and honored by the
 * client's automatic retry logic.
 */
export class SkailarRateLimitError extends SkailarAPIError {
  /** Seconds to wait before retrying, parsed from `Retry-After`; `undefined` if absent/unparseable. */
  readonly retryAfter: number | undefined;

  /** @param options - Error details plus the optional `retryAfter` seconds. */
  constructor(options: SkailarErrorOptions & { retryAfter?: number | undefined } = {}) {
    super(429, { message: "Rate limit exceeded", ...options });
    this.retryAfter = options.retryAfter;
  }
}

/**
 * HTTP 5xx — the upstream model provider failed or timed out. The gateway
 * propagates provider 5xx failures (502/503/504) with a structured body. These
 * are transient and are retried automatically.
 */
export class SkailarUpstreamError extends SkailarAPIError {
  /**
   * @param status - The specific 5xx status code.
   * @param options - Error details.
   */
  constructor(status: number, options: SkailarErrorOptions = {}) {
    super(status, { message: "Upstream provider error", ...options });
  }
}
