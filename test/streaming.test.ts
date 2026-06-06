/**
 * Tests for SSE streaming: token-by-token iteration, the `[DONE]` terminator,
 * mid-stream abort via the stream controller, and in-band error events surfaced
 * as typed errors.
 */

import { afterEach, describe, expect, it } from "vitest";
import Skailar, { SkailarAPIError, ChatCompletionStream } from "../src/index";
import { chunk, sendSSE, startMockServer, type MockServer } from "./helpers/mock-server";
import type { ServerResponse } from "node:http";

let server: MockServer | undefined;

afterEach(async () => {
  await server?.close();
  server = undefined;
});

/**
 * Build a client pointed at the running mock server.
 *
 * @returns A configured {@link Skailar} client.
 */
function client(): Skailar {
  if (!server) throw new Error("server not started");
  return new Skailar({ apiKey: "skl_live_stream", baseURL: server.url, maxRetries: 0 });
}

describe("chat.completions.create (streaming)", () => {
  it("yields chunks in order and stops at [DONE]", async () => {
    server = await startMockServer((_req, res) => {
      sendSSE(res, [chunk("Hello"), chunk(" "), chunk("world", "stop")]);
    });

    const stream = await client().chat.completions.create({
      model: "gemini-2.5-flash-lite",
      messages: [{ role: "user", content: "hi" }],
      stream: true,
    });

    let text = "";
    let count = 0;
    for await (const c of stream) {
      count += 1;
      text += c.choices[0]?.delta?.content ?? "";
    }

    expect(text).toBe("Hello world");
    expect(count).toBe(3);
  });

  it("requests an SSE Accept header and sets stream:true in the body", async () => {
    server = await startMockServer((_req, res) => {
      sendSSE(res, [chunk("hi", "stop")]);
    });

    const stream = await client().chat.completions.create({
      model: "m",
      messages: [{ role: "user", content: "x" }],
      stream: true,
    });
    for await (const _ of stream) void _;

    expect(server.requests[0]?.headers["accept"]).toBe("text/event-stream");
    expect(JSON.parse(server.requests[0]?.body ?? "{}").stream).toBe(true);
  });

  it("exposes a controller that aborts an in-flight stream", async () => {
    server = await startMockServer((_req, res: ServerResponse) => {
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.write(`data: ${JSON.stringify(chunk("one"))}\n\n`);
      let n = 0;
      const timer = setInterval(() => {
        n += 1;
        if (res.writableEnded) {
          clearInterval(timer);
          return;
        }
        res.write(`data: ${JSON.stringify(chunk(`tick-${n}`))}\n\n`);
      }, 20);
    });

    const stream = await client().chat.completions.create({
      model: "m",
      messages: [{ role: "user", content: "go" }],
      stream: true,
    });

    const received: string[] = [];
    await expect(
      (async () => {
        for await (const c of stream) {
          received.push(c.choices[0]?.delta?.content ?? "");
          if (received.length === 1) stream.controller.abort();
        }
      })(),
    ).rejects.toThrow();

    expect(received[0]).toBe("one");
  });

  it("throws a typed error when the stream delivers an error event", async () => {
    server = await startMockServer((_req, res) => {
      sendSSE(res, [{ error: { type: "upstream_error", message: "provider exploded" } }]);
    });

    const stream = await client().chat.completions.create({
      model: "m",
      messages: [{ role: "user", content: "x" }],
      stream: true,
    });

    await expect(
      (async () => {
        for await (const _ of stream) void _;
      })(),
    ).rejects.toMatchObject({ message: "provider exploded" });

    const stream2 = await client().chat.completions.create({
      model: "m",
      messages: [{ role: "user", content: "x" }],
      stream: true,
    });
    let caught: unknown;
    try {
      for await (const _ of stream2) void _;
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(SkailarAPIError);
  });

  it("handles chunks split across SSE write boundaries", async () => {
    server = await startMockServer((_req, res: ServerResponse) => {
      res.writeHead(200, { "content-type": "text/event-stream" });
      const full = `data: ${JSON.stringify(chunk("split-content", "stop"))}\n\n`;
      const mid = Math.floor(full.length / 2);
      res.write(full.slice(0, mid));
      setTimeout(() => {
        res.write(full.slice(mid));
        res.write("data: [DONE]\n\n");
        res.end();
      }, 15);
    });

    const stream = await client().chat.completions.create({
      model: "m",
      messages: [{ role: "user", content: "x" }],
      stream: true,
    });

    let text = "";
    for await (const c of stream) text += c.choices[0]?.delta?.content ?? "";
    expect(text).toBe("split-content");
  });
});

describe("ChatCompletionStream reader cancellation", () => {
  /**
   * Build a `ReadableStream` of SSE bytes that records whether it was cancelled,
   * and that keeps emitting chunks until cancelled.
   *
   * @returns The stream plus a getter reporting if `cancel` ran.
   */
  function infiniteSSEStream(): {
    stream: ReadableStream<Uint8Array>;
    wasCancelled: () => boolean;
  } {
    let cancelled = false;
    let timer: ReturnType<typeof setInterval> | undefined;
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(chunk("first"))}\n\n`));
        let n = 0;
        timer = setInterval(() => {
          n += 1;
          try {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(chunk(`tick-${n}`))}\n\n`));
          } catch {
            if (timer) clearInterval(timer);
          }
        }, 5);
      },
      cancel() {
        cancelled = true;
        if (timer) clearInterval(timer);
      },
    });
    return { stream, wasCancelled: () => cancelled };
  }

  it("cancels the underlying stream when the consumer breaks early", async () => {
    const { stream, wasCancelled } = infiniteSSEStream();
    const completion = new ChatCompletionStream(stream, new AbortController());

    const received: string[] = [];
    for await (const c of completion) {
      received.push(c.choices[0]?.delta?.content ?? "");
      if (received.length >= 2) break;
    }

    expect(received[0]).toBe("first");
    expect(wasCancelled()).toBe(true);
  });

  it("cancels the underlying stream when aborted mid-iteration", async () => {
    const { stream, wasCancelled } = infiniteSSEStream();
    const controller = new AbortController();
    const completion = new ChatCompletionStream(stream, controller);

    await expect(
      (async () => {
        let count = 0;
        for await (const _ of completion) {
          count += 1;
          if (count === 1) controller.abort();
        }
      })(),
    ).rejects.toBeTruthy();

    expect(wasCancelled()).toBe(true);
  });
});
