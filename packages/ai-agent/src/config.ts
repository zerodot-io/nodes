// SPDX-License-Identifier: AGPL-3.0-only
import type { FieldSpec } from "@zerodot/node-sdk";
import { z } from "zod";
import { PROVIDERS, type Provider } from "./api";
import {
  ANTHROPIC_MODELS,
  CUSTOM_MODEL,
  GEMINI_TEXT_MODELS,
  idsOf,
  type ModelEntry,
  OPENAI_TEXT_MODELS,
} from "./models";

export const PROVIDER_OPTIONS = [
  { id: "openai", label: "OpenAI", hint: "GPT models" },
  { id: "anthropic", label: "Anthropic", hint: "Claude models" },
  { id: "gemini", label: "Google Gemini", hint: "Gemini models" },
  {
    id: "compatible",
    label: "OpenAI-compatible",
    hint: "Any service with an OpenAI-style API, such as Ollama or a gateway",
  },
] as const satisfies readonly { id: Provider; label: string; hint: string }[];

/** Labels and hints for the model select of one provider. The last option is Custom. */
const modelMeta = (provider: Provider, models: readonly ModelEntry[]) => ({
  showWhen: { provider: [provider] },
  title: "Model",
  labels: {
    ...Object.fromEntries(models.map((model) => [model.id, model.label])),
    [CUSTOM_MODEL]: "Custom",
  },
  hints: {
    ...Object.fromEntries(models.map((model) => [model.id, model.hint])),
    [CUSTOM_MODEL]: "Type any model id in Custom Model",
  },
});

export const toolsSpec: FieldSpec = {
  name: "tools",
  label: "Tools",
  kind: "fixed",
  multiple: true,
  description: "What the agent can do. The model reads the name and the description of each tool",
  groups: [
    {
      name: "workflow",
      label: "Workflow",
      fields: [
        {
          name: "name",
          label: "Name",
          kind: "string",
          placeholder: "e.g. find_customer",
          description: "Letters, digits, _ and -. Each tool needs its own name",
        },
        {
          name: "description",
          label: "Description",
          kind: "string",
          multiline: true,
          description: "What the tool does and when to use it",
        },
        {
          name: "workflowId",
          label: "Workflow ID",
          kind: "string",
          description:
            "The workflow to run. Its trigger input is the input from the model. End it with one last node: its output is the result. It must be published, and it cannot wait",
        },
        {
          name: "inputSchema",
          label: "Input Schema",
          kind: "string",
          multiline: true,
          placeholder: '{"type":"object","properties":{"email":{"type":"string"}}}',
          description: "Optional. A JSON Schema with type object. Empty means any object",
        },
      ],
    },
    {
      name: "mcp",
      label: "MCP Server",
      fields: [
        {
          name: "name",
          label: "Name",
          kind: "string",
          placeholder: "e.g. docs",
          description: "A short name. The tools are <name>__<tool>",
        },
        {
          name: "url",
          label: "URL",
          kind: "string",
          placeholder: "https://example.com/mcp",
          description: "A Streamable HTTP endpoint",
        },
        { name: "headerName", label: "Header Name", kind: "string", placeholder: "Authorization" },
        {
          name: "headerValue",
          label: "Header Value",
          kind: "string",
          description: "Use a variable for a secret, such as {{ $vars.DOCS_TOKEN }}",
        },
        {
          name: "only",
          label: "Only These Tools",
          kind: "string",
          description: "Optional. Tool names with commas between them. Empty means all tools",
        },
      ],
    },
  ],
};

const MEMORY_TABLE_RULE = { memory: ["table"] };

export const agentConfig = z.object({
  provider: z
    .enum(PROVIDERS)
    .default("openai")
    .meta({
      title: "Provider",
      labels: Object.fromEntries(PROVIDER_OPTIONS.map((option) => [option.id, option.label])),
      hints: Object.fromEntries(PROVIDER_OPTIONS.map((option) => [option.id, option.hint])),
    }),
  openaiModel: z
    .enum(idsOf(OPENAI_TEXT_MODELS))
    .default("gpt-6.1-terra")
    .meta(modelMeta("openai", OPENAI_TEXT_MODELS)),
  anthropicModel: z
    .enum(idsOf(ANTHROPIC_MODELS))
    .default("claude-sonnet-5-5")
    .meta(modelMeta("anthropic", ANTHROPIC_MODELS)),
  geminiModel: z
    .enum(idsOf(GEMINI_TEXT_MODELS))
    .default("gemini-3.8-flash")
    .meta(modelMeta("gemini", GEMINI_TEXT_MODELS)),
  customModel: z
    .string()
    .optional()
    .meta({
      showWhen: [
        { provider: ["openai"], openaiModel: [CUSTOM_MODEL] },
        { provider: ["anthropic"], anthropicModel: [CUSTOM_MODEL] },
        { provider: ["gemini"], geminiModel: [CUSTOM_MODEL] },
        { provider: ["compatible"] },
      ],
      title: "Custom Model ID",
      description: "A model id. The model must support tool calls",
    }),
  systemPrompt: z.string().optional().meta({
    ui: "textarea",
    title: "System Prompt",
    description: "Rules for the agent. For example its role, its tone, and when to use each tool",
  }),
  prompt: z.string().default("").meta({
    title: "Prompt",
    ui: "textarea",
    description: "The message to the agent, such as {{ $input.message }}",
  }),
  tools: z.record(z.string(), z.unknown()).optional().meta({
    title: "Tools",
    ui: "field-collection",
    fieldSpec: toolsSpec,
  }),
  memory: z
    .enum(["none", "table"])
    .default("none")
    .meta({
      title: "Memory",
      labels: { none: "None", table: "Data Table" },
      hints: {
        none: "Each run starts a new conversation",
        table: "Keeps the conversation in a data table of the project",
      },
    }),
  memoryTable: z.string().optional().meta({
    showWhen: MEMORY_TABLE_RULE,
    title: "Table",
    description: 'The ID or the name of a table with the text columns "sessionId" and "messages"',
  }),
  sessionId: z.string().optional().meta({
    showWhen: MEMORY_TABLE_RULE,
    title: "Session ID",
    description: "One conversation, such as {{ $input.chatId }}",
  }),
  memoryTurns: z.number().int().min(1).max(100).default(10).meta({
    showWhen: MEMORY_TABLE_RULE,
    title: "Turns to Remember",
    description: "How many earlier runs of the session the agent reads",
  }),
  trimMemory: z.boolean().default(false).meta({
    showWhen: MEMORY_TABLE_RULE,
    title: "Delete Older Turns",
    description: "Delete the turns of the session that are older than the turns to remember",
  }),
  history: z.unknown().optional().meta({
    title: "Previous Messages",
    description:
      'Optional. The "history" of an earlier agent run, such as {{ $input.history }}. It replaces the memory as the earlier messages',
  }),
  maxIterations: z.number().int().min(1).max(50).default(10).meta({
    title: "Max Model Calls",
    description: "The agent stops after this many calls to the model",
  }),
  maxTokens: z.number().int().min(1).optional().meta({
    title: "Max Tokens",
    description:
      "The most tokens of one answer. Anthropic needs it, and uses 4096 when it is empty",
  }),
  temperature: z
    .number()
    .min(0)
    .max(2)
    .optional()
    .meta({
      hideWhen: { provider: ["anthropic"] },
      title: "Temperature",
      description: "Optional. Lower is more focused, higher is more varied",
    }),
  maxResultChars: z.number().int().min(100).max(200_000).default(20_000).meta({
    title: "Max Tool Result Length",
    description: "A longer tool result is cut to this many characters",
  }),
  timeoutMs: z.number().int().min(1000).max(600_000).default(120_000).meta({
    title: "Timeout (ms)",
    description: "The time limit of one model call or one MCP call",
  }),
});

export type AgentConfig = z.output<typeof agentConfig>;

/** The model id that the config chooses. */
export function modelOf(c: AgentConfig): string {
  const chosen =
    c.provider === "openai"
      ? c.openaiModel
      : c.provider === "anthropic"
        ? c.anthropicModel
        : c.provider === "gemini"
          ? c.geminiModel
          : CUSTOM_MODEL;
  if (chosen !== CUSTOM_MODEL) return chosen;
  const custom = c.customModel?.trim();
  if (!custom) throw new Error('The node needs "customModel"');
  return custom;
}
