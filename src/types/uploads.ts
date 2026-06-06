/**
 * Types for the uploads resource: image uploads (`POST /v1/uploads/images`) and
 * file uploads (`POST /v1/uploads/files`).
 *
 * @packageDocumentation
 */

import type { BinaryInput } from "./audio";

/** Content types accepted by `POST /v1/uploads/images`. */
export type ImageContentType =
  | "image/png"
  | "image/jpeg"
  | "image/gif"
  | "image/webp";

/** Content types accepted by `POST /v1/uploads/files`. */
export type FileContentType = "application/pdf" | "text/plain";

/**
 * Parameters for `client.uploads.images.create`. Callers pass raw bytes as
 * `data`; the SDK base64-encodes them into the wire `base64` field.
 */
export interface ImageUploadCreateParams {
  /** The image bytes, in any {@link BinaryInput} form. */
  data: BinaryInput;
  /** MIME type of the image being uploaded. */
  contentType: ImageContentType;
}

/** Parameters for `client.uploads.files.create`. */
export interface FileUploadCreateParams {
  /** The document bytes, in any {@link BinaryInput} form. */
  data: BinaryInput;
  /** MIME type of the document being uploaded. */
  contentType: FileContentType;
}

/** Wire request body shared by both upload endpoints. */
export interface UploadRequest {
  /** Base64-encoded payload with no `data:` prefix. */
  base64: string;
  /** MIME type of the encoded payload. */
  content_type: string;
}

/** Response body for the upload endpoints. */
export interface UploadResponse {
  /**
   * URL of the stored asset, ready to embed in subsequent calls — for example
   * as the `url` of a vision {@link ImageContentPart}.
   */
  url: string;
  /** MIME type the asset was stored as. */
  content_type: string;
}
