/**
 * Tests for request cancellation via `AbortSignal` on the audio resource, and
 * for cleanup of the external-abort listener so a long-lived caller signal does
 * not accumulate listeners across requests.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import Skailar, { SkailarConnectionError } from "../src/index";
import { startMockServer, type MockServer } from "./helpers/mock-server";
import type { ServerResponse } from "node:http";

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
    const promise = client().audio.speech.create({ input: "hello", signal: ac.signal });
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
    const stream = await client().audio.speech.create({ input: "long", signal: ac.signal });

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

    const stream = await client().audio.speech.create({ input: "short", signal: ac.signal });
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
    const promise = client().audio.transcriptions.create({
      file: new Uint8Array([0, 1, 2]),
      mime: "audio/wav",
      signal: ac.signal,
    });
    ac.abort();

    await expect(promise).rejects.toBeInstanceOf(SkailarConnectionError);
  });
});
