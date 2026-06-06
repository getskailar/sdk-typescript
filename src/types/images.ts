/**
 * Types for the image generation resource (`POST /v1/images/generations`).
 *
 * @packageDocumentation
 */

import type { ModelId } from "./chat";

/** Request body for `POST /v1/images/generations`. */
export interface ImageGenerationRequest {
  /** Image model identifier (e.g. `"gpt-image-1"`). */
  model: ModelId;
  /** Natural-language description of the desired image. */
  prompt: string;
  /** Number of images to generate, in `[1, 10]` (default `1`). */
  n?: number;
  /** Output resolution, e.g. `"1024x1024"`; accepted values depend on the provider. */
  size?: string;
  /** Provider-specific quality hint (e.g. `"standard"`, `"hd"`). */
  quality?: string;
  /** Provider-specific background hint (e.g. `"transparent"`). */
  background?: string;
}

/**
 * A single generated image. Exactly one of {@link GeneratedImage.url} or
 * {@link GeneratedImage.b64_json} is populated, depending on the provider's
 * delivery mode.
 */
export interface GeneratedImage {
  /** HTTPS URL of the generated image, when delivered by reference. */
  url?: string;
  /** Base64-encoded image bytes, when delivered inline. */
  b64_json?: string;
  /** The prompt after any provider-side rewriting, if applicable. */
  revised_prompt?: string;
}

/** Response body for `POST /v1/images/generations`. */
export interface ImageGenerationResponse {
  /** Creation time as Unix epoch seconds. */
  created: number;
  data: GeneratedImage[];
}
