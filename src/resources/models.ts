/**
 * The models resource, exposing `client.models.list()` and
 * `client.models.retrieve(id)`.
 *
 * @packageDocumentation
 */

import type { RequestOptions, Skailar } from "../client";
import type { Model, ModelList, ModelSummary } from "../types/models";

/** Model discovery operations. */
export class ModelsResource {
  /** The owning client used to dispatch requests. */
  private readonly client: Skailar;

  /** @param client - The owning {@link Skailar} client. */
  constructor(client: Skailar) {
    this.client = client;
  }

  /**
   * List every model the gateway can route to. Unwraps the
   * `{ object: "list", data }` envelope and returns just `data` as a plain array.
   *
   * @param options - Optional per-call signal, timeout and headers.
   * @returns A promise resolving to the array of {@link ModelSummary} cards.
   */
  async list(options?: RequestOptions): Promise<ModelSummary[]> {
    const res = await this.client.request<ModelList>({
      method: "GET",
      path: "/v1/models",
      expect: "json",
      signal: options?.signal,
      timeout: options?.timeout,
      headers: options?.headers,
    });
    return res.data;
  }

  /**
   * Retrieve the full detail card for a single model.
   *
   * @param id - The model identifier; may contain slashes (e.g.
   * `"google/gemini-2.5-pro"`), which are preserved in the path.
   * @param options - Optional per-call signal, timeout and headers.
   * @returns A promise resolving to the {@link Model} detail.
   * @throws {@link SkailarNotFoundError} If no model matches the id.
   */
  retrieve(id: string, options?: RequestOptions): Promise<Model> {
    const encoded = id.split("/").map(encodeURIComponent).join("/");
    return this.client.request<Model>({
      method: "GET",
      path: `/v1/models/${encoded}`,
      expect: "json",
      signal: options?.signal,
      timeout: options?.timeout,
      headers: options?.headers,
    });
  }
}
