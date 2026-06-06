# Skailar SDK for TypeScript

The Skailar SDK for TypeScript provides access to the [Skailar API](https://skailar.com) — an OpenAI-compatible, multi-provider LLM gateway — from server-side TypeScript or JavaScript applications.

## Installation

This package is **pre-release and not yet published to npm.** Consume it locally with `bun link`:

```sh
# in this repo
bun install
bun run build
bun link

# in your project (declare the dep, then link)
#   add "@skailar-ai/sdk": "*" to package.json dependencies, then:
bun link @skailar-ai/sdk
```

Once published, installation will be:

```sh
bun add @skailar-ai/sdk
```

## Getting started

```js
import Skailar from '@skailar-ai/sdk';

const client = new Skailar({
  apiKey: process.env.SKAILAR_API_KEY,
});

const completion = await client.chat.completions.create({
  model: 'claude-sonnet-4-6',
  messages: [{ role: 'user', content: 'Hello, Skailar' }],
});

console.log(completion.choices[0].message.content);
```

### Streaming

```js
const stream = await client.chat.completions.create({
  model: 'claude-sonnet-4-6',
  messages: [{ role: 'user', content: 'Count to ten.' }],
  stream: true,
});

for await (const chunk of stream) {
  process.stdout.write(chunk.choices[0]?.delta?.content ?? '');
}
```

### Drop-in OpenAI replacement

The wire format mirrors OpenAI's, so migrating is typically just the import and client construction:

```diff
- import OpenAI from 'openai';
- const client = new OpenAI({ apiKey: process.env['OPENAI_API_KEY'] });
+ import Skailar from '@skailar-ai/sdk';
+ const client = new Skailar({ apiKey: process.env['SKAILAR_API_KEY'] });
```

## Requirements

Node.js 18+ (also runs on Bun, Deno and modern browsers). Zero runtime dependencies.

## License

This project is licensed under the MIT License. See the [LICENSE](LICENSE) file for details.
