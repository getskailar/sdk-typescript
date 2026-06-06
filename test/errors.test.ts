/**
 * Tests for error classification, retry/backoff behavior, `Retry-After` honoring,
 * the no-retry-on-4xx rule, and request timeouts.
 */

import { afterEach, describe, expect, it } from "vitest";
import Skailar, {
  SkailarAuthError,
  SkailarBadRequestError,
  SkailarConnectionError,
  SkailarNotFoundError,
  SkailarRateLimitError,
  SkailarUpstreamError,
} from "../src/index";
import { capRetryDelay, MAX_RETRY_DELAY_MS } from "../src/client";
import { sendJson, startMockServer, type MockServer } from "./helpers/mock-server";
import type { ServerResponse } from "node:http";

let server: MockServer | undefined;

afterEach(async () => {
  await server?.close();
  server = undefined;
});

/**
 * Build a client pointed at the mock server.
 *
 * @param maxRetries - Retry budget to configure.
 * @param timeout - Per-attempt timeout in ms.
 * @returns A configured {@link Skailar} client.
 */
function client(maxRetries = 0, timeout = 60_000): Skailar {
  if (!server) throw new Error("server not started");
  return new Skailar({
    apiKey: "skl_live_err",
    baseURL: server.url,
    maxRetries,
    timeout,
  });
}

/**
 * Issue a trivial chat completion used to exercise transport behavior.
 *
 * @param c - The client to use.
 * @returns The completion promise.
 */
function call(c: Skailar) {
  return c.chat.completions.create({ model: "m", messages: [{ role: "user", content: "x" }] });
}

describe("error classification", () => {
  it("maps 401 to SkailarAuthError with flat body shape", async () => {
    server = await startMockServer((_req, res) => {
      sendJson(res, 401, { error: "invalid_api_key", message: "missing or invalid API key" });
    });

    const err = await call(client()).catch((e) => e);
    expect(err).toBeInstanceOf(SkailarAuthError);
    expect(err.status).toBe(401);
    expect(err.code).toBe("invalid_api_key");
    expect(err.message).toBe("missing or invalid API key");
  });

  it("maps 400 to SkailarBadRequestError", async () => {
    server = await startMockServer((_req, res) => {
      sendJson(res, 400, { error: "bad_request", message: "nope" });
    });
    const err = await call(client()).catch((e) => e);
    expect(err).toBeInstanceOf(SkailarBadRequestError);
    expect(err.status).toBe(400);
  });

  it("maps 404 to SkailarNotFoundError", async () => {
    server = await startMockServer((_req, res) => {
      sendJson(res, 404, { error: "not_found", message: 'model "x" not found' });
    });
    const err = await client().models.retrieve("x").catch((e) => e);
    expect(err).toBeInstanceOf(SkailarNotFoundError);
  });

  it("maps 429 to SkailarRateLimitError and parses Retry-After", async () => {
    server = await startMockServer((_req, res) => {
      sendJson(res, 429, { error: "rate_limited", message: "slow down" }, { "retry-after": "7" });
    });
    const err = await call(client()).catch((e) => e);
    expect(err).toBeInstanceOf(SkailarRateLimitError);
    expect((err as SkailarRateLimitError).retryAfter).toBe(7);
  });

  it("maps 5xx to SkailarUpstreamError", async () => {
    server = await startMockServer((_req, res) => {
      sendJson(res, 503, { error: "upstream_error", message: "provider down" });
    });
    const err = await call(client()).catch((e) => e);
    expect(err).toBeInstanceOf(SkailarUpstreamError);
    expect(err.status).toBe(503);
  });

  it("captures the x-request-id header on errors", async () => {
    server = await startMockServer((_req, res) => {
      sendJson(res, 400, { error: "bad_request", message: "bad" }, { "x-request-id": "req-789" });
    });
    const err = await call(client()).catch((e) => e);
    expect(err.requestId).toBe("req-789");
  });
});

describe("retry behavior", () => {
  it("retries 5xx then succeeds", async () => {
    server = await startMockServer((_req, res, attempt) => {
      if (attempt < 3) {
        sendJson(res, 500, { error: "upstream_error", message: "try again" });
        return;
      }
      sendJson(res, 200, {
        id: "ok",
        object: "chat.completion",
        created: 1,
        model: "m",
        choices: [{ index: 0, message: { role: "assistant", content: "done" }, finish_reason: "stop" }],
        usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
      });
    });

    const res = await call(client(3));
    expect(res.choices[0]?.message.content).toBe("done");
    expect(server.attempts()).toBe(3);
  });

  it("retries 429 honoring a short Retry-After", async () => {
    server = await startMockServer((_req, res, attempt) => {
      if (attempt === 1) {
        sendJson(res, 429, { error: "rate_limited", message: "wait" }, { "retry-after": "0" });
        return;
      }
      sendJson(res, 200, {
        id: "ok",
        object: "chat.completion",
        created: 1,
        model: "m",
        choices: [{ index: 0, message: { role: "assistant", content: "recovered" }, finish_reason: "stop" }],
        usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
      });
    });

    const res = await call(client(2));
    expect(res.choices[0]?.message.content).toBe("recovered");
    expect(server.attempts()).toBe(2);
  });

  it("waits for the Retry-After duration before retrying a 429", async () => {
    server = await startMockServer((_req, res, attempt) => {
      if (attempt === 1) {
        sendJson(res, 429, { error: "rate_limited", message: "wait" }, { "retry-after": "2" });
        return;
      }
      sendJson(res, 200, {
        id: "ok",
        object: "chat.completion",
        created: 1,
        model: "m",
        choices: [{ index: 0, message: { role: "assistant", content: "after-wait" }, finish_reason: "stop" }],
        usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
      });
    });

    const start = performance.now();
    const res = await call(client(2));
    const elapsed = performance.now() - start;

    expect(res.choices[0]?.message.content).toBe("after-wait");
    expect(server.attempts()).toBe(2);
    // Retry-After: 2s must be honored, NOT the jittered backoff: backoff(1) is
    // Math.random() * min(8000, 500 * 2^1) = [0, 1000)ms, which can never reach
    // 1900ms. So crossing ~2s proves the header value drove the wait.
    expect(elapsed).toBeGreaterThanOrEqual(1900);
    expect(elapsed).toBeLessThan(3500);
  });

  it("exposes the true server Retry-After on the error even when large", async () => {
    server = await startMockServer((_req, res) => {
      sendJson(res, 429, { error: "rate_limited", message: "wait" }, { "retry-after": "3600" });
    });

    // maxRetries: 0 so it throws without waiting; the error must report the real value.
    const err = await call(client(0)).catch((e) => e);
    expect(err).toBeInstanceOf(SkailarRateLimitError);
    expect((err as SkailarRateLimitError).retryAfter).toBe(3600);
  });

  it("caps the retry delay so an oversized Retry-After cannot stall the call", () => {
    // A 1-hour Retry-After is clamped to the 60s ceiling.
    expect(capRetryDelay(3600)).toBe(MAX_RETRY_DELAY_MS);
    expect(capRetryDelay(3600)).toBeLessThan(3600 * 1000);
    // Values under the cap pass through unchanged (seconds → ms).
    expect(capRetryDelay(5)).toBe(5000);
    expect(capRetryDelay(0)).toBe(0);
    // Negative or absent values are handled defensively.
    expect(capRetryDelay(-10)).toBe(0);
    expect(capRetryDelay(undefined)).toBeUndefined();
  });

  it("does NOT retry a non-429 4xx", async () => {
    server = await startMockServer((_req, res) => {
      sendJson(res, 400, { error: "bad_request", message: "fatal" });
    });
    const err = await call(client(5)).catch((e) => e);
    expect(err).toBeInstanceOf(SkailarBadRequestError);
    expect(server.attempts()).toBe(1);
  });

  it("gives up after exhausting the retry budget", async () => {
    server = await startMockServer((_req, res) => {
      sendJson(res, 500, { error: "upstream_error", message: "always fails" });
    });
    const err = await call(client(2)).catch((e) => e);
    expect(err).toBeInstanceOf(SkailarUpstreamError);
    expect(server.attempts()).toBe(3);
  });
});

describe("timeout", () => {
  it("aborts a slow request as a connection error", async () => {
    server = await startMockServer((_req, res: ServerResponse) => {
      setTimeout(() => {
        sendJson(res, 200, {
          id: "late",
          object: "chat.completion",
          created: 1,
          model: "m",
          choices: [{ index: 0, message: { role: "assistant", content: "late" }, finish_reason: "stop" }],
          usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
        });
      }, 200);
    });

    const err = await call(client(0, 50)).catch((e) => e);
    expect(err).toBeInstanceOf(SkailarConnectionError);
    expect(err.status).toBeNull();
  });

  it("reports a timeout with a message distinct from an external abort", async () => {
    server = await startMockServer((_req, res: ServerResponse) => {
      setTimeout(() => sendJson(res, 200, { text: "late" }), 300);
    });

    const timeoutErr = await client(0, 40)
      .audio.transcriptions.create({ file: new Uint8Array([1]), mime: "audio/wav" })
      .catch((e) => e);
    expect(timeoutErr).toBeInstanceOf(SkailarConnectionError);
    expect(timeoutErr.message).toMatch(/timed out/i);
    expect(timeoutErr.message).not.toMatch(/aborted/i);
  });

  it("reports an external abort with an 'aborted' message, not a timeout", async () => {
    server = await startMockServer((_req, res: ServerResponse) => {
      setTimeout(() => sendJson(res, 200, { text: "late" }), 300);
    });

    const ac = new AbortController();
    const promise = client(0, 5_000)
      .audio.transcriptions.create(
        { file: new Uint8Array([1]), mime: "audio/wav" },
        { signal: ac.signal },
      )
      .catch((e) => e);
    ac.abort();

    const err = await promise;
    expect(err).toBeInstanceOf(SkailarConnectionError);
    expect(err.message).toMatch(/aborted/i);
    expect(err.message).not.toMatch(/timed out/i);
  });
});
