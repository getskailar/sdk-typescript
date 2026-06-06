/**
 * Public entry point of the Skailar TypeScript SDK.
 *
 * Exports {@link Skailar} as both the default and a named export, the full typed
 * error hierarchy, the {@link ChatCompletionStream} helper, and every public
 * request/response type.
 *
 * @example Default import
 * ```ts
 * import Skailar from "@skailar-ai/sdk";
 * const client = new Skailar({ apiKey: "skl_live_..." });
 * ```
 *
 * @example Named imports
 * ```ts
 * import { Skailar, SkailarError, SkailarRateLimitError } from "@skailar-ai/sdk";
 * ```
 *
 * @packageDocumentation
 */

import { Skailar } from "./client";

export { Skailar };
export type { SkailarOptions } from "./client";

export default Skailar;

export {
  SkailarError,
  SkailarAPIError,
  SkailarAuthError,
  SkailarBadRequestError,
  SkailarNotFoundError,
  SkailarRateLimitError,
  SkailarUpstreamError,
  SkailarConnectionError,
} from "./errors";
export type { ParsedErrorBody } from "./errors";

export { ChatCompletionStream, parseSSE } from "./streaming";

export type * from "./types/index";
