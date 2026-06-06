/**
 * A configurable in-process HTTP mock of the Skailar gateway, built on the Node
 * standard library, used to drive the SDK's tests without touching the network.
 *
 * @packageDocumentation
 */

import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

/** A captured record of one request the mock server received. */
export interface CapturedRequest {
  /** HTTP method of the request. */
  method: string;
  /** Request path including any query string. */
  url: string;
  /** Lower-cased request headers. */
  headers: Record<string, string>;
  /** Raw request body text (empty for bodyless requests). */
  body: string;
}

/**
 * A handler that fully owns producing the response for one request.
 *
 * @param req - The incoming Node request.
 * @param res - The Node response to write to.
 * @param attempt - The 1-based count of how many times the server has been hit,
 * enabling per-attempt behavior (e.g. fail twice then succeed).
 */
export type MockHandler = (
  req: IncomingMessage,
  res: ServerResponse,
  attempt: number,
) => void | Promise<void>;

/** A running mock server plus helpers to inspect and tear it down. */
export interface MockServer {
  /** Base URL (e.g. `http://127.0.0.1:54321`) to pass as `baseURL`. */
  url: string;
  /** All requests received so far, in arrival order. */
  requests: CapturedRequest[];
  /** Number of requests received, i.e. attempts made. */
  attempts: () => number;
  /** Stop the server and release its port. */
  close: () => Promise<void>;
}

/**
 * Start a mock server that dispatches every request to one handler. Binds to an
 * ephemeral port on `127.0.0.1`. The request body is fully buffered and captured
 * before the handler runs, so handlers may rely on {@link MockServer.requests}
 * for the current call.
 *
 * @param handler - The response producer; receives the attempt counter.
 * @returns A promise resolving to the {@link MockServer} controls.
 */
export async function startMockServer(handler: MockHandler): Promise<MockServer> {
  const requests: CapturedRequest[] = [];
  let attempt = 0;

  const server: Server = createServer((req, res) => {
    attempt += 1;
    const currentAttempt = attempt;
    const chunks: Buffer[] = [];
    req.on("data", (chunk) => chunks.push(chunk as Buffer));
    req.on("end", () => {
      const headers: Record<string, string> = {};
      for (const [key, value] of Object.entries(req.headers)) {
        headers[key.toLowerCase()] = Array.isArray(value) ? value.join(", ") : (value ?? "");
      }
      requests.push({
        method: req.method ?? "GET",
        url: req.url ?? "/",
        headers,
        body: Buffer.concat(chunks).toString("utf8"),
      });
      void handler(req, res, currentAttempt);
    });
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as AddressInfo;

  return {
    url: `http://127.0.0.1:${address.port}`,
    requests,
    attempts: () => attempt,
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((err) => (err ? reject(err) : resolve())),
      ),
  };
}

/**
 * Write a JSON response with the given status and body.
 *
 * @param res - The Node response.
 * @param status - HTTP status code.
 * @param body - Value serialized as the JSON response body.
 * @param headers - Optional extra response headers.
 */
export function sendJson(
  res: ServerResponse,
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, { "content-type": "application/json", ...headers });
  res.end(payload);
}

/**
 * Write a complete SSE response from a list of event payloads. Each event is
 * JSON-stringified if it is not already a string. A trailing `[DONE]` sentinel
 * is written unless disabled, matching the gateway's stream termination.
 *
 * @param res - The Node response.
 * @param events - Event payloads; each is emitted as a `data:` line.
 * @param options - Whether to append a terminal `data: [DONE]` (default `true`).
 */
export function sendSSE(
  res: ServerResponse,
  events: unknown[],
  options: { done?: boolean } = {},
): void {
  res.writeHead(200, {
    "content-type": "text/event-stream",
    "cache-control": "no-cache",
    connection: "keep-alive",
  });
  for (const event of events) {
    const data = typeof event === "string" ? event : JSON.stringify(event);
    res.write(`data: ${data}\n\n`);
  }
  if (options.done !== false) res.write("data: [DONE]\n\n");
  res.end();
}

/**
 * Build a minimal valid chat-completion-chunk-shaped object.
 *
 * @param content - The text fragment to place in `choices[0].delta.content`.
 * @param finishReason - Optional finish reason for the terminal chunk.
 * @returns A plain object matching the streamed chunk wire shape.
 */
export function chunk(content: string, finishReason?: string): Record<string, unknown> {
  return {
    id: "chatcmpl-test",
    object: "chat.completion.chunk",
    created: 1700000000,
    model: "test-model",
    choices: [
      {
        index: 0,
        delta: content ? { content } : {},
        ...(finishReason ? { finish_reason: finishReason } : {}),
      },
    ],
  };
}
