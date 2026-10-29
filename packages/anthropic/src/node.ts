// SPDX-License-Identifier: AGPL-3.0-only
import { defineNode } from "@zerodot/node-sdk";
import {
  ANTHROPIC_CREDENTIAL,
  anthropicAccess,
  callAnthropic,
  callAnthropicList,
  textOf,
} from "./api";
import { anthropicConfig } from "./config";
import { ANTHROPIC_ICON } from "./icon";
import { buildRequest } from "./request";

export default defineNode({
  type: "anthropic.api",
  label: "Anthropic",
  description:
    "Ask Claude, read images and PDF files, manage files, and list models with Anthropic",
  category: "integration",
  app: "Anthropic",
  // The names of the actions of the Anthropic node.
  actions: [
    { label: "Ask Claude", config: { resource: "message", operation: "create" } },
    {
      label: "Analyze an image",
      config: { resource: "message", operation: "create", imageUrls: "" },
    },
    {
      label: "Analyze a PDF",
      config: { resource: "message", operation: "create", documentUrls: "" },
    },
    { label: "Count tokens", config: { resource: "message", operation: "countTokens" } },
    { label: "Upload a file", config: { resource: "file", operation: "upload" } },
    { label: "Get a file", config: { resource: "file", operation: "get" } },
    { label: "List files", config: { resource: "file", operation: "list" } },
    { label: "Delete a file", config: { resource: "file", operation: "delete" } },
    { label: "List models", config: { resource: "model", operation: "list" } },
  ],
  icon: "Sparkles",
  iconUrl: ANTHROPIC_ICON,
  config: anthropicConfig,
  defaultConfig: {
    resource: "message",
    operation: "create",
    model: "claude-sonnet-5-5",
    system: "",
    prompt: "",
    maxTokens: 1024,
    returnAll: false,
    limit: 20,
    timeoutMs: 120_000,
  },
  credentialTypes: [ANTHROPIC_CREDENTIAL],
  ports: { in: ["in"], out: ["out"] },
  subtitle: (config) =>
    typeof config.operation === "string"
      ? `${String(config.resource ?? "message")}: ${config.operation}`
      : undefined,
  async run({ config, credential, signal }) {
    const access = anthropicAccess(credential);
    const options = { signal, timeoutMs: config.timeoutMs };
    const request = buildRequest(config);

    if (request.list) {
      const items = await callAnthropicList(
        access,
        request.call.path,
        config.returnAll ? null : config.limit,
        options,
      );
      return { port: "out", data: items };
    }

    const answer = await callAnthropic(access, request.call, options);

    if (config.operation !== "create") return { port: "out", data: answer };

    const text = textOf(answer);
    let json: unknown;
    if (request.json) {
      try {
        json = JSON.parse(text);
      } catch {
        throw new Error("Anthropic message.create: the answer is not valid JSON");
      }
    }
    return { port: "out", data: { text, ...(request.json ? { json } : {}), ...answer } };
  },
});
