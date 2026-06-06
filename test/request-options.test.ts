/**
 * Tests for the per-call {@link RequestOptions} argument shared by the
 * non-streaming resource methods: `signal` cancellation, a per-call `timeout`
 * override, and per-call `headers` merging.
 */

import { afterEach, describe, expect, it } from "vitest";
import Skailar, { SkailarConnectionError } from "../src/index";
import { sendJson, startMockServer, type MockServer } from "./helpers/mock-server";
import type { ServerResponse } from "node:http";

let server: MockServer | undefined;

afterEach(async () => {
  await server?.close();
  server = undefined;
});

/**
 * Build a client pointed at the running mock server.
 *
 * @param timeout - Client-level timeout in ms.
 * @returns A configured {@link Skailar} client.
 */
function client(timeout = 30_000): Skailar {
  if (!server) throw new Error("server not started");
  return new Skailar({ apiKey: "skl_live_opts", baseURL: server.url, maxRetries: 0, timeout });
}

/** A minimal successful chat completion body. */
const OK_COMPLETION = {
  id: "x",
  object: "chat.completion",
  created: 1,
  model: "m",
  choices: [{ index: 0, message: { role: "assistant", content: "ok" }, finish_reason: "stop" }],
  usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
};

describe("per-call signal cancellation (non-streaming)", () => {
  it("aborts chat.completions.create via options.signal", async () => {
    server = await startMockServer((_req, res: ServerResponse) => {
      setTimeout(() => sendJson(res, 200, OK_COMPLETION), 400);
    });

    const ac = new AbortController();
    const promise = client().chat.completions.create(
      { model: "m", messages: [{ role: "user", content: "x" }] },
      { signal: ac.signal },
    );
    ac.abort();

    await expect(promise).rejects.toBeInstanceOf(SkailarConnectionError);
  });

  it("aborts models.list via options.signal", async () => {
    server = await startMockServer((_req, res: ServerResponse) => {
      setTimeout(() => sendJson(res, 200, { object: "list", data: [] }), 400);
    });

    const ac = new AbortController();
    const promise = client().models.list({ signal: ac.signal });
    ac.abort();

    await expect(promise).rejects.toBeInstanceOf(SkailarConnectionError);
  });

  it("aborts images.generate via options.signal", async () => {
    server = await startMockServer((_req, res: ServerResponse) => {
      setTimeout(() => sendJson(res, 200, { created: 1, data: [] }), 400);
    });

    const ac = new AbortController();
    const promise = client().images.generate(
      { model: "gpt-image-1", prompt: "a cat" },
      { signal: ac.signal },
    );
    ac.abort();

    await expect(promise).rejects.toBeInstanceOf(SkailarConnectionError);
  });

  it("aborts ping via options.signal", async () => {
    server = await startMockServer((_req, res: ServerResponse) => {
      setTimeout(() => sendJson(res, 200, { status: "ok", user_id: "u" }), 400);
    });

    const ac = new AbortController();
    const promise = client().ping({ signal: ac.signal });
    ac.abort();

    await expect(promise).rejects.toBeInstanceOf(SkailarConnectionError);
  });
});

describe("per-call timeout override", () => {
  it("a short per-call timeout fires even when the client default is generous", async () => {
    server = await startMockServer((_req, res: ServerResponse) => {
      setTimeout(() => sendJson(res, 200, OK_COMPLETION), 300);
    });

    const err = await client(30_000)
      .chat.completions.create(
        { model: "m", messages: [{ role: "user", content: "x" }] },
        { timeout: 40 },
      )
      .catch((e) => e);

    expect(err).toBeInstanceOf(SkailarConnectionError);
    expect(err.message).toMatch(/timed out after 40ms/i);
  });

  it("a generous per-call timeout overrides a tiny client default", async () => {
    server = await startMockServer((_req, res: ServerResponse) => {
      setTimeout(() => sendJson(res, 200, OK_COMPLETION), 80);
    });

    const res = await client(10).chat.completions.create(
      { model: "m", messages: [{ role: "user", content: "x" }] },
      { timeout: 5_000 },
    );
    expect(res.choices[0]?.message.content).toBe("ok");
  });
});

describe("per-call headers", () => {
  it("merges options.headers into the request without dropping auth", async () => {
    server = await startMockServer((_req, res) => {
      sendJson(res, 200, OK_COMPLETION);
    });

    await client().chat.completions.create(
      { model: "m", messages: [{ role: "user", content: "x" }] },
      { headers: { "x-trace-id": "abc-123" } },
    );

    const captured = server.requests[0];
    expect(captured?.headers["x-trace-id"]).toBe("abc-123");
    expect(captured?.headers["authorization"]).toBe("Bearer skl_live_opts");
  });
});
