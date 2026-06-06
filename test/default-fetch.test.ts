/**
 * Regression test for the default `fetch` binding. In browsers, `fetch` must be
 * called with the global object as its receiver; invoking it as a method of any
 * other object throws `TypeError: Illegal invocation`. The client must bind the
 * global `fetch` to `globalThis` so storing it on `this.fetchImpl` and calling it
 * does not lose that receiver.
 */

import { afterEach, describe, expect, it } from "vitest";
import Skailar from "../src/index";
import { sendJson, startMockServer, type MockServer } from "./helpers/mock-server";

let server: MockServer | undefined;

afterEach(async () => {
  await server?.close();
  server = undefined;
});

describe("default fetch receiver binding", () => {
  it("works when the global fetch enforces a global receiver", async () => {
    const originalFetch = globalThis.fetch;

    // Emulate the browser's Web IDL restriction: calling fetch with a receiver
    // that is not the global object throws "Illegal invocation".
    const strictFetch = new Proxy(originalFetch, {
      apply(target, thisArg, args: Parameters<typeof fetch>) {
        if (thisArg !== globalThis && thisArg !== undefined && thisArg !== null) {
          throw new TypeError("Failed to execute 'fetch': Illegal invocation");
        }
        return Reflect.apply(target, globalThis, args);
      },
    });

    Object.defineProperty(globalThis, "fetch", { configurable: true, value: strictFetch });
    try {
      server = await startMockServer((_req, res) =>
        sendJson(res, 200, { status: "ok", user_id: "u1" }),
      );
      const client = new Skailar({ apiKey: "skl_live_x", baseURL: server.url, maxRetries: 0 });

      const res = await client.ping();
      expect(res.status).toBe("ok");
      expect(res.user_id).toBe("u1");
    } finally {
      Object.defineProperty(globalThis, "fetch", { configurable: true, value: originalFetch });
    }
  });
});
