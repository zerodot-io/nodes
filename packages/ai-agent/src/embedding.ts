// SPDX-License-Identifier: AGPL-3.0-only
import { isRecord } from "@zerodot/node-sdk";
import { type Access, callApi } from "./api";
import type { Embeddings, EmbeddingUse } from "./rag";
import { withRetry } from "./retry";

export type EmbeddingOptions = { model: string; dimensions?: number; timeoutMs: number };

/** The most texts in one call. Gemini takes 100. OpenAI takes 2048, but a service can take less. */
const BATCH_OF = { openai: 256, gemini: 100, compatible: 64, anthropic: 0 } as const;

/** The Gemini task type of each use. */
const TASK_OF = { document: "RETRIEVAL_DOCUMENT", query: "RETRIEVAL_QUERY" } as const;

/** A vector of numbers, or an error that names the text. */
function vectorOf(value: unknown, index: number): number[] {
  if (!Array.isArray(value) || !value.every((entry) => typeof entry === "number")) {
    throw new Error(`The answer has no vector for text ${index + 1}`);
  }
  return value;
}

/** The vectors of one batch, in the order of the texts. */
async function embedBatch(
  access: Access,
  options: EmbeddingOptions,
  texts: string[],
  use: EmbeddingUse,
  signal: AbortSignal,
): Promise<number[][]> {
  const call = { signal, timeoutMs: options.timeoutMs };
  if (access.provider === "gemini") {
    const model = `models/${options.model.replace(/^models\//, "")}`;
    const answer = await callApi(
      access,
      {
        method: "POST",
        path: `/${model}:batchEmbedContents`,
        json: {
          requests: texts.map((text) => ({
            model,
            content: { parts: [{ text }] },
            embedContentConfig: {
              taskType: TASK_OF[use],
              ...(options.dimensions === undefined
                ? {}
                : { outputDimensionality: options.dimensions }),
            },
          })),
        },
      },
      call,
    );
    const found = Array.isArray(answer.embeddings) ? answer.embeddings : [];
    return texts.map((_, index) => {
      const entry = found[index];
      return vectorOf(isRecord(entry) ? entry.values : undefined, index);
    });
  }
  const answer = await callApi(
    access,
    {
      method: "POST",
      path: "/embeddings",
      json: {
        model: options.model,
        input: texts,
        // Some compatible services do not accept the field, so it goes only when it is set.
        ...(options.dimensions === undefined ? {} : { dimensions: options.dimensions }),
      },
    },
    call,
  );
  const vectors: unknown[] = [];
  for (const [position, entry] of (Array.isArray(answer.data) ? answer.data : []).entries()) {
    if (!isRecord(entry)) continue;
    vectors[typeof entry.index === "number" ? entry.index : position] = entry.embedding;
  }
  return texts.map((_, index) => vectorOf(vectors[index], index));
}

/** An "ai.embedding" supply. Big inputs go in batches, one batch after the other. */
export function embeddingsOf(access: Access, options: EmbeddingOptions): Embeddings {
  if (access.provider === "anthropic") throw new Error("Anthropic has no embedding models");
  const size = BATCH_OF[access.provider];
  return {
    dimensions: options.dimensions,
    async embed(texts, use, signal) {
      const vectors: number[][] = [];
      for (let start = 0; start < texts.length; start += size) {
        signal.throwIfAborted();
        const batch = texts.slice(start, start + size);
        // A big insert makes many calls, so a rate limit waits and tries again.
        const found = await withRetry(
          () => embedBatch(access, options, batch, use, signal),
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
