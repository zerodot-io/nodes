// SPDX-License-Identifier: AGPL-3.0-only
import {
  ANTHROPIC_MODELS,
  accessOf,
  BEDROCK_TEXT_MODELS,
  CREDENTIAL_OF,
  CUSTOM_MODEL,
  chatModelOf,
  DEEPSEEK_TEXT_MODELS,
  GEMINI_TEXT_MODELS,
  GROQ_TEXT_MODELS,
  idsOf,
  MISTRAL_TEXT_MODELS,
  type ModelEntry,
  OPENAI_TEXT_MODELS,
  type Provider,
  VERTEX_TEXT_MODELS,
  XAI_TEXT_MODELS,
} from "@zerodot/ai-core";
import type { NodeDefinition } from "@zerodot/node-sdk";
import { z } from "zod";
import {
  AI_ICON,
  ANTHROPIC_ICON,
  AZURE_ICON,
  BEDROCK_ICON,
  DEEPSEEK_ICON,
  GEMINI_ICON,
  GROQ_ICON,
  MISTRAL_ICON,
  OLLAMA_ICON,
  OPENAI_ICON,
  OPENROUTER_ICON,
  VERTEX_ICON,
  XAI_ICON,
} from "./icon";
import { defineSupplyNode } from "./supply";
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
  iconUrl: string;
};

const SPECS: Spec[] = [
  {
    provider: "openai",
    label: "OpenAI Chat Model",
    description: "A GPT model for the AI Agent",
    models: OPENAI_TEXT_MODELS,
    first: "gpt-6.1-terra",
    iconUrl: OPENAI_ICON,
  },
  {
    provider: "anthropic",
    label: "Anthropic Chat Model",
    description: "A Claude model for the AI Agent",
    models: ANTHROPIC_MODELS,
    first: "claude-sonnet-5-5",
    iconUrl: ANTHROPIC_ICON,
  },
  {
    provider: "gemini",
    label: "Gemini Chat Model",
    description: "A Google Gemini model for the AI Agent",
    models: GEMINI_TEXT_MODELS,
    first: "gemini-3.8-flash",
    iconUrl: GEMINI_ICON,
  },
  {
    provider: "mistral",
    label: "Mistral Chat Model",
    description: "A Mistral AI model for the AI Agent",
    models: MISTRAL_TEXT_MODELS,
    first: "mistral-large-latest",
    iconUrl: MISTRAL_ICON,
  },
  {
    provider: "groq",
    label: "Groq Chat Model",
    description: "An open model on Groq for the AI Agent",
    models: GROQ_TEXT_MODELS,
    first: "openai/gpt-oss-120b",
    iconUrl: GROQ_ICON,
  },
  {
    provider: "xai",
    label: "xAI Grok Chat Model",
    description: "A Grok model for the AI Agent",
    models: XAI_TEXT_MODELS,
    first: "grok-4.7",
    iconUrl: XAI_ICON,
  },
  {
    provider: "deepseek",
    label: "DeepSeek Chat Model",
    description: "A DeepSeek model for the AI Agent",
    models: DEEPSEEK_TEXT_MODELS,
    first: "deepseek-v4-flash",
    iconUrl: DEEPSEEK_ICON,
  },
  {
    provider: "bedrock",
    label: "AWS Bedrock Chat Model",
    description: "A model on Amazon Bedrock, such as Claude or Nova, for the AI Agent",
    models: BEDROCK_TEXT_MODELS,
    first: "us.anthropic.claude-sonnet-5-5",
    iconUrl: BEDROCK_ICON,
  },
  {
    provider: "vertex",
    label: "Google Vertex Chat Model",
    description: "A Gemini model on Google Cloud Vertex AI for the AI Agent",
    models: VERTEX_TEXT_MODELS,
    first: "gemini-3.8-flash",
    iconUrl: VERTEX_ICON,
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
    iconUrl: spec.iconUrl,
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

type TypedSpec = {
  provider: "compatible" | "openrouter" | "ollama" | "azure";
  label: string;
  description: string;
  modelTitle: string;
  modelHint: string;
  iconUrl: string;
};

/** These providers have no model list. The user types the model id. */
const TYPED: TypedSpec[] = [
  {
    provider: "compatible",
    label: "OpenAI-compatible Chat Model",
    description: "A model of a service with an OpenAI-style API, such as a gateway",
    modelTitle: "Model ID",
    modelHint: "The model id of the service. The model must support tool calls",
    iconUrl: AI_ICON,
  },
  {
    provider: "openrouter",
    label: "OpenRouter Chat Model",
    description: "A model of any provider on OpenRouter, for the AI Agent",
    modelTitle: "Model ID",
    modelHint:
      "An OpenRouter model id, such as anthropic/claude-sonnet-5.5. It must support tool calls",
    iconUrl: OPENROUTER_ICON,
  },
  {
    provider: "ollama",
    label: "Ollama Chat Model",
    description: "A local model on Ollama for the AI Agent",
    modelTitle: "Model",
    modelHint: "The name of a model that Ollama has, such as qwen3. It must support tool calls",
    iconUrl: OLLAMA_ICON,
  },
  {
    provider: "azure",
    label: "Azure OpenAI Chat Model",
    description: "An OpenAI model on Azure for the AI Agent",
    modelTitle: "Deployment Name",
    modelHint: "The name of the model deployment in the Azure resource",
    iconUrl: AZURE_ICON,
  },
];

const typed = TYPED.map((spec) =>
  defineSupplyNode({
    type: `agent.model.${spec.provider}`,
    label: spec.label,
    description: spec.description,
    category: "integration",
    icon: "SparklesIcon",
    iconUrl: spec.iconUrl,
    supplies: KIND.model,
    config: z.object({
      model: z.string().default("").meta({ title: spec.modelTitle, description: spec.modelHint }),
      ...settings,
    }),
    defaultConfig: { model: "", timeoutMs: 120_000 },
    credentialTypes: [CREDENTIAL_OF[spec.provider]],
    subtitle: (config) =>
      typeof config.model === "string" && config.model !== "" ? config.model : undefined,
    supply: ({ config, credential }) => {
      const model = config.model.trim();
      if (!model) throw new Error('The node needs "model"');
      return chatModelOf(accessOf(spec.provider, credential), {
        model,
        maxTokens: config.maxTokens,
        temperature: config.temperature,
        timeoutMs: config.timeoutMs,
      });
    },
  }),
);

export const chatModelNodes: NodeDefinition[] = [...listed, ...typed];
