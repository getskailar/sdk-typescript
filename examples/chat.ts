/**
 * Example: a basic, non-streaming chat completion.
 *
 * Run against a local gateway with:
 * ```sh
 * SKAILAR_API_KEY=skl_live_... \
 * SKAILAR_BASE_URL=http://localhost:8080 \
 * SKAILAR_MODEL=gemini-2.5-flash-lite \
 * bun run examples/chat.ts
 * ```
 */

import Skailar from "../src/index";

/**
 * Send one prompt and print the assistant's reply.
 *
 * @returns A promise that resolves once the reply has been printed.
 */
async function main(): Promise<void> {
  const client = new Skailar({
    baseURL: process.env.SKAILAR_BASE_URL ?? "https://api.skailar.com",
  });

  const completion = await client.chat.completions.create({
    model: process.env.SKAILAR_MODEL ?? "claude-sonnet-4-6",
    messages: [
      { role: "system", content: "You are a concise assistant." },
      { role: "user", content: "In one sentence, what is Skailar?" },
    ],
    max_tokens: 100,
  });

  console.log(completion.choices[0]?.message.content);
  console.log("---");
  console.log("usage:", completion.usage);
}

void main();
