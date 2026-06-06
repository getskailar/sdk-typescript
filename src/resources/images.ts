/**
 * The images resource, exposing `client.images.generate(...)`.
 *
 * @packageDocumentation
 */

import type { Skailar } from "../client";
import type {
  ImageGenerationRequest,
  ImageGenerationResponse,
} from "../types/images";

/** Image generation operations. */
export class ImagesResource {
  /** The owning client used to dispatch requests. */
  private readonly client: Skailar;

  /** @param client - The owning {@link Skailar} client. */
  constructor(client: Skailar) {
    this.client = client;
  }

  /**
   * Generate one or more images from a text prompt. Named `generate` to match
   * `openai`'s `images.generate(...)`.
   *
   * @param body - The generation request; see {@link ImageGenerationRequest}.
   * @returns A promise resolving to the {@link ImageGenerationResponse}, whose
   * `data` entries carry either a `url` or inline `b64_json`.
   * @throws {@link SkailarBadRequestError} On HTTP 400.
   * @throws {@link SkailarRateLimitError} On HTTP 429 (after exhausting retries).
   */
  generate(body: ImageGenerationRequest): Promise<ImageGenerationResponse> {
    return this.client.request<ImageGenerationResponse>({
      method: "POST",
      path: "/v1/images/generations",
      body,
      expect: "json",
    });
  }
}
