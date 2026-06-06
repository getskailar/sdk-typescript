# @skailar-ai/sdk

Official TypeScript SDK for the [Skailar](https://skailar.com) API.

> **Status: pre-release (local only).** This package is **not published to npm yet.**
> See [Status: pre-release](#status-pre-release) for how to consume it via `bun link`.

---

## What is Skailar

Skailar is a multi-provider LLM gateway with an **OpenAI-compatible** surface. A
single API key and base URL give you chat completions, model discovery, image
generation, speech synthesis and transcription, and storage uploads across
Anthropic, OpenAI, Google, DeepSeek, xAI and Skailar's own models. Because the
wire format mirrors OpenAI's, this SDK is a near drop-in replacement for the
official `openai` package for the methods that overlap.

## Installation

This package is **not on npm yet**. Consume it locally with `bun link` (see
[Local development](#local-development) for the full loop):

```bash
# in this repo
bun install
bun run build
bun link

# in the consuming project (e.g. skailar/website/apps/chat)
# 1) declare the dependency so bun materializes the symlink:
#    add  "@skailar-ai/sdk": "*"  to package.json "dependencies"
# 2) then link:
bun link @skailar-ai/sdk
```

> **Note:** unlike npm, `bun link <name>` only creates the `node_modules`
> symlink when the package is also listed under `dependencies` in the
> consumer's `package.json`. Add `"@skailar-ai/sdk": "*"` there first.

Requirements: **Node 18+**, Bun, Deno, or any modern browser — the SDK uses the
global `fetch` and has **zero runtime dependencies**.

## Quickstart

### Completion

```ts
import Skailar from "@skailar-ai/sdk";

const client = new Skailar({ apiKey: process.env.SKAILAR_API_KEY });

const completion = await client.chat.completions.create({
  model: "claude-sonnet-4-6",
  messages: [{ role: "user", content: "Say hello in one word." }],
});

console.log(completion.choices[0]?.message.content);
```

### Streaming

```ts
const stream = await client.chat.completions.create({
  model: "claude-sonnet-4-6",
  messages: [{ role: "user", content: "Count from one to ten." }],
  stream: true,
});

for await (const chunk of stream) {
  process.stdout.write(chunk.choices[0]?.delta?.content ?? "");
}

// Cancel at any time:
// stream.controller.abort();
```

### Vision

```ts
const completion = await client.chat.completions.create({
  model: "gemini-2.5-flash",
  messages: [
    {
      role: "user",
      content: [
        { type: "text", text: "What's in this image?" },
        { type: "image_url", image_url: { url: "https://example.com/cat.png" } },
      ],
    },
  ],
});
```

## Drop-in OpenAI replacement

For chat completions, models, images, transcription and speech, the call shapes
match `openai` v4. In many cases migrating is just changing the import and the
client construction:

```diff
- import OpenAI from "openai";
- const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
+ import Skailar from "@skailar-ai/sdk";
+ const client = new Skailar({ apiKey: process.env.SKAILAR_API_KEY });

  const res = await client.chat.completions.create({
    model: "gpt-5",
    messages: [{ role: "user", content: "hi" }],
  });
```

The same `client.chat.completions.create`, `client.models.list/retrieve`,
`client.images.generate`, `client.audio.transcriptions.create` and
`client.audio.speech.create` signatures apply. Skailar-native helpers
(`client.uploads.*`, `client.ping()`) are additions on top.

## Configuration

```ts
const client = new Skailar({
  apiKey: "skl_live_...",            // default: process.env.SKAILAR_API_KEY
  baseURL: "https://api.skailar.com", // default; the SDK appends /v1/...
  timeout: 60_000,                    // ms per attempt, default 60s
  maxRetries: 2,                      // default 2 (429, 5xx, connection errors)
  fetch: customFetch,                 // override the fetch implementation
  defaultHeaders: { "x-app": "demo" },
});
```

API keys have the form `skl_live_<43 url-safe base64 chars>` and are sent as
`Authorization: Bearer <key>`.

## API reference

### `client.chat.completions.create(params)`

Create a chat completion. Returns a `ChatCompletion` when `stream` is omitted or
`false`, and an async-iterable `ChatCompletionStream` (with a `.controller` for
abort) when `stream: true`. Supports `tools`/`tool_choice`, `response_format`,
`reasoning_effort`, vision content parts, and the usual sampling parameters.

### `client.models.list()`

Returns `ModelSummary[]` — every model the gateway can route to, with pricing,
capabilities and status.

### `client.models.retrieve(id)`

Returns the full `Model` detail card. The `id` may contain slashes
(e.g. `"google/gemini-2.5-pro"`).

### `client.images.generate(params)`

Generate images from a prompt. Returns `ImageGenerationResponse`; each entry has
a `url` or inline `b64_json`.

```ts
const res = await client.images.generate({
  model: "gpt-image-1",
  prompt: "a watercolor fox",
  n: 1,
  size: "1024x1024",
});
```

### `client.audio.transcriptions.create(params)`

Transcribe audio to text. `file` accepts `Uint8Array | ArrayBuffer | Blob` or a
pre-encoded base64 `string`; the SDK base64-encodes it for you.

```ts
const { text } = await client.audio.transcriptions.create({
  file: audioBytes,        // Uint8Array
  mime: "audio/mp3",
});
```

### `client.audio.speech.create(params)`

Synthesize speech. Returns a `ReadableStream<Uint8Array>` of `audio/mpeg`. Pass
an `AbortSignal` to cancel: aborting before the response arrives rejects the
call, and aborting while the audio is still downloading tears down the
connection so the stream stops mid-flight. (`transcriptions.create` accepts the
same `signal`.)

```ts
const ac = new AbortController();
const audio = await client.audio.speech.create({
  input: "Hello!",
  voice: "nova",
  signal: ac.signal,
});
// pipe `audio` to a file or an HTTP response; call ac.abort() to cancel.
```

### `client.uploads.images.create(params)` / `client.uploads.files.create(params)`

Upload an asset to Skailar storage and get back a URL you can embed in a
subsequent chat completion. `data` accepts the same binary forms as
transcription.

```ts
const { url } = await client.uploads.images.create({
  data: pngBytes,
  contentType: "image/png",
});
```

### `client.ping()`

Validate the configured API key. Returns `{ status: "ok", user_id }` or throws
`SkailarAuthError`.

## Error handling

Every failure is a subclass of `SkailarError`, so one check covers them all:

```ts
import {
  SkailarError,
  SkailarAuthError,
  SkailarRateLimitError,
  SkailarConnectionError,
} from "@skailar-ai/sdk";

try {
  await client.chat.completions.create({ model: "gpt-5", messages });
} catch (err) {
  if (err instanceof SkailarRateLimitError) {
    console.log(`Rate limited; retry after ${err.retryAfter}s`);
  } else if (err instanceof SkailarAuthError) {
    console.log("Check your API key");
  } else if (err instanceof SkailarConnectionError) {
    console.log("Network/timeout problem");
  } else if (err instanceof SkailarError) {
    console.log(err.status, err.code, err.message, err.requestId);
  }
}
```

The hierarchy:

```
SkailarError (abstract)
├── SkailarAPIError            any non-2xx with a Skailar error body
│   ├── SkailarAuthError       401
│   ├── SkailarBadRequestError 400
│   ├── SkailarNotFoundError   404
│   ├── SkailarRateLimitError  429  (adds .retryAfter, in seconds)
│   └── SkailarUpstreamError   5xx
└── SkailarConnectionError     network failure / timeout / abort
```

Every error carries `status`, `code`, `message`, `requestId` (when the gateway
returns one) and `raw` (the raw response body).

**Automatic retries** apply only to `429`, `5xx`, and connection errors, using
full-jitter exponential backoff and honoring a `Retry-After` header when
present. Non-429 `4xx` responses are never retried.

## Local development

```bash
bun install          # install dev dependencies
bun run build        # tsup → dist/ (ESM + CJS + .d.ts)
bun test             # vitest, runs the mock-server test suite
bun run typecheck    # tsc --noEmit in strict mode
```

Run an example against a **local gateway** (no Anthropic/OpenAI credits? use a
Google or DeepSeek model, which were verified working):

```bash
SKAILAR_API_KEY=skl_live_... \
SKAILAR_BASE_URL=http://localhost:8080 \
SKAILAR_MODEL=gemini-2.5-flash-lite \
bun run examples/streaming.ts
```

Dogfood from `skailar/website`:

```bash
# in this repo
bun run build && bun link

# in skailar/website/apps/chat
# add "@skailar-ai/sdk": "*" to package.json dependencies first, then:
bun link @skailar-ai/sdk
```

`bun link` symlinks the built `dist/` into the consumer's `node_modules`, so
rebuild (`bun run build`) after changing SDK source to pick up updates.

## Status: pre-release

This SDK is **pre-release and intentionally not published to npm.** It exists for
local development and dogfooding from `skailar/website`. The public API may
change without notice before the first published version. `npm publish` is
deliberately blocked via a `prepublishOnly` guard.

## License

[MIT](./LICENSE).
