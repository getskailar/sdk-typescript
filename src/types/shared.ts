/**
 * Shared primitive types used across multiple Skailar API resources.
 *
 * @packageDocumentation
 */

/**
 * A string union that keeps IDE autocomplete for known members while still
 * accepting any arbitrary string.
 *
 * TypeScript collapses `"a" | "b" | string` down to `string`, which destroys
 * editor suggestions. Intersecting the open end with `Record<never, never>`
 * (spelled `string & {}`) prevents that collapse, so known literals are offered
 * as completions yet any string remains assignable. Used for model identifiers,
 * whose catalog evolves faster than this SDK is released.
 *
 * @typeParam Known - The union of literal strings to surface as autocomplete hints.
 *
 * @example
 * ```ts
 * type ModelId = LiteralUnion<"gpt-5" | "claude-opus-4-8">;
 * const a: ModelId = "gpt-5";          // autocompleted
 * const b: ModelId = "some-new-model"; // still allowed
 * ```
 */
export type LiteralUnion<Known extends string> = Known | (string & Record<never, never>);

/**
 * Token accounting returned with every completion, streamed or not.
 *
 * Mirrors the OpenAI `usage` object. On a stream each chunk carries the running
 * totals observed so far rather than a per-chunk delta.
 */
export interface Usage {
  /** Tokens consumed by the prompt (input side). */
  prompt_tokens: number;
  /** Tokens produced by the model (output side). */
  completion_tokens: number;
  /** Sum of {@link Usage.prompt_tokens} and {@link Usage.completion_tokens}. */
  total_tokens: number;
}
