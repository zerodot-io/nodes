// SPDX-License-Identifier: AGPL-3.0-only
import { type Access, signalOf } from "./access";
import { sdkCall } from "./errors";
import { embeddingModelOf } from "./providers";

/** What the vectors are for. Some providers make better vectors when they know it. */
export type EmbeddingUse = "document" | "query";

export type EmbeddingOptions = { model: string; dimensions?: number; timeoutMs: number };

/** The Gemini task type of each use. */
const TASK_OF = { document: "RETRIEVAL_DOCUMENT", query: "RETRIEVAL_QUERY" } as const;

/** A vector of numbers, or an error that names the text. */
function vectorOf(value: unknown, index: number): number[] {
  if (!Array.isArray(value) || !value.every((entry) => typeof entry === "number")) {
    throw new Error(`The answer has no vector for text ${index + 1}`);
  }
  return value;
}

/**
 * The vectors of the texts, in the order of the texts, with one call (or a few, when the model
 * takes fewer texts in one call). The AI SDK does not try again: the caller decides.
 */
export async function embedTexts(
  access: Access,
  options: EmbeddingOptions,
  texts: string[],
  use: EmbeddingUse | undefined,
  signal: AbortSignal,
) {
  const { embedMany } = await import("ai");
  const model = await embeddingModelOf(access, options.model);
  const result = await sdkCall(access.provider, "embeddings", () =>
    embedMany({
      model,
      values: texts,
      dimensions: options.dimensions,
      providerOptions:
        access.provider === "gemini" && use ? { google: { taskType: TASK_OF[use] } } : undefined,
      maxParallelCalls: 1,
      maxRetries: 0,
      abortSignal: signalOf({ signal, timeoutMs: options.timeoutMs }),
    }),
  );
  return {
    vectors: texts.map((_, index) => vectorOf(result.embeddings[index], index)),
    usage: result.usage,
    bodies: (result.responses ?? []).map((response) => response?.body),
  };
}
