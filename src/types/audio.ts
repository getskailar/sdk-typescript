/**
 * Types for the audio resource: transcription (`POST /v1/audio/transcriptions`)
 * and speech synthesis (`POST /v1/audio/speech`).
 *
 * @packageDocumentation
 */

/**
 * Binary payload accepted by SDK methods that upload bytes. The SDK normalizes
 * any of these into the base64 string the gateway expects, so callers may pass
 * whichever representation they already hold. A `string` is assumed to be
 * pre-encoded base64 (no `data:` prefix).
 */
export type BinaryInput = Uint8Array | ArrayBuffer | Blob | string;

/** Audio MIME types accepted by the transcription endpoint. */
export type TranscriptionMime =
  | "audio/wav"
  | "audio/webm"
  | "audio/mp4"
  | "audio/m4a"
  | "audio/mpeg"
  | "audio/mp3";

/**
 * Parameters for {@link AudioTranscriptions.create}. Callers pass the raw audio
 * as `file`; the SDK base64-encodes it into the wire field.
 */
export interface TranscriptionCreateParams {
  /** The audio to transcribe, in any {@link BinaryInput} form. */
  file: BinaryInput;
  /**
   * MIME type of the supplied audio (default `"audio/wav"`). If `file` is a
   * {@link Blob} with a `type`, that type is used when this is omitted.
   */
  mime?: TranscriptionMime;
  /** Optional signal to cancel the request before or during the response. */
  signal?: AbortSignal;
}

/** Wire request body for `POST /v1/audio/transcriptions`. */
export interface TranscriptionRequest {
  /** Base64-encoded audio bytes with no `data:` prefix. */
  base64: string;
  mime?: TranscriptionMime;
}

/** Response body for `POST /v1/audio/transcriptions`. */
export interface TranscriptionResponse {
  /** The transcribed text. */
  text: string;
}

/** Voices available for speech synthesis. */
export type SpeechVoice =
  | "alloy"
  | "ash"
  | "ballad"
  | "coral"
  | "echo"
  | "fable"
  | "nova"
  | "onyx"
  | "sage"
  | "shimmer";

/** Parameters for {@link AudioSpeech.create}. */
export interface SpeechCreateParams {
  /** Text to synthesize; limited to 4000 characters by the gateway. */
  input: string;
  /** Voice to speak with (default `"nova"`). */
  voice?: SpeechVoice;
  /**
   * Optional signal to cancel the request. Aborting before the response arrives
   * rejects the call; aborting mid-download tears down the connection so the
   * returned audio stream stops.
   */
  signal?: AbortSignal;
}

/** Wire request body for `POST /v1/audio/speech`. */
export interface SpeechRequest {
  /** Text to synthesize (max 4000 characters). */
  input: string;
  voice?: SpeechVoice;
}
