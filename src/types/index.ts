/**
 * Barrel re-exporting every public type of the Skailar SDK.
 *
 * @packageDocumentation
 */

export type { LiteralUnion, Usage } from "./shared";

export type {
  KnownModelId,
  ModelId,
  ChatRole,
  TextContentPart,
  ImageContentPart,
  ContentPart,
  MessageContent,
  ChatMessage,
  Tool,
  ToolChoice,
  ToolCall,
  ReasoningEffort,
  ResponseFormat,
  ChatCompletionRequest,
  FinishReason,
  ChatCompletionChoice,
  ChatCompletion,
  ChatCompletionChunkToolCall,
  ChatCompletionChunkChoice,
  ChatCompletionChunk,
} from "./chat";

export type {
  ModelOwner,
  ModelStatus,
  ModelCapabilities,
  ModelPricing,
  ModelSummary,
  Model,
  ModelList,
} from "./models";

export type {
  ImageGenerationRequest,
  GeneratedImage,
  ImageGenerationResponse,
} from "./images";

export type {
  BinaryInput,
  TranscriptionMime,
  TranscriptionCreateParams,
  TranscriptionRequest,
  TranscriptionResponse,
  SpeechVoice,
  SpeechCreateParams,
  SpeechRequest,
} from "./audio";

export type {
  ImageContentType,
  FileContentType,
  ImageUploadCreateParams,
  FileUploadCreateParams,
  UploadRequest,
  UploadResponse,
} from "./uploads";

/** Response body for `GET /v1/ping-key`. */
export interface PingKeyResponse {
  /** Always `"ok"` when the key is valid. */
  status: "ok";
  /** UUID of the account that owns the validated key. */
  user_id: string;
}
