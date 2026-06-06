/**
 * Types for the chat completions resource (`POST /v1/chat/completions`),
 * modelled on the OpenAI wire format so the SDK is a drop-in replacement for
 * `openai` for these calls.
 *
 * @packageDocumentation
 */

import type { LiteralUnion, Usage } from "./shared";

/**
 * Identifiers of models known to the gateway at the time this SDK was cut, used
 * to power editor autocomplete.
 *
 * This is intentionally a {@link LiteralUnion}: the list is a convenience hint,
 * not an enforced enum. The authoritative, always-current catalog is
 * `GET /v1/models`; new models work immediately without an SDK upgrade.
 */
export type KnownModelId =
  | "epoch-mini"
  | "claude-opus-4-8"
  | "claude-opus-4-7"
  | "claude-sonnet-4-6"
  | "claude-opus-4-6"
  | "claude-haiku-4-5"
  | "claude-sonnet-4-5"
  | "o3"
  | "o4-mini"
  | "gpt-5"
  | "gpt-5-mini"
  | "gpt-5.1"
  | "gpt-5.4"
  | "gpt-5.4-nano"
  | "gpt-5.4-mini"
  | "gpt-5.5"
  | "gemini-2.5-flash"
  | "gemini-2.5-pro"
  | "gemini-2.5-flash-lite"
  | "gemini-3-flash-preview"
  | "gemini-3.1-pro-preview"
  | "gemini-3.5-flash"
  | "deepseek-v4-flash"
  | "deepseek-v4-pro"
  | "grok-4.20-non-reasoning"
  | "grok-4.20-reasoning"
  | "grok-4.3"
  | "grok-build-0.1"
  | "gpt-image-1";

/** A model identifier: any known id (with autocomplete) or any other string. */
export type ModelId = LiteralUnion<KnownModelId>;

/** The conversational role attached to a {@link ChatMessage}. */
export type ChatRole = "system" | "user" | "assistant" | "tool";

/** A plain-text fragment of multi-part message content. */
export interface TextContentPart {
  type: "text";
  /** The literal text contributed by this part. */
  text: string;
}

/**
 * An image fragment of multi-part message content, used for vision input.
 *
 * The `url` may be an inline `data:` URI (base64) or an HTTPS URL, for instance
 * one returned by `POST /v1/uploads/images`.
 */
export interface ImageContentPart {
  type: "image_url";
  image_url: {
    /** A `data:` URI or HTTPS URL pointing at the image. */
    url: string;
    /**
     * Requested analysis fidelity: `low` is cheaper/faster, `high` preserves
     * detail, `auto` lets the upstream provider decide.
     */
    detail?: "low" | "high" | "auto";
  };
}

/** A single fragment of structured message content. */
export type ContentPart = TextContentPart | ImageContentPart;

/**
 * Message content: a simple string, an ordered array of parts (for mixed text +
 * vision), or `null` (e.g. an assistant turn that only carries tool calls).
 */
export type MessageContent = string | ContentPart[] | null;

/**
 * One message in a chat conversation.
 *
 * For `role: "tool"`, {@link ChatMessage.tool_call_id} is required and must
 * reference the `id` of the assistant tool call being answered.
 */
export interface ChatMessage {
  role: ChatRole;
  /** The message payload; optional for assistant tool-call-only turns. */
  content?: MessageContent;
  /** Tool calls requested by the assistant on this turn, if any. */
  tool_calls?: ToolCall[];
  /** Identifier of the tool call this message responds to; required when `role` is `"tool"`. */
  tool_call_id?: string;
}

/**
 * A function-calling tool definition, OpenAI-compatible.
 *
 * @remarks
 * Tools use the OpenAI shape (`type: "function"`, `function.parameters` as JSON
 * Schema). The gateway translates this into each provider's native format —
 * e.g. Anthropic's `input_schema` — so provider-native tool shapes are not
 * exposed by the SDK in this version.
 */
export interface Tool {
  type: "function";
  function: {
    /** Unique function name the model may invoke. */
    name: string;
    /** Natural-language description guiding when to call it. */
    description?: string;
    /**
     * JSON Schema describing the function's arguments. Left as an open record
     * because the SDK ships no runtime schema validator.
     */
    parameters?: Record<string, unknown>;
  };
}

/**
 * Controls whether and how the model may call tools: `"auto"` lets the model
 * decide, `"none"` forbids tool use, `"required"` forces at least one call, and
 * the object form pins a specific function by name.
 */
export type ToolChoice =
  | "auto"
  | "none"
  | "required"
  | {
      type: "function";
      function: {
        /** Name of the function to force. */
        name: string;
      };
    };

/** A tool invocation emitted by the assistant. */
export interface ToolCall {
  /** Stable identifier correlating this call with its tool result. */
  id: string;
  type: "function";
  function: {
    /** Name of the invoked function. */
    name: string;
    /**
     * JSON-encoded argument object, as a string. Per the OpenAI contract this is
     * a string of JSON, not a parsed object — callers must `JSON.parse` it.
     */
    arguments: string;
  };
}

/**
 * Reasoning budget for reasoning-capable models (Claude extended thinking,
 * OpenAI o-series, DeepSeek-R1, Gemini thinking). Ignored by other models.
 */
export type ReasoningEffort = "low" | "medium" | "high";

/**
 * Requested output structure, OpenAI-compatible. Honored only when the selected
 * upstream model supports it. Use `{ type: "json_object" }` for free-form JSON
 * or `{ type: "json_schema", json_schema: {...} }` for constrained output.
 */
export interface ResponseFormat {
  type: "text" | "json_object" | "json_schema";
  /** Schema descriptor, present when {@link ResponseFormat.type} is `"json_schema"`. */
  json_schema?: Record<string, unknown>;
}

/**
 * Request body for `POST /v1/chat/completions`. Field names and semantics match
 * the OpenAI Chat Completions API. The `stream` field narrows the method's
 * return type at compile time via overloads on the resource.
 */
export interface ChatCompletionRequest {
  /** Model identifier or alias to route the request to. */
  model: ModelId;
  /** The ordered conversation history. */
  messages: ChatMessage[];
  /** When `true`, responses arrive incrementally as SSE chunks. */
  stream?: boolean;
  /** Hard cap on tokens generated for the completion. */
  max_tokens?: number;
  /** Sampling temperature in `[0, 2]`; higher is more random. */
  temperature?: number;
  /** Nucleus sampling probability mass in `[0, 1]`. */
  top_p?: number;
  /** Reasoning budget for reasoning-capable models. */
  reasoning_effort?: ReasoningEffort;
  /** Tool definitions the model may call. */
  tools?: Tool[];
  /** Constraint on whether/which tools may be called. */
  tool_choice?: ToolChoice;
  /** Requested output structure. */
  response_format?: ResponseFormat;
  /** Number of independent completions to generate (default `1`). */
  n?: number;
  /** Penalty in `[-2, 2]` discouraging repeated topics. */
  presence_penalty?: number;
  /** Penalty in `[-2, 2]` discouraging repeated tokens. */
  frequency_penalty?: number;
  /** Per-token logit bias map keyed by token id. */
  logit_bias?: Record<string, number>;
  /** Opaque stable end-user identifier for abuse monitoring. */
  user?: string;
  /** Seed for best-effort deterministic sampling. */
  seed?: number;
  /** One or more stop sequences that halt generation. */
  stop?: string | string[];
}

/**
 * Reason the model stopped generating a choice: `"stop"` natural end,
 * `"length"` hit the token cap, `"tool_calls"` paused to call tools,
 * `"content_filter"` blocked by moderation.
 */
export type FinishReason = "stop" | "length" | "tool_calls" | "content_filter";

/** A single completed choice within a non-streamed {@link ChatCompletion}. */
export interface ChatCompletionChoice {
  /** Zero-based position of this choice when `n > 1`. */
  index: number;
  message: {
    role: "assistant";
    /** The generated text; may be empty when only tool calls are present. */
    content: string;
    /** Reasoning trace for models that expose their thinking (e.g. DeepSeek). */
    reasoning_content?: string;
    /** Tool calls the assistant requested, if any. */
    tool_calls?: ToolCall[];
  };
  /** Why generation stopped for this choice. */
  finish_reason: FinishReason;
}

/** A complete, non-streamed chat completion (`object: "chat.completion"`). */
export interface ChatCompletion {
  id: string;
  object: "chat.completion";
  /** Creation time as Unix epoch seconds. */
  created: number;
  /** The model that actually served the request. */
  model: string;
  /** One entry per requested choice. */
  choices: ChatCompletionChoice[];
  usage: Usage;
}

/**
 * Incremental tool-call fragment carried by a streamed delta.
 *
 * Streaming assembles a tool call across chunks: the first chunk for a given
 * `index` carries `id`/`name`, subsequent chunks append to `arguments`.
 */
export interface ChatCompletionChunkToolCall {
  /** Position of the tool call being assembled. */
  index: number;
  /** Tool call id, present on the opening fragment. */
  id?: string;
  type?: "function";
  function?: {
    /** Function name, present on the opening fragment. */
    name?: string;
    /** A slice of the JSON-encoded arguments string to append. */
    arguments?: string;
  };
}

/** A single choice slice within a streamed {@link ChatCompletionChunk}. */
export interface ChatCompletionChunkChoice {
  /** Zero-based position of this choice when `n > 1`. */
  index: number;
  delta: {
    /** Present only on the first delta of the choice. */
    role?: "assistant";
    /** The text fragment to append to the running content. */
    content?: string;
    /** The reasoning-trace fragment to append, if any. */
    reasoning_content?: string;
    /** Tool-call fragments to merge by index. */
    tool_calls?: ChatCompletionChunkToolCall[];
  };
  /** Stop reason, present on the terminal slice; may be `null` on intermediate chunks. */
  finish_reason?: FinishReason | null;
}

/** One streamed delta of a chat completion (`object: "chat.completion.chunk"`). */
export interface ChatCompletionChunk {
  id: string;
  object: "chat.completion.chunk";
  /** Creation time as Unix epoch seconds. */
  created: number;
  model: string;
  /** Incremental choice slices for this chunk. */
  choices: ChatCompletionChunkChoice[];
  /**
   * Running token accounting. The Skailar gateway reports cumulative
   * {@link Usage} on each chunk; treat it as the latest snapshot, not an increment.
   */
  usage?: Usage;
}
