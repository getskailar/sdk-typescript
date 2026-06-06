/**
 * Internal helpers for normalizing caller-supplied binary payloads into the
 * base64 strings the Skailar gateway expects. Runtime-agnostic across Node 18+,
 * Bun, Deno and browsers.
 *
 * @packageDocumentation
 */

import type { BinaryInput } from "../types/audio";

/**
 * Encode a byte array as a standard (non-URL-safe) base64 string, without any
 * `data:` prefix.
 *
 * Prefers Node's `Buffer` when present (fast path on Node/Bun) and otherwise
 * falls back to `btoa` over a binary string, chunked to avoid call-stack limits
 * on large inputs in browser/Deno environments.
 *
 * @param bytes - The raw bytes to encode.
 * @returns The base64 representation.
 */
function bytesToBase64(bytes: Uint8Array): string {
  const maybeBuffer = (globalThis as { Buffer?: typeof import("node:buffer").Buffer }).Buffer;
  if (maybeBuffer) {
    return maybeBuffer.from(bytes).toString("base64");
  }

  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

/**
 * Normalize any {@link BinaryInput} into a base64 string (no `data:` prefix).
 *
 * A `string` input is assumed to be pre-encoded base64 and returned unchanged. A
 * {@link Blob} is read via its async `arrayBuffer()`; `ArrayBuffer` and
 * `Uint8Array` are encoded directly. This lets the public API accept whichever
 * representation the caller already holds.
 *
 * @remarks
 * A `string` is taken literally as already-encoded base64 and is **not**
 * validated. Passing raw text (e.g. `"hello world"`) is silently forwarded to
 * the gateway, which will decode it as base64 and produce corrupt bytes or a
 * `400`. Pass a {@link Uint8Array} / {@link ArrayBuffer} / {@link Blob} when you
 * hold raw bytes; reserve the `string` form for values you have already encoded.
 *
 * @param input - The payload as bytes, a buffer, a {@link Blob}, or a base64 string.
 * @returns A promise resolving to the base64 string.
 */
export async function toBase64(input: BinaryInput): Promise<string> {
  if (typeof input === "string") return input;
  if (input instanceof Uint8Array) return bytesToBase64(input);
  if (input instanceof ArrayBuffer) return bytesToBase64(new Uint8Array(input));
  if (typeof Blob !== "undefined" && input instanceof Blob) {
    const buffer = await input.arrayBuffer();
    return bytesToBase64(new Uint8Array(buffer));
  }
  throw new TypeError("Unsupported binary input; expected Uint8Array, ArrayBuffer, Blob or base64 string");
}
