/**
 * The audio resource, exposing `client.audio.transcriptions.create(...)` and
 * `client.audio.speech.create(...)`.
 *
 * @packageDocumentation
 */

import type { Skailar } from "../client";
import { SkailarConnectionError } from "../errors";
import { toBase64 } from "../internal/binary";
import type {
  SpeechCreateParams,
  TranscriptionCreateParams,
  TranscriptionResponse,
} from "../types/audio";

/** Audio transcription operations (speech-to-text, Whisper-backed). */
export class AudioTranscriptions {
  /** The owning client used to dispatch requests. */
  private readonly client: Skailar;

  /** @param client - The owning {@link Skailar} client. */
  constructor(client: Skailar) {
    this.client = client;
  }

  /**
   * Transcribe an audio clip to text. The supplied bytes are base64-encoded
   * client-side into the gateway's `base64` field. When `mime` is omitted and
   * `file` is a {@link Blob} carrying a `type`, that type is used; otherwise the
   * gateway default (`audio/wav`) applies.
   *
   * @param params - The audio and its MIME type; see {@link TranscriptionCreateParams}.
   * `file` may be a {@link Uint8Array}, {@link ArrayBuffer}, {@link Blob} or a
   * pre-encoded base64 string.
   * @returns A promise resolving to the {@link TranscriptionResponse}.
   */
  async create(params: TranscriptionCreateParams): Promise<TranscriptionResponse> {
    const base64 = await toBase64(params.file);
    const mime =
      params.mime ??
      (typeof Blob !== "undefined" && params.file instanceof Blob && params.file.type
        ? (params.file.type as TranscriptionCreateParams["mime"])
        : undefined);
    return this.client.request<TranscriptionResponse>({
      method: "POST",
      path: "/v1/audio/transcriptions",
      body: { base64, mime },
      expect: "json",
      signal: params.signal,
    });
  }
}

/** Speech synthesis operations (text-to-speech). */
export class AudioSpeech {
  /** The owning client used to dispatch requests. */
  private readonly client: Skailar;

  /** @param client - The owning {@link Skailar} client. */
  constructor(client: Skailar) {
    this.client = client;
  }

  /**
   * Synthesize speech and return the raw MP3 audio stream. Unlike the JSON
   * endpoints, this returns the response body stream directly so large audio
   * payloads need not be buffered in memory.
   *
   * Pass `params.signal` to cancel the request: aborting it before the response
   * arrives rejects this call, and aborting it while the MP3 is still downloading
   * tears down the underlying connection so the body stops mid-stream.
   *
   * @param params - The text, voice and optional abort signal; see {@link SpeechCreateParams}.
   * @returns A promise resolving to a `ReadableStream<Uint8Array>` of
   * `audio/mpeg` bytes, suitable for piping to a file, an HTTP response, or an
   * audio element.
   * @throws {@link SkailarConnectionError} If the response unexpectedly lacks a body.
   * @throws {@link SkailarBadRequestError} On HTTP 400 (e.g. text exceeding 4000 chars).
   */
  async create(params: SpeechCreateParams): Promise<ReadableStream<Uint8Array>> {
    const response = await this.client.request({
      method: "POST",
      path: "/v1/audio/speech",
      body: { input: params.input, voice: params.voice },
      headers: { Accept: "audio/mpeg" },
      expect: "response",
      signal: params.signal,
    });
    if (!response.body) {
      throw new SkailarConnectionError({ message: "Speech response had no audio body" });
    }
    return response.body;
  }
}

/** The audio resource root, grouping transcription and speech. */
export class AudioResource {
  /** Speech-to-text operations. */
  readonly transcriptions: AudioTranscriptions;
  /** Text-to-speech operations. */
  readonly speech: AudioSpeech;

  /** @param client - The owning {@link Skailar} client. */
  constructor(client: Skailar) {
    this.transcriptions = new AudioTranscriptions(client);
    this.speech = new AudioSpeech(client);
  }
}
