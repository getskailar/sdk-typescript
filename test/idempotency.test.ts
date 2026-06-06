/**
 * Tests that automatic retries never duplicate billed side effects: requests
 * with side effects (image generation, speech, transcription, uploads) are not
 * replayed on 5xx, timeout or connection failure, while a 429 (rejected before
 * execution) is always retried. Idempotent reads/completions still retry on 5xx.
 */

import { afterEach, describe, expect, it } from "vitest";
import Skailar, {
  SkailarConnectionError,
  SkailarUpstreamError,
} from "../src/index";
import { sendJson, startMockServer, type MockServer } from "./helpers/mock-server";
import type { ServerResponse } from "node:http";

let server: MockServer | undefined;

afterEach(async () => {
  await server?.close();
  server = undefined;
});

/**
 * Build a client with a retry budget pointed at the mock server.
 *
 * @param timeout - Per-attempt timeout in ms.
 * @returns A {@link Skailar} client with `maxRetries: 3`.
 */
function client(timeout = 30_000): Skailar {
  if (!server) throw new Error("server not started");
  return new Skailar({ apiKey: "skl_live_idem", baseURL: server.url, maxRetries: 3, timeout });
}

/** A successful image generation body. */
const IMAGE_OK = { created: 1, data: [{ url: "https://cdn/img.png" }] };

describe("side-effect POSTs are not retried on 5xx", () => {
  it("images.generate fails fast on 500 (single attempt, no double charge)", async () => {
    server = await startMockServer((_req, res) => {
      sendJson(res, 500, { error: "upstream_error", message: "boom" });
    });

    const err = await client()
      .images.generate({ model: "gpt-image-1", prompt: "a fox" })
      .catch((e) => e);

    expect(err).toBeInstanceOf(SkailarUpstreamError);
    expect(server.attempts()).toBe(1); // NOT retried
  });

  it("audio.speech.create fails fast on 503", async () => {
    server = await startMockServer((_req, res) => {
      sendJson(res, 503, { error: "upstream_error", message: "down" });
    });

    const err = await client()
      .audio.speech.create({ input: "hello" })
      .catch((e) => e);

    expect(err).toBeInstanceOf(SkailarUpstreamError);
    expect(server.attempts()).toBe(1);
  });

  it("audio.transcriptions.create fails fast on 500", async () => {
    server = await startMockServer((_req, res) => {
      sendJson(res, 500, { error: "upstream_error", message: "boom" });
    });

    const err = await client()
      .audio.transcriptions.create({ file: new Uint8Array([1]), mime: "audio/wav" })
      .catch((e) => e);

    expect(err).toBeInstanceOf(SkailarUpstreamError);
    expect(server.attempts()).toBe(1);
  });

  it("uploads.images.create fails fast on 500", async () => {
    server = await startMockServer((_req, res) => {
      sendJson(res, 500, { error: "upstream_error", message: "boom" });
    });

    const err = await client()
      .uploads.images.create({ data: new Uint8Array([1]), contentType: "image/png" })
      .catch((e) => e);

    expect(err).toBeInstanceOf(SkailarUpstreamError);
    expect(server.attempts()).toBe(1);
  });

  it("a side-effect POST is not retried on a connection timeout", async () => {
    server = await startMockServer((_req, res: ServerResponse) => {
      setTimeout(() => sendJson(res, 200, IMAGE_OK), 300);
    });

    const err = await client(40)
      .images.generate({ model: "gpt-image-1", prompt: "slow" })
      .catch((e) => e);

    expect(err).toBeInstanceOf(SkailarConnectionError);
    expect(err.message).toMatch(/timed out/i);
    expect(server.attempts()).toBe(1); // timeout did not trigger a replay
  });
});

describe("side-effect POSTs ARE retried on 429", () => {
  it("images.generate retries a 429 (no side effect executed yet)", async () => {
    server = await startMockServer((_req, res, attempt) => {
      if (attempt === 1) {
        sendJson(res, 429, { error: "rate_limited", message: "slow down" }, { "retry-after": "0" });
        return;
      }
      sendJson(res, 200, IMAGE_OK);
    });

    const res = await client().images.generate({ model: "gpt-image-1", prompt: "a fox" });
    expect(res.data[0]?.url).toContain("img.png");
    expect(server.attempts()).toBe(2); // 429 retried, then success
  });
});

describe("idempotent requests still retry on 5xx", () => {
  it("chat.completions.create retries a 500", async () => {
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

    const res = await client().chat.completions.create({
      model: "m",
      messages: [{ role: "user", content: "x" }],
    });
    expect(res.choices[0]?.message.content).toBe("done");
    expect(server.attempts()).toBe(3);
  });

  it("models.list retries a 500", async () => {
    server = await startMockServer((_req, res, attempt) => {
      if (attempt < 2) {
        sendJson(res, 500, { error: "upstream_error", message: "try again" });
        return;
      }
      sendJson(res, 200, { object: "list", data: [] });
    });

    const models = await client().models.list();
    expect(models).toEqual([]);
    expect(server.attempts()).toBe(2);
  });
});
