/**
 * Compile-time and runtime guards for the `chat.completions.create` overloads:
 * literal `stream` narrows to a precise return type, and a non-literal `boolean`
 * `stream` resolves to the `ChatCompletion | ChatCompletionStream` union so
 * conditional streaming type-checks. The assignments below fail `tsc` if an
 * overload regresses; the runtime cases assert the dispatch matches the types.
 */

import { afterEach, describe, expect, it } from "vitest";
import Skailar, {
  ChatCompletionStream,
  type ChatCompletion,
} from "../src/index";
import { chunk, sendJson, sendSSE, startMockServer, type MockServer } from "./helpers/mock-server";

let server: MockServer | undefined;

afterEach(async () => {
  await server?.close();
  server = undefined;
});

/**
 * A type-level assertion that `A` and `B` are mutually assignable.
 *
 * @typeParam A - First type.
 * @typeParam B - Second type.
 */
type Exact<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;

/**
 * Compile-time assertion helper; only its type parameter matters.
 *
 * @typeParam _T - Must resolve to `true` or this call fails to type-check.
 */
function expectType<_T extends true>(): void {
  /* no-op: the constraint does the checking */
}

declare const shouldStream: boolean;

/**
 * Exercises the three overload shapes purely for the type checker. Never called;
 * its body must compile for the build to pass.
 */
async function _typeProbe(client: Skailar): Promise<void> {
  const a = client.chat.completions.create({ model: "gpt-5", messages: [] });
  expectType<Exact<typeof a, Promise<ChatCompletion>>>();

  const b = client.chat.completions.create({ model: "gpt-5", messages: [], stream: true });
  expectType<Exact<typeof b, Promise<ChatCompletionStream>>>();

  const c = client.chat.completions.create({ model: "gpt-5", messages: [], stream: shouldStream });
  expectType<Exact<typeof c, Promise<ChatCompletion | ChatCompletionStream>>>();

  const base = { model: "gpt-5", messages: [] };
  const d = client.chat.completions.create({ ...base, stream: shouldStream ? true : false });
  expectType<Exact<typeof d, Promise<ChatCompletion | ChatCompletionStream>>>();

  void a;
  void b;
  void c;
  void d;
}
void _typeProbe;

/**
 * Guards that the public `client.request(...)` overloads resolve by `expect`, so
 * the resource-internal call sites infer a precise return type rather than
 * collapsing to `Promise<unknown>`. Never called; must compile.
 */
async function _requestOverloadProbe(client: Skailar): Promise<void> {
  const stream = client.request({
    method: "POST",
    path: "/v1/chat/completions",
    body: {},
    expect: "stream",
  });
  expectType<Exact<typeof stream, Promise<ChatCompletionStream>>>();

  const response = client.request({
    method: "POST",
    path: "/v1/audio/speech",
    body: {},
    headers: { Accept: "audio/mpeg" },
    expect: "response",
  });
  expectType<Exact<typeof response, Promise<Response>>>();

  const json = client.request<{ ok: boolean }>({
    method: "GET",
    path: "/v1/ping-key",
    expect: "json",
  });
  expectType<Exact<typeof json, Promise<{ ok: boolean }>>>();

  void stream;
  void response;
  void json;
}
void _requestOverloadProbe;

describe("chat.completions.create overload dispatch", () => {
  it("returns a ChatCompletion for a non-streaming request", async () => {
    server = await startMockServer((_req, res) => {
      sendJson(res, 200, {
        id: "x",
        object: "chat.completion",
        created: 1,
        model: "m",
        choices: [{ index: 0, message: { role: "assistant", content: "hi" }, finish_reason: "stop" }],
        usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
      });
    });
    const client = new Skailar({ apiKey: "skl_live_t", baseURL: server.url, maxRetries: 0 });

    const res = await client.chat.completions.create({
      model: "m",
      messages: [{ role: "user", content: "x" }],
    });
    expect(res).not.toBeInstanceOf(ChatCompletionStream);
    expect(res.choices[0]?.message.content).toBe("hi");
  });

  it("returns a ChatCompletionStream for stream: true", async () => {
    server = await startMockServer((_req, res) => {
      sendSSE(res, [chunk("hi", "stop")]);
    });
    const client = new Skailar({ apiKey: "skl_live_t", baseURL: server.url, maxRetries: 0 });

    const res = await client.chat.completions.create({
      model: "m",
      messages: [{ role: "user", content: "x" }],
      stream: true,
    });
    expect(res).toBeInstanceOf(ChatCompletionStream);
    for await (const _ of res) void _;
  });

  it("dispatches correctly when stream is a runtime boolean", async () => {
    server = await startMockServer((_req, res, attempt) => {
      if (attempt === 1) {
        sendJson(res, 200, {
          id: "x",
          object: "chat.completion",
          created: 1,
          model: "m",
          choices: [{ index: 0, message: { role: "assistant", content: "buffered" }, finish_reason: "stop" }],
          usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
        });
      } else {
        sendSSE(res, [chunk("streamed", "stop")]);
      }
    });
    const client = new Skailar({ apiKey: "skl_live_t", baseURL: server.url, maxRetries: 0 });

    /**
     * Request a completion, optionally streaming, collapsing either return shape
     * to a single string — the conditional-streaming use case from the overload.
     *
     * @param streaming - Whether to stream.
     * @returns The concatenated assistant text.
     */
    async function ask(streaming: boolean): Promise<string> {
      const res = await client.chat.completions.create({
        model: "m",
        messages: [{ role: "user", content: "x" }],
        stream: streaming,
      });
      if (res instanceof ChatCompletionStream) {
        let text = "";
        for await (const c of res) text += c.choices[0]?.delta?.content ?? "";
        return text;
      }
      return res.choices[0]?.message.content ?? "";
    }

    expect(await ask(false)).toBe("buffered");
    expect(await ask(true)).toBe("streamed");
  });
});
