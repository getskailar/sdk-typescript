/**
 * Example: multimodal (vision) chat using an image content part.
 *
 * Demonstrates supplying an image as a `data:` URI built from local bytes (an
 * HTTPS URL returned by the uploads API works the same way). Run:
 * ```sh
 * SKAILAR_API_KEY=skl_live_... \
 * SKAILAR_BASE_URL=http://localhost:8080 \
 * SKAILAR_MODEL=gemini-2.5-flash \
 * bun run examples/vision.ts
 * ```
 */

import Skailar from "../src/index";

/** A 1x1 transparent PNG, base64-encoded, so the example needs no external asset. */
const TINY_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

/**
 * Ask a vision-capable model to describe an inline image.
 *
 * @returns A promise that resolves once the description is printed.
 */
async function main(): Promise<void> {
  const client = new Skailar({
    baseURL: process.env.SKAILAR_BASE_URL ?? "https://api.skailar.com",
  });

  const completion = await client.chat.completions.create({
    model: process.env.SKAILAR_MODEL ?? "claude-sonnet-4-6",
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: "What color is this image, in one word?" },
          {
            type: "image_url",
            image_url: { url: `data:image/png;base64,${TINY_PNG_BASE64}`, detail: "low" },
          },
        ],
      },
    ],
    max_tokens: 50,
  });

  console.log(completion.choices[0]?.message.content);
}

void main();
