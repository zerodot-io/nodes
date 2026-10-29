// SPDX-License-Identifier: AGPL-3.0-only
import { defineNode } from "@zerodot/node-sdk";
import { accessOf, CREDENTIAL_OF, callApi, callList, MAX_ITEMS } from "./api";
import { aiConfig } from "./config";
import { AI_ICON } from "./icon";
import { buildRequest, resultOf } from "./request";

export default defineNode({
  type: "ai.api",
  label: "AI",
  description:
    "Write text, call tools, make embeddings and images, and manage files with OpenAI, Anthropic, Google Gemini, or a compatible service",
  category: "integration",
  app: "AI",
  // The names of the actions of the AI node.
  actions: [
    { label: "Generate text", config: { resource: "text", operation: "generate" } },
    { label: "Count tokens", config: { resource: "text", operation: "countTokens" } },
    { label: "Create an embedding", config: { resource: "embedding", operation: "create" } },
    { label: "Generate an image", config: { resource: "image", operation: "generate" } },
    { label: "Edit an image", config: { resource: "image", operation: "edit" } },
    { label: "Check content", config: { resource: "moderation", operation: "check" } },
    { label: "Transcribe audio", config: { resource: "audio", operation: "transcribe" } },
    { label: "Translate audio to English", config: { resource: "audio", operation: "translate" } },
    { label: "Turn text into speech", config: { resource: "audio", operation: "speak" } },
    { label: "Upload a file", config: { resource: "file", operation: "upload" } },
    { label: "Get a file", config: { resource: "file", operation: "get" } },
    { label: "List files", config: { resource: "file", operation: "list" } },
    { label: "Delete a file", config: { resource: "file", operation: "delete" } },
    { label: "Create a conversation", config: { resource: "conversation", operation: "create" } },
    { label: "Get a conversation", config: { resource: "conversation", operation: "get" } },
    { label: "Update a conversation", config: { resource: "conversation", operation: "update" } },
    { label: "Delete a conversation", config: { resource: "conversation", operation: "delete" } },
    {
      label: "Add conversation items",
      config: { resource: "conversationItem", operation: "add" },
    },
    {
      label: "List conversation items",
      config: { resource: "conversationItem", operation: "list" },
    },
    {
      label: "Get a conversation item",
      config: { resource: "conversationItem", operation: "get" },
    },
    {
      label: "Delete a conversation item",
      config: { resource: "conversationItem", operation: "delete" },
    },
    { label: "List models", config: { resource: "model", operation: "list" } },
  ],
  icon: "Sparkles",
  iconUrl: AI_ICON,
  config: aiConfig,
  defaultConfig: {
    provider: "openai",
    resource: "text",
    operation: "generate",
    openaiTextModel: "gpt-6.1-terra",
    systemPrompt: "",
    prompt: "",
    responseFormat: "text",
    returnAll: false,
    limit: 20,
    timeoutMs: 120_000,
  },
  credentialTypes: Object.values(CREDENTIAL_OF),
  // The Provider field says which credential type the user picks.
  credentialRules: Object.fromEntries(
    Object.entries(CREDENTIAL_OF).map(([provider, type]) => [
      type,
      { showWhen: { provider: [provider] } },
    ]),
  ),
  ports: { in: ["in"], out: ["out"] },
  subtitle: (config) =>
    typeof config.operation === "string"
      ? `${String(config.provider ?? "openai")}: ${String(config.resource ?? "text")}.${config.operation}`
      : undefined,
  async run({ config, input, credential, signal }) {
    const access = accessOf(config.provider, credential);
    const options = { signal, timeoutMs: config.timeoutMs };
    const request = buildRequest(config, input);

    if (request.list) {
      const items = await callList(
        access,
        request.call.path,
        request.list.itemsKey,
        request.list.limit ?? MAX_ITEMS,
        options,
      );
      return { port: "out", data: resultOf(config, { data: items }) };
    }

    const answer = await callApi(access, request.call, options);
    return { port: "out", data: resultOf(config, answer) };
  },
});
