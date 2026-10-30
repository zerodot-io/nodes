// SPDX-License-Identifier: AGPL-3.0-only
// A copy of the credential types of @zerodot/ai. zerodot keeps the first type of a name that it
// loads, so the two copies must stay the same. A test checks that.
import type { CredentialTypeDefinition } from "@zerodot/node-sdk";
import { z } from "zod";
import { accessOf, CREDENTIAL_OF, callApi, type Provider } from "./api";
import { AI_ICON } from "./icon";

const TIMEOUT_MS = 10_000;

/** Reads one model, to check that the key and the address work. */
const testOf =
  (provider: Provider): CredentialTypeDefinition["test"] =>
  async (credential) => {
    const path = provider === "anthropic" ? "/v1/models" : "/models";
    const query =
      provider === "anthropic" ? { limit: 1 } : provider === "gemini" ? { pageSize: 1 } : undefined;
    await callApi(
      accessOf(provider, credential),
      { method: "GET", path, query },
      { signal: AbortSignal.timeout(TIMEOUT_MS), timeoutMs: TIMEOUT_MS },
    );
  };

const common = { secretFields: ["apiKey"], icon: "SparklesIcon", iconUrl: AI_ICON };

export const openaiCredential: CredentialTypeDefinition = {
  type: CREDENTIAL_OF.openai,
  label: "OpenAI API",
  fields: z.object({
    /** From the API keys page of the OpenAI platform. */
    apiKey: z.string().min(1).meta({ placeholder: "sk-…" }),
    /** Only to bill a request to a specific organization. */
    organization: z.string().optional().meta({ placeholder: "org-… (optional)" }),
    /** Only to bill a request to a specific project. */
    project: z.string().optional().meta({ placeholder: "proj_… (optional)" }),
    /** Only for a proxy. Empty means https://api.openai.com/v1 */
    baseUrl: z.string().optional().meta({ placeholder: "https://api.openai.com/v1 (optional)" }),
  }),
  ...common,
  test: testOf("openai"),
};

export const anthropicCredential: CredentialTypeDefinition = {
  type: CREDENTIAL_OF.anthropic,
  label: "Anthropic API key",
  fields: z.object({
    /** From the Anthropic Console. */
    apiKey: z.string().min(1).meta({ placeholder: "sk-ant-…" }),
    /** Optional. For a proxy or a gateway. Default: https://api.anthropic.com */
    baseUrl: z.string().optional().meta({ placeholder: "https://api.anthropic.com" }),
  }),
  ...common,
  test: testOf("anthropic"),
};

export const geminiCredential: CredentialTypeDefinition = {
  type: CREDENTIAL_OF.gemini,
  label: "Google Gemini API key",
  fields: z.object({
    /** From Google AI Studio. */
    apiKey: z.string().min(1).meta({ placeholder: "AIza…" }),
    /** Optional. For a proxy. Default: https://generativelanguage.googleapis.com/v1beta */
    baseUrl: z
      .string()
      .optional()
      .meta({ placeholder: "https://generativelanguage.googleapis.com/v1beta (optional)" }),
  }),
  ...common,
  test: testOf("gemini"),
};

export const compatibleCredential: CredentialTypeDefinition = {
  type: CREDENTIAL_OF.compatible,
  label: "OpenAI-compatible service",
  fields: z.object({
    /** The address up to the version. Use https://. Plain http:// works only for localhost. */
    baseUrl: z.string().min(1).meta({ placeholder: "https://llm.example.com/v1" }),
    /** Empty for a service that needs no key, such as a local Ollama. */
    apiKey: z.string().optional().meta({ placeholder: "(optional)" }),
  }),
  ...common,
  test: testOf("compatible"),
};
