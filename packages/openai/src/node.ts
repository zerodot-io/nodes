// SPDX-License-Identifier: AGPL-3.0-only
import { defineNode } from "@zerodot/node-sdk";
import { callOpenAI, OPENAI_CREDENTIAL, openaiAccess } from "./api";
import { openaiConfig } from "./config";
import { OPENAI_ICON } from "./icon";
import { buildRequest, resultOf } from "./request";

export default defineNode({
  type: "openai.api",
  label: "OpenAI",
  description:
    "Write text, make embeddings and images, check content, and transcribe audio with OpenAI",
  category: "integration",
  app: "OpenAI",
  // The names of the actions of the OpenAI node.
  actions: [
    { label: "Generate text", config: { resource: "text", operation: "generate" } },
    { label: "Create an embedding", config: { resource: "embedding", operation: "create" } },
    { label: "Generate an image", config: { resource: "image", operation: "generate" } },
    { label: "Edit an image", config: { resource: "image", operation: "edit" } },
    { label: "Check content", config: { resource: "moderation", operation: "check" } },
    { label: "Transcribe audio", config: { resource: "audio", operation: "transcribe" } },
    { label: "Translate audio to English", config: { resource: "audio", operation: "translate" } },
    { label: "Turn text into speech", config: { resource: "audio", operation: "speak" } },
    { label: "Upload a file", config: { resource: "file", operation: "upload" } },
    { label: "List files", config: { resource: "file", operation: "list" } },
    { label: "Delete a file", config: { resource: "file", operation: "delete" } },
    { label: "List models", config: { resource: "model", operation: "list" } },
  ],
  icon: "Sparkles",
  iconUrl: OPENAI_ICON,
  config: openaiConfig,
  defaultConfig: {
    resource: "text",
    operation: "generate",
    textModel: "gpt-6.1-terra",
    systemPrompt: "",
    prompt: "",
    responseFormat: "text",
    timeoutMs: 120_000,
  },
  credentialTypes: [OPENAI_CREDENTIAL],
  ports: { in: ["in"], out: ["out"] },
  subtitle: (config) =>
    typeof config.operation === "string"
      ? `${String(config.resource ?? "text")}: ${config.operation}`
      : undefined,
  async run({ config, input, credential, signal }) {
    const access = openaiAccess(credential);
    const call = buildRequest(config, input);
    const answer = await callOpenAI(access, call, { signal, timeoutMs: config.timeoutMs });
    return { port: "out", data: resultOf(config, answer) };
  },
});
