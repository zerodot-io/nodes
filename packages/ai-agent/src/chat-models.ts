// SPDX-License-Identifier: AGPL-3.0-only
import { defineSupplyNode, type NodeDefinition } from "@zerodot/node-sdk";
import { z } from "zod";
import { accessOf, CREDENTIAL_OF, type Provider } from "./api";
import { AI_ICON } from "./icon";
import { chatModelOf } from "./model";
import {
  ANTHROPIC_MODELS,
  CUSTOM_MODEL,
  GEMINI_TEXT_MODELS,
  idsOf,
  type ModelEntry,
  OPENAI_TEXT_MODELS,
} from "./models";
import { KIND } from "./types";

/** The model select of a provider. The last option is Custom. */
const modelField = (models: readonly ModelEntry[], first: string) =>
  z
    .enum(idsOf(models))
    .default(first)
    .meta({
      title: "Model",
      labels: {
        ...Object.fromEntries(models.map((model) => [model.id, model.label])),
        [CUSTOM_MODEL]: "Custom",
      },
      hints: {
        ...Object.fromEntries(models.map((model) => [model.id, model.hint])),
        [CUSTOM_MODEL]: "Type any model id in Custom Model ID",
      },
    });

const customModel = z
  .string()
  .optional()
  .meta({
    showWhen: { model: [CUSTOM_MODEL] },
    title: "Custom Model ID",
    description: "A model id. The model must support tool calls",
  });

const settings = {
  maxTokens: z.number().int().min(1).optional().meta({
    title: "Max Tokens",
    description: "The most tokens of one answer",
  }),
  temperature: z.number().min(0).max(2).optional().meta({
    title: "Temperature",
    description: "Optional. Lower is more focused, higher is more varied",
  }),
  timeoutMs: z.number().int().min(1000).max(600_000).default(120_000).meta({
    title: "Timeout (ms)",
    description: "The time limit of one call to the model",
  }),
};

type Spec = {
  provider: Provider;
  label: string;
  description: string;
  models: readonly ModelEntry[];
  first: string;
};

const SPECS: Spec[] = [
  {
    provider: "openai",
    label: "OpenAI Chat Model",
    description: "A GPT model for the AI Agent",
    models: OPENAI_TEXT_MODELS,
    first: "gpt-6.1-terra",
  },
  {
    provider: "anthropic",
    label: "Anthropic Chat Model",
    description: "A Claude model for the AI Agent",
    models: ANTHROPIC_MODELS,
    first: "claude-sonnet-5-5",
  },
  {
    provider: "gemini",
    label: "Gemini Chat Model",
    description: "A Google Gemini model for the AI Agent",
    models: GEMINI_TEXT_MODELS,
    first: "gemini-3.8-flash",
  },
];

/** The chosen model id: the select, or Custom Model ID. */
function modelIdOf(model: string, custom: string | undefined): string {
  if (model !== CUSTOM_MODEL) return model;
  const id = custom?.trim();
  if (!id) throw new Error('The node needs "customModel"');
  return id;
}

const listed = SPECS.map((spec) =>
  defineSupplyNode({
    type: `agent.model.${spec.provider}`,
    label: spec.label,
    description: spec.description,
    category: "integration",
    icon: "SparklesIcon",
    iconUrl: AI_ICON,
    supplies: KIND.model,
    config: z.object({
      model: modelField(spec.models, spec.first),
      customModel,
      maxTokens: settings.maxTokens.meta({
        title: "Max Tokens",
        description:
          spec.provider === "anthropic"
            ? "The most tokens of one answer. Empty means 4096"
            : "The most tokens of one answer",
      }),
      // The current Anthropic API version has no temperature.
      ...(spec.provider === "anthropic" ? {} : { temperature: settings.temperature }),
      timeoutMs: settings.timeoutMs,
    }),
    defaultConfig: { model: spec.first, timeoutMs: 120_000 },
    credentialTypes: [CREDENTIAL_OF[spec.provider]],
    subtitle: (config) => (typeof config.model === "string" ? config.model : undefined),
    supply: ({ config, credential }) =>
      chatModelOf(accessOf(spec.provider, credential), {
        model: modelIdOf(config.model, config.customModel),
        maxTokens: config.maxTokens,
        temperature:
          "temperature" in config ? (config.temperature as number | undefined) : undefined,
        timeoutMs: config.timeoutMs,
      }),
  }),
);

const compatible = defineSupplyNode({
  type: "agent.model.compatible",
  label: "OpenAI-compatible Chat Model",
  description: "A model of a service with an OpenAI-style API, such as Ollama or a gateway",
  category: "integration",
  icon: "SparklesIcon",
  iconUrl: AI_ICON,
  supplies: KIND.model,
  config: z.object({
    model: z.string().default("").meta({
      title: "Model ID",
      description: "The model id of the service. The model must support tool calls",
    }),
    ...settings,
  }),
  defaultConfig: { model: "", timeoutMs: 120_000 },
  credentialTypes: [CREDENTIAL_OF.compatible],
  subtitle: (config) =>
    typeof config.model === "string" && config.model !== "" ? config.model : undefined,
  supply: ({ config, credential }) => {
    const model = config.model.trim();
    if (!model) throw new Error('The node needs "model"');
    return chatModelOf(accessOf("compatible", credential), {
      model,
      maxTokens: config.maxTokens,
      temperature: config.temperature,
      timeoutMs: config.timeoutMs,
    });
  },
});

export const chatModelNodes: NodeDefinition[] = [...listed, compatible];
