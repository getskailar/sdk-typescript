/**
 * Tests for non-streaming chat completions, models, images, uploads and the ping
 * utility, plus request-shaping assertions (auth header, body).
 */

import { afterEach, describe, expect, it } from "vitest";
import Skailar, { type ModelSummary } from "../src/index";
import { sendJson, startMockServer, type MockServer } from "./helpers/mock-server";

let server: MockServer | undefined;

afterEach(async () => {
  await server?.close();
  server = undefined;
});

/**
 * Build a client pointed at the running mock server.
 *
 * @param key - The API key to configure.
 * @returns A {@link Skailar} client whose `baseURL` is the mock.
 */
function client(key = "skl_live_test_key"): Skailar {
  if (!server) throw new Error("server not started");
  return new Skailar({ apiKey: key, baseURL: server.url, maxRetries: 0 });
}

describe("chat.completions.create (non-streaming)", () => {
  it("returns a parsed ChatCompletion on success", async () => {
    server = await startMockServer((_req, res) => {
      sendJson(res, 200, {
        id: "chatcmpl-1",
        object: "chat.completion",
        created: 1700000000,
        model: "claude-sonnet-4-6",
        choices: [
          { index: 0, message: { role: "assistant", content: "Hello there" }, finish_reason: "stop" },
        ],
        usage: { prompt_tokens: 5, completion_tokens: 2, total_tokens: 7 },
      });
    });

    const res = await client().chat.completions.create({
      model: "claude-sonnet-4-6",
      messages: [{ role: "user", content: "hi" }],
    });

    expect(res.id).toBe("chatcmpl-1");
    expect(res.choices[0]?.message.content).toBe("Hello there");
    expect(res.usage.total_tokens).toBe(7);
  });

  it("sends the bearer token and JSON body", async () => {
    server = await startMockServer((_req, res) => {
      sendJson(res, 200, {
        id: "x",
        object: "chat.completion",
        created: 1,
        model: "m",
        choices: [{ index: 0, message: { role: "assistant", content: "" }, finish_reason: "stop" }],
        usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
      });
    });

    await client("skl_live_abc").chat.completions.create({
      model: "gpt-5",
      messages: [{ role: "user", content: "ping" }],
    });

    const captured = server.requests[0];
    expect(captured?.method).toBe("POST");
    expect(captured?.url).toBe("/v1/chat/completions");
    expect(captured?.headers["authorization"]).toBe("Bearer skl_live_abc");
    expect(captured?.headers["content-type"]).toContain("application/json");
    expect(JSON.parse(captured?.body ?? "{}").model).toBe("gpt-5");
  });

  it("merges defaultHeaders without overriding auth", async () => {
    server = await startMockServer((_req, res) => {
      sendJson(res, 200, {
        id: "x",
        object: "chat.completion",
        created: 1,
        model: "m",
        choices: [{ index: 0, message: { role: "assistant", content: "" }, finish_reason: "stop" }],
        usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
      });
    });

    const c = new Skailar({
      apiKey: "skl_live_h",
      baseURL: server.url,
      defaultHeaders: { "x-custom": "yes" },
    });
    await c.chat.completions.create({ model: "m", messages: [{ role: "user", content: "y" }] });

    expect(server.requests[0]?.headers["x-custom"]).toBe("yes");
    expect(server.requests[0]?.headers["authorization"]).toBe("Bearer skl_live_h");
  });
});

describe("models", () => {
  it("list() unwraps the data array", async () => {
    server = await startMockServer((_req, res) => {
      sendJson(res, 200, {
        object: "list",
        data: [
          {
            id: "claude-sonnet-4-6",
            object: "model",
            created: 1,
            owned_by: "anthropic",
            display_name: "Claude Sonnet 4.6",
            context_window: 200000,
            max_output_tokens: 8192,
            capabilities: { streaming: true, tool_calls: true, vision: true, json_mode: true },
            pricing: { input_per_mtok: 3, output_per_mtok: 15, currency: "USD" },
            status: "available",
          },
        ],
      });
    });

    const models: ModelSummary[] = await client().models.list();
    expect(models).toHaveLength(1);
    expect(models[0]?.id).toBe("claude-sonnet-4-6");
    expect(models[0]?.owned_by).toBe("anthropic");
  });

  it("retrieve() preserves slashes in the model id path", async () => {
    server = await startMockServer((_req, res) => {
      sendJson(res, 200, {
        id: "google/gemini-2.5-pro",
        object: "model",
        created: 1,
        owned_by: "google",
        display_name: "Gemini 2.5 Pro",
        context_window: 1000000,
        max_output_tokens: 8192,
        capabilities: { streaming: true, tool_calls: true, vision: true, json_mode: true },
        pricing: { input_per_mtok: 1, output_per_mtok: 5, currency: "USD" },
        status: "available",
      });
    });

    const model = await client().models.retrieve("google/gemini-2.5-pro");
    expect(model.id).toBe("google/gemini-2.5-pro");
    expect(server.requests[0]?.url).toBe("/v1/models/google/gemini-2.5-pro");
  });
});

describe("images.generate", () => {
  it("posts the prompt and returns image data", async () => {
    server = await startMockServer((_req, res) => {
      sendJson(res, 200, {
        created: 1,
        data: [{ url: "https://cdn.skailar.com/img/1.png", revised_prompt: "a cat" }],
      });
    });

    const res = await client().images.generate({ model: "gpt-image-1", prompt: "a cat", n: 1 });
    expect(res.data[0]?.url).toContain("1.png");
    expect(JSON.parse(server.requests[0]?.body ?? "{}").prompt).toBe("a cat");
  });
});

describe("uploads", () => {
  it("base64-encodes a Uint8Array image payload", async () => {
    server = await startMockServer((_req, res) => {
      sendJson(res, 200, { url: "/u/abc.png", content_type: "image/png" });
    });

    const bytes = new Uint8Array([0, 1, 2, 3, 255]);
    const res = await client().uploads.images.create({ data: bytes, contentType: "image/png" });

    expect(res.url).toBe("/u/abc.png");
    const body = JSON.parse(server.requests[0]?.body ?? "{}");
    expect(body.content_type).toBe("image/png");
    expect(body.base64).toBe(Buffer.from(bytes).toString("base64"));
  });

  it("passes through a pre-encoded base64 string unchanged", async () => {
    server = await startMockServer((_req, res) => {
      sendJson(res, 200, { url: "/u/doc.pdf", content_type: "application/pdf" });
    });

    await client().uploads.files.create({ data: "QUJD", contentType: "application/pdf" });
    expect(JSON.parse(server.requests[0]?.body ?? "{}").base64).toBe("QUJD");
  });
});

describe("ping", () => {
  it("returns the ping-key payload", async () => {
    server = await startMockServer((_req, res) => {
      sendJson(res, 200, { status: "ok", user_id: "user-123" });
    });

    const res = await client().ping();
    expect(res.status).toBe("ok");
    expect(res.user_id).toBe("user-123");
  });
});

describe("constructor", () => {
  it("throws when no API key is available", () => {
    const prev = process.env.SKAILAR_API_KEY;
    delete process.env.SKAILAR_API_KEY;
    try {
      expect(() => new Skailar({})).toThrow(/API key/i);
    } finally {
      if (prev !== undefined) process.env.SKAILAR_API_KEY = prev;
    }
  });
});
