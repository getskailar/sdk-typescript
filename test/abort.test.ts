/**
 * Tests for request cancellation via `AbortSignal` on the audio resource, and
 * for cleanup of the external-abort listener so a long-lived caller signal does
 * not accumulate listeners across requests.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import Skailar, { SkailarConnectionError } from "../src/index";
import { sendJson, startMockServer, type MockServer } from "./helpers/mock-server";
import type { ServerResponse } from "node:http";

/**
 * Wrap an {@link AbortSignal} so calls to add/remove its `"abort"` listeners are
 * counted, used to assert that retried requests do not leak listeners.
 *
 * @param signal - The signal to instrument (mutated in place).
 * @returns A getter for the net listener count (added minus removed).
 */
function countAbortListeners(signal: AbortSignal): () => number {
  let added = 0;
  let removed = 0;
  const origAdd = signal.addEventListener.bind(signal);
  const origRemove = signal.removeEventListener.bind(signal);
  Object.defineProperty(signal, "addEventListener", {
    configurable: true,
    value(type: string, ...rest: unknown[]) {
      if (type === "abort") added += 1;
      return (origAdd as (...a: unknown[]) => void)(type, ...rest);
    },
  });
  Object.defineProperty(signal, "removeEventListener", {
    configurable: true,
    value(type: string, ...rest: unknown[]) {
      if (type === "abort") removed += 1;
      return (origRemove as (...a: unknown[]) => void)(type, ...rest);
    },
  });
  return () => added - removed;
}

/**
 * A minimal successful chat completion body for mock responses.
 *
 * @param content - The assistant message content.
 * @returns A plain object matching the `chat.completion` wire shape.
 */
function completion(content: string): Record<string, unknown> {
  return {
    id: "chatcmpl-abort",
    object: "chat.completion",
    created: 1,
    model: "m",
    choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }],
    usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
  };
}

let server: MockServer | undefined;

afterEach(async () => {
  await server?.close();
  server = undefined;
});

/**
 * Build a client pointed at the running mock server.
 *
 * @param timeout - Per-attempt timeout in ms (kept high so tests drive aborts).
 * @returns A configured {@link Skailar} client.
 */
function client(timeout = 30_000): Skailar {
  if (!server) throw new Error("server not started");
  return new Skailar({ apiKey: "skl_live_abort", baseURL: server.url, maxRetries: 0, timeout });
}

/**
 * Read a byte stream to completion, returning the total number of bytes seen.
 *
 * @param stream - The stream to drain.
 * @returns The byte count.
 */
async function drain(stream: ReadableStream<Uint8Array>): Promise<number> {
  const reader = stream.getReader();
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
  }
  return total;
}

describe("audio.speech.create cancellation", () => {
  it("aborting before the response rejects the call", async () => {
    server = await startMockServer((_req, res: ServerResponse) => {
      setTimeout(() => {
        res.writeHead(200, { "content-type": "audio/mpeg" });
        res.end(Buffer.from([1, 2, 3]));
      }, 500);
    });

    const ac = new AbortController();
    const promise = client().audio.speech.create({ input: "hello" }, { signal: ac.signal });
    ac.abort();

    await expect(promise).rejects.toBeInstanceOf(SkailarConnectionError);
  });

  it("aborting mid-download stops the returned audio stream", async () => {
    server = await startMockServer((_req, res: ServerResponse) => {
      res.writeHead(200, { "content-type": "audio/mpeg" });
      res.write(Buffer.from(new Uint8Array(1024)));
      const timer = setInterval(() => {
        if (res.writableEnded) {
          clearInterval(timer);
          return;
        }
        res.write(Buffer.from(new Uint8Array(1024)));
      }, 20);
    });

    const ac = new AbortController();
    const stream = await client().audio.speech.create({ input: "long" }, { signal: ac.signal });

    const reader = stream.getReader();
    const first = await reader.read();
    expect(first.done).toBe(false);

    ac.abort();

    await expect(
      (async () => {
        for (;;) {
          const { done } = await reader.read();
          if (done) break;
        }
      })(),
    ).rejects.toBeTruthy();
  });

  it("a completed download fully drains and removes the abort listener", async () => {
    server = await startMockServer((_req, res: ServerResponse) => {
      res.writeHead(200, { "content-type": "audio/mpeg" });
      res.end(Buffer.from(new Uint8Array(2048)));
    });

    const ac = new AbortController();
    const removeSpy = vi.spyOn(ac.signal, "removeEventListener");

    const stream = await client().audio.speech.create({ input: "short" }, { signal: ac.signal });
    const bytes = await drain(stream);

    expect(bytes).toBe(2048);
    expect(removeSpy).toHaveBeenCalled();

    ac.abort();
  });

  it("transcriptions.create rejects when its signal aborts", async () => {
    server = await startMockServer((_req, res: ServerResponse) => {
      setTimeout(() => {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ text: "late" }));
      }, 500);
    });

    const ac = new AbortController();
    const promise = client().audio.transcriptions.create(
      { file: new Uint8Array([0, 1, 2]), mime: "audio/wav" },
      { signal: ac.signal },
    );
    ac.abort();

    await expect(promise).rejects.toBeInstanceOf(SkailarConnectionError);
  });
});

describe("abort listener cleanup across retries", () => {
  it("does not leak listeners on the caller signal when a request is retried", async () => {
    server = await startMockServer((_req, res, attempt) => {
      if (attempt < 3) {
        sendJson(res, 503, { error: "upstream_error", message: "retry me" });
        return;
      }
      sendJson(res, 200, completion("done"));
    });

    const c = new Skailar({
      apiKey: "skl_live_retry",
      baseURL: server.url,
      maxRetries: 3,
      timeout: 5_000,
    });

    const ac = new AbortController();
    const netListeners = countAbortListeners(ac.signal);

    // Use chat completions (idempotent → retried on 5xx) to drive the retry loop.
    const res = await c.chat.completions.create(
      { model: "m", messages: [{ role: "user", content: "x" }] },
      { signal: ac.signal },
    );

    expect(res).toBeDefined();
    expect(server.attempts()).toBe(3);
    expect(netListeners()).toBe(0);

    ac.abort();
  });

  it("does not leak listeners after a non-streaming request completes", async () => {
    server = await startMockServer((_req, res) => {
      sendJson(res, 200, completion("ok"));
    });

    const c = new Skailar({ apiKey: "skl_live_clean", baseURL: server.url, maxRetries: 0 });
    const ac = new AbortController();
    const netListeners = countAbortListeners(ac.signal);

    await c.audio.transcriptions.create(
      { file: new Uint8Array([9]) },
      { signal: ac.signal },
    );

    expect(netListeners()).toBe(0);
    ac.abort();
  });
});
