/**
 * The uploads resource, exposing `client.uploads.images.create(...)` and
 * `client.uploads.files.create(...)` for storing assets in Skailar storage and
 * receiving an embeddable URL.
 *
 * @packageDocumentation
 */

import type { Skailar } from "../client";
import { toBase64 } from "../internal/binary";
import type {
  FileUploadCreateParams,
  ImageUploadCreateParams,
  UploadResponse,
} from "../types/uploads";

/** Image upload operations (`POST /v1/uploads/images`). */
export class ImageUploads {
  /** The owning client used to dispatch requests. */
  private readonly client: Skailar;

  /** @param client - The owning {@link Skailar} client. */
  constructor(client: Skailar) {
    this.client = client;
  }

  /**
   * Upload an image and obtain a URL usable as vision input. `data` may be a
   * {@link Uint8Array}, {@link ArrayBuffer}, {@link Blob} or a pre-encoded base64
   * string; it is base64-encoded client-side into the gateway's `base64` field.
   *
   * @param params - The image bytes and content type; see {@link ImageUploadCreateParams}.
   * @returns A promise resolving to the {@link UploadResponse} whose `url` can be
   * embedded in a chat completion as an `image_url` content part.
   */
  async create(params: ImageUploadCreateParams): Promise<UploadResponse> {
    const base64 = await toBase64(params.data);
    return this.client.request<UploadResponse>({
      method: "POST",
      path: "/v1/uploads/images",
      body: { base64, content_type: params.contentType },
      expect: "json",
    });
  }
}

/** File upload operations (`POST /v1/uploads/files`). */
export class FileUploads {
  /** The owning client used to dispatch requests. */
  private readonly client: Skailar;

  /** @param client - The owning {@link Skailar} client. */
  constructor(client: Skailar) {
    this.client = client;
  }

  /**
   * Upload a document (`application/pdf` or `text/plain`). `data` accepts the
   * same forms as image upload and is base64-encoded client-side.
   *
   * @param params - The document bytes and content type; see {@link FileUploadCreateParams}.
   * @returns A promise resolving to the {@link UploadResponse} with the stored asset URL.
   */
  async create(params: FileUploadCreateParams): Promise<UploadResponse> {
    const base64 = await toBase64(params.data);
    return this.client.request<UploadResponse>({
      method: "POST",
      path: "/v1/uploads/files",
      body: { base64, content_type: params.contentType },
      expect: "json",
    });
  }
}

/** The uploads resource root, grouping image and file uploads. */
export class UploadsResource {
  /** Image upload operations. */
  readonly images: ImageUploads;
  /** File/document upload operations. */
  readonly files: FileUploads;

  /** @param client - The owning {@link Skailar} client. */
  constructor(client: Skailar) {
    this.images = new ImageUploads(client);
    this.files = new FileUploads(client);
  }
}
