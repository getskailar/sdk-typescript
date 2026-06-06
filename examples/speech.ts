/**
 * Example: text-to-speech, writing the returned MP3 stream to disk.
 *
 * `audio.speech.create` resolves to a `ReadableStream<Uint8Array>`; here it is
 * collected and saved to `speech.mp3`. Run:
 * ```sh
 * SKAILAR_API_KEY=skl_live_... \
 * SKAILAR_BASE_URL=http://localhost:8080 \
 * bun run examples/speech.ts
 * ```
 */

import { writeFile } from "node:fs/promises";
import Skailar from "../src/index";

/**
 * Drain a byte stream into a single {@link Uint8Array}.
 *
 * @param stream - The readable byte stream to consume.
 * @returns A promise resolving to all bytes concatenated.
 */
async function collect(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  const reader = stream.getReader();
  const parts: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    parts.push(value);
    total += value.length;
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

/**
 * Synthesize a sentence and write the audio file.
 *
 * @returns A promise that resolves once `speech.mp3` has been written.
 */
async function main(): Promise<void> {
  const client = new Skailar({
    baseURL: process.env.SKAILAR_BASE_URL ?? "https://api.skailar.com",
  });

  const audio = await client.audio.speech.create({
    input: "Hello from the Skailar TypeScript SDK.",
    voice: "nova",
  });

  const bytes = await collect(audio);
  await writeFile("speech.mp3", bytes);
  console.log(`Wrote speech.mp3 (${bytes.length} bytes)`);
}

void main();
