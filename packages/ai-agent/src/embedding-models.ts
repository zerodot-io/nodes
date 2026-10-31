// SPDX-License-Identifier: AGPL-3.0-only
import type { NodeDefinition } from "@zerodot/node-sdk";
import { z } from "zod";
import { accessOf, CREDENTIAL_OF } from "./api";
import { embeddingsOf } from "./embedding";
import { AI_ICON, GEMINI_ICON, OPENAI_ICON } from "./icon";
import {
  CUSTOM_MODEL,
  GEMINI_EMBEDDING_MODELS,
  idsOf,
  type ModelEntry,
  OPENAI_EMBEDDING_MODELS,
} from "./models";
import { defineSupplyNode } from "./supply";
import { KIND } from "./types";

const settings = {
  dimensions: z.number().int().min(1).max(8192).optional().meta({
    title: "Dimensions",
    description:
      "Optional. The length of each vector. It must be the same as the vector store. Empty means the model default",
  }),
  timeoutMs: z.number().int().min(1000).max(600_000).default(60_000).meta({
    title: "Timeout (ms)",
    description: "The time limit of one call to the model",
  }),
};

type Spec = {
  provider: "openai" | "gemini";
  label: string;
  description: string;
  models: readonly ModelEntry[];
  first: string;
  iconUrl: string;
};

const SPECS: Spec[] = [
  {
    provider: "openai",
    label: "OpenAI Embeddings",
    description: "An OpenAI embedding model for a vector store",
    models: OPENAI_EMBEDDING_MODELS,
    first: "text-embedding-3-small",
    iconUrl: OPENAI_ICON,
  },
  {
    provider: "gemini",
    label: "Gemini Embeddings",
    description: "A Google Gemini embedding model for a vector store",
    models: GEMINI_EMBEDDING_MODELS,
    first: "gemini-embedding-2",
    iconUrl: GEMINI_ICON,
  },
];

const listed = SPECS.map((spec) =>
  defineSupplyNode({
    type: `agent.embedding.${spec.provider}`,
    label: spec.label,
    description: spec.description,
    category: "integration",
    icon: "SparklesIcon",
    iconUrl: spec.iconUrl,
    supplies: KIND.embedding,
    config: z.object({
      model: z
        .enum(idsOf(spec.models))
        .default(spec.first)
        .meta({
          title: "Model",
          labels: {
            ...Object.fromEntries(spec.models.map((model) => [model.id, model.label])),
            [CUSTOM_MODEL]: "Custom",
          },
          hints: {
            ...Object.fromEntries(spec.models.map((model) => [model.id, model.hint])),
            [CUSTOM_MODEL]: "Type any model id in Custom Model ID",
          },
        }),
      customModel: z
        .string()
        .optional()
        .meta({
          showWhen: { model: [CUSTOM_MODEL] },
          title: "Custom Model ID",
          description: "An embedding model id",
        }),
      ...settings,
    }),
    defaultConfig: { model: spec.first, timeoutMs: 60_000 },
    credentialTypes: [CREDENTIAL_OF[spec.provider]],
    subtitle: (config) => (typeof config.model === "string" ? config.model : undefined),
    supply: ({ config, credential }) => {
      const model = config.model === CUSTOM_MODEL ? config.customModel?.trim() : config.model;
      if (!model) throw new Error('The node needs "customModel"');
      return embeddingsOf(accessOf(spec.provider, credential), {
        model,
        dimensions: config.dimensions,
        timeoutMs: config.timeoutMs,
      });
    },
  }),
);

const compatible = defineSupplyNode({
  type: "agent.embedding.compatible",
  label: "OpenAI-compatible Embeddings",
  description: "An embedding model of a service with an OpenAI-style API, such as Ollama",
  category: "integration",
  icon: "SparklesIcon",
  iconUrl: AI_ICON,
  supplies: KIND.embedding,
  config: z.object({
    model: z.string().default("").meta({
      title: "Model ID",
      description: "The embedding model id of the service, such as nomic-embed-text",
    }),
    ...settings,
  }),
  defaultConfig: { model: "", timeoutMs: 60_000 },
  credentialTypes: [CREDENTIAL_OF.compatible],
  subtitle: (config) =>
    typeof config.model === "string" && config.model !== "" ? config.model : undefined,
  supply: ({ config, credential }) => {
    const model = config.model.trim();
    if (!model) throw new Error('The node needs "model"');
    return embeddingsOf(accessOf("compatible", credential), {
      model,
      dimensions: config.dimensions,
      timeoutMs: config.timeoutMs,
    });
  },
});

export const embeddingNodes: NodeDefinition[] = [...listed, compatible];
