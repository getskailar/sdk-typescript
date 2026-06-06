/**
 * Types for the models resource (`GET /v1/models` and `GET /v1/models/{id}`).
 *
 * @packageDocumentation
 */

import type { LiteralUnion } from "./shared";

/**
 * The provider that owns/serves a model. Kept as a {@link LiteralUnion} rather
 * than a closed enum so the gateway may onboard new providers without an SDK release.
 */
export type ModelOwner = LiteralUnion<
  "skailar" | "anthropic" | "openai" | "google" | "deepseek" | "xai"
>;

/**
 * Lifecycle status of a model. The live gateway returns values such as
 * `"available"` and `"beta"`; modelled as a {@link LiteralUnion} so any
 * server-side value parses without breaking the client.
 */
export type ModelStatus = LiteralUnion<
  "available" | "beta" | "active" | "preview" | "deprecated"
>;

/** Capability flags describing what a model can do. */
export interface ModelCapabilities {
  /** Whether the model supports incremental SSE streaming. */
  streaming: boolean;
  /** Whether the model can emit function/tool calls. */
  tool_calls: boolean;
  /** Whether the model accepts image input (vision). */
  vision: boolean;
  /** Whether the model honors structured JSON output modes. */
  json_mode: boolean;
  /** Whether the model exposes a reasoning/thinking mode; `null` if unclassified. */
  reasoning?: boolean | null;
}

/** Per-token pricing for a model. */
export interface ModelPricing {
  /** Cost per one million input tokens, in {@link ModelPricing.currency}. */
  input_per_mtok: number;
  /** Cost per one million output tokens, in {@link ModelPricing.currency}. */
  output_per_mtok: number;
  /** ISO 4217 currency code (e.g. `"USD"`). */
  currency: string;
}

/** Summary card for a model as returned by `GET /v1/models`. */
export interface ModelSummary {
  id: string;
  object: "model";
  /** Creation/registration time as Unix epoch seconds. */
  created: number;
  owned_by: ModelOwner;
  /** Human-friendly display name. */
  display_name: string;
  /** Maximum context window size in tokens. */
  context_window: number;
  /** Maximum tokens the model may generate in one response. */
  max_output_tokens: number;
  capabilities: ModelCapabilities;
  pricing: ModelPricing;
  status: ModelStatus;
}

/**
 * Full detail card for a model as returned by `GET /v1/models/{id}`. Extends
 * {@link ModelSummary} with descriptive and routing metadata; all extended
 * fields are optional because availability varies by provider.
 */
export interface Model extends ModelSummary {
  /** Long-form description of the model. */
  description?: string;
  modalities?: {
    /** Accepted input modalities (e.g. `["text", "image"]`). */
    input?: string[];
    /** Produced output modalities (e.g. `["text"]`). */
    output?: string[];
  };
  /** Names of request parameters the model honors. */
  supported_parameters?: string[];
  /** Training knowledge cutoff, as a date-like string. */
  knowledge_cutoff?: string;
  /** Public release date, as a date-like string. */
  released_at?: string;
  /** URL of upstream provider documentation. */
  documentation_url?: string;
  /** Alternate identifiers that resolve to this model. */
  aliases?: string[];
}

/** Envelope returned by `GET /v1/models`. */
export interface ModelList {
  object: "list";
  data: ModelSummary[];
}
