// SPDX-License-Identifier: AGPL-3.0-only
import { CUSTOM_MODEL, idsOf, type ModelEntry, StatusError, withRetry } from "@zerodot/ai-core";
import {
  type CredentialTypeDefinition,
  isRecord,
  type ResolvedCredential,
} from "@zerodot/node-sdk";
import { z } from "zod";
import { RERANKER_ICON } from "./icon";
import { RAG_KIND, type Ranked, type Reranker } from "./rag";
import { defineSupplyNode } from "./supply";

export const COHERE_CREDENTIAL = "cohere";
const COHERE_URL = "https://api.cohere.com";
const TEST_TIMEOUT_MS = 10_000;

// Cohere: https://docs.cohere.com/docs/rerank. Checked on 2026-10-31.

export const COHERE_RERANK_MODELS = [
  { id: "rerank-v4.0-pro", label: "Rerank 4.0 Pro", hint: "The best quality" },
  { id: "rerank-v4.0-fast", label: "Rerank 4.0 Fast", hint: "Fast, for high volume" },
  { id: "rerank-v3.5", label: "Rerank 3.5", hint: "The previous model" },
] as const satisfies readonly ModelEntry[];

type CohereAccess = { apiKey: string; baseUrl: string };

function cohereAccess(credential: Pick<ResolvedCredential, "type" | "data"> | null): CohereAccess {
  if (credential?.type !== COHERE_CREDENTIAL) throw new Error("The node needs a Cohere credential");
  const apiKey = typeof credential.data.apiKey === "string" ? credential.data.apiKey.trim() : "";
  if (!apiKey) throw new Error('The credential has no "apiKey"');
  const base =
    typeof credential.data.baseUrl === "string" && credential.data.baseUrl.trim()
      ? credential.data.baseUrl.trim()
      : COHERE_URL;
  if (!base.startsWith("https://")) throw new Error('"baseUrl" must start with https://');
  return { apiKey, baseUrl: base.replace(/\/+$/, "") };
}

type Answer = { message?: string; results?: unknown };

/** One JSON call to Cohere. An error status gives an error with the message of Cohere. */
async function callCohere(
  access: CohereAccess,
  method: "GET" | "POST",
  path: string,
  json: Record<string, unknown> | undefined,
  signal: AbortSignal,
): Promise<Answer> {
  const response = await fetch(`${access.baseUrl}${path}`, {
    method,
    headers: {
      accept: "application/json",
      authorization: `Bearer ${access.apiKey}`,
      ...(json ? { "content-type": "application/json" } : {}),
    },
    body: json ? JSON.stringify(json) : undefined,
    redirect: "error",
    signal,
  });
  const answer = (await response.json().catch(() => null)) as Answer | null;
  if (!response.ok) {
    const hint =
      response.status === 401
        ? ". Cohere did not accept the API key"
        : response.status === 429
          ? ". Cohere limits the requests. Try again later"
          : "";
    const message = answer?.message ? `. ${answer.message}` : "";
    throw new StatusError(
      `Cohere ${method} ${path} failed (${response.status})${message}${hint}`,
      response.status,
    );
  }
  return answer ?? {};
}

export const cohereCredential: CredentialTypeDefinition = {
  type: COHERE_CREDENTIAL,
  label: "Cohere API key",
  fields: z.object({
    /** From the API keys page of the Cohere dashboard. */
    apiKey: z.string().min(1),
    /** Optional. For a proxy. Default: https://api.cohere.com */
    baseUrl: z.string().optional().meta({ placeholder: "https://api.cohere.com (optional)" }),
  }),
  secretFields: ["apiKey"],
  icon: "SortingDownIcon",
  iconUrl: RERANKER_ICON,
  test: async (credential) => {
    await callCohere(
      cohereAccess(credential),
      "GET",
      "/v1/models?page_size=1",
      undefined,
      AbortSignal.timeout(TEST_TIMEOUT_MS),
    );
  },
};

export type RerankOptions = { model: string; timeoutMs: number };

/** An "ai.reranker" supply with a Cohere model. */
export function cohereReranker(access: CohereAccess, options: RerankOptions): Reranker {
  return {
    async rerank(query, texts, topN, signal) {
      if (texts.length === 0) return [];
      const answer = await withRetry(
        () =>
          callCohere(
            access,
            "POST",
            "/v2/rerank",
            { model: options.model, query, documents: texts, top_n: topN },
            AbortSignal.any([signal, AbortSignal.timeout(options.timeoutMs)]),
          ),
        signal,
      );
      const ranked: Ranked[] = [];
      for (const entry of Array.isArray(answer.results) ? answer.results : []) {
        if (!isRecord(entry)) continue;
        const { index, relevance_score: score } = entry;
        if (typeof index === "number" && typeof score === "number") ranked.push({ index, score });
      }
      return ranked;
    },
  };
}

export const cohereRerankerNode = defineSupplyNode({
  type: "agent.reranker.cohere",
  label: "Reranker Cohere",
  description: "Orders the chunks of a vector store search by relevance to the query",
  category: "integration",
  icon: "SortingDownIcon",
  iconUrl: RERANKER_ICON,
  supplies: RAG_KIND.reranker,
  config: z.object({
    model: z
      .enum(idsOf(COHERE_RERANK_MODELS))
      .default("rerank-v4.0-fast")
      .meta({
        title: "Model",
        labels: {
          ...Object.fromEntries(COHERE_RERANK_MODELS.map((model) => [model.id, model.label])),
          [CUSTOM_MODEL]: "Custom",
        },
        hints: {
          ...Object.fromEntries(COHERE_RERANK_MODELS.map((model) => [model.id, model.hint])),
          [CUSTOM_MODEL]: "Type any model id in Custom Model ID",
        },
      }),
    customModel: z
      .string()
      .optional()
      .meta({
        showWhen: { model: [CUSTOM_MODEL] },
        title: "Custom Model ID",
        description: "A Cohere rerank model id",
      }),
    timeoutMs: z.number().int().min(1000).max(300_000).default(30_000).meta({
      title: "Timeout (ms)",
      description: "The time limit of one call to Cohere",
    }),
  }),
  defaultConfig: { model: "rerank-v4.0-fast", timeoutMs: 30_000 },
  credentialTypes: [COHERE_CREDENTIAL],
  subtitle: (config) => (typeof config.model === "string" ? config.model : undefined),
  supply: ({ config, credential }) => {
    const model = config.model === CUSTOM_MODEL ? config.customModel?.trim() : config.model;
    if (!model) throw new Error('The node needs "customModel"');
    return cohereReranker(cohereAccess(credential), { model, timeoutMs: config.timeoutMs });
  },
});
