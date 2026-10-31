// SPDX-License-Identifier: AGPL-3.0-only
import {
  type Access,
  EMBEDDING_PROVIDERS,
  type EmbeddingOptions,
  embedTexts,
  PROVIDER_LABEL,
  type Provider,
  withRetry,
} from "@zerodot/ai-core";
import type { Embeddings } from "./rag";

/**
 * The most texts in one call. Gemini takes 100. OpenAI takes 2048, but a service can take less.
 * The AI SDK splits a batch again when the model takes fewer texts.
 */
const BATCH_OF: Partial<Record<Provider, number>> = { openai: 256, azure: 256, gemini: 100 };
const BATCH = 64;

/** An "ai.embedding" supply. Big inputs go in batches, one batch after the other. */
export function embeddingsOf(access: Access, options: EmbeddingOptions): Embeddings {
  if (!(EMBEDDING_PROVIDERS as readonly Provider[]).includes(access.provider)) {
    throw new Error(`${PROVIDER_LABEL[access.provider]} has no embedding models`);
  }
  const size = BATCH_OF[access.provider] ?? BATCH;
  return {
    dimensions: options.dimensions,
    async embed(texts, use, signal) {
      const vectors: number[][] = [];
      for (let start = 0; start < texts.length; start += size) {
        signal.throwIfAborted();
        const batch = texts.slice(start, start + size);
        // A big insert makes many calls, so a rate limit waits and tries again.
        const found = await withRetry(
          async () => (await embedTexts(access, options, batch, use, signal)).vectors,
          signal,
        );
        for (const [index, vector] of found.entries()) {
          if (options.dimensions !== undefined && vector.length !== options.dimensions) {
            throw new Error(
              `Text ${start + index + 1} has ${vector.length} dimensions, not ${options.dimensions}`,
            );
          }
          vectors.push(vector);
        }
      }
      return vectors;
    },
  };
}
