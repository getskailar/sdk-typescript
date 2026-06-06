/**
 * Example: streaming a chat completion token-by-token.
 *
 * Run against a local gateway with:
 * ```sh
 * SKAILAR_API_KEY=skl_live_... \
 * SKAILAR_BASE_URL=http://localhost:8080 \
 * SKAILAR_MODEL=gemini-2.5-flash-lite \
 * bun run examples/streaming.ts
 * ```
 */

import Skailar from "../src/index";

/**
 * Stream a reply and write each delta to stdout as it arrives, demonstrating
 * real incremental output.
 *
 * @returns A promise that resolves when the stream completes.
 */
async function main(): Promise<void> {
  const client = new Skailar({
    baseURL: process.env.SKAILAR_BASE_URL ?? "https://api.skailar.com",
  });

  const stream = await client.chat.completions.create({
    model: process.env.SKAILAR_MODEL ?? "claude-sonnet-4-6",
    messages: [{ role: "user", content: "Count from one to ten, in words." }],
    max_tokens: 200,
    stream: true,
  });

  for await (const chunk of stream) {
    process.stdout.write(chunk.choices[0]?.delta?.content ?? "");
  }
  process.stdout.write("\n");
}

void main();
