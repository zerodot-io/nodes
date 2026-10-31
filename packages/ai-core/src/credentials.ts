// SPDX-License-Identifier: AGPL-3.0-only
import type { CredentialTypeDefinition } from "@zerodot/node-sdk";
import { z } from "zod";
import { accessOf, BASE_URL_OF, CREDENTIAL_OF, type Provider } from "./access";
import { callApi } from "./rest";

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

/**
 * The credential types of the providers. @zerodot/ai and @zerodot/ai-agent both give them,
 * and zerodot keeps the first type of a name that it loads, so they come from this one place.
 * `iconUrl` is the icon file of the package that gives them.
 */
export function aiCredentialTypes(iconUrl: string): CredentialTypeDefinition[] {
  const common = { secretFields: ["apiKey"], icon: "SparklesIcon", iconUrl };

  const openai: CredentialTypeDefinition = {
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

  const anthropic: CredentialTypeDefinition = {
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

  const gemini: CredentialTypeDefinition = {
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

  const compatible: CredentialTypeDefinition = {
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
  /** A provider with an API key and an optional address for a proxy. */
  const keyed = (
    provider: "mistral" | "groq" | "xai" | "deepseek" | "openrouter",
    label: string,
    placeholder: string,
  ): CredentialTypeDefinition => ({
    type: CREDENTIAL_OF[provider],
    label,
    fields: z.object({
      apiKey: z.string().min(1).meta({ placeholder }),
      /** Only for a proxy. Empty uses the address of the provider. */
      baseUrl: z
        .string()
        .optional()
        .meta({ placeholder: `${BASE_URL_OF[provider]} (optional)` }),
    }),
    ...common,
    test: testOf(provider),
  });

  const ollama: CredentialTypeDefinition = {
    type: CREDENTIAL_OF.ollama,
    label: "Ollama",
    fields: z.object({
      /** The address of Ollama with /v1. Plain http:// works only for localhost. */
      baseUrl: z.string().optional().meta({ placeholder: "http://localhost:11434/v1 (optional)" }),
      /** Only for an Ollama behind a proxy that needs a key. */
      apiKey: z.string().optional().meta({ placeholder: "(optional)" }),
    }),
    ...common,
    test: testOf("ollama"),
  };

  // Azure, Bedrock, and Vertex have no simple call to read one model, so they have no test.
  const azure: CredentialTypeDefinition = {
    type: CREDENTIAL_OF.azure,
    label: "Azure OpenAI",
    fields: z.object({
      apiKey: z.string().min(1),
      /** The name of the Azure OpenAI resource: https://<name>.openai.azure.com */
      resourceName: z.string().optional().meta({ placeholder: "my-resource" }),
      /** Instead of the resource name: the full address, up to /openai. */
      baseUrl: z
        .string()
        .optional()
        .meta({ placeholder: "https://my-resource.openai.azure.com/openai (optional)" }),
      /** Empty uses the default version of the AI SDK. */
      apiVersion: z.string().optional().meta({ placeholder: "(optional)" }),
    }),
    ...common,
  };

  const bedrock: CredentialTypeDefinition = {
    type: CREDENTIAL_OF.bedrock,
    label: "Amazon Bedrock",
    fields: z.object({
      region: z.string().min(1).meta({ placeholder: "us-east-1" }),
      /** An access key of an IAM user or role. */
      accessKeyId: z.string().optional().meta({ placeholder: "AKIA… (optional)" }),
      secretAccessKey: z.string().optional().meta({ placeholder: "(optional)" }),
      /** Only for temporary keys. */
      sessionToken: z.string().optional().meta({ placeholder: "(optional)" }),
      /** Instead of the access keys: a Bedrock API key. */
      apiKey: z.string().optional().meta({ placeholder: "(optional)" }),
    }),
    ...common,
    secretFields: ["secretAccessKey", "sessionToken", "apiKey"],
  };

  const vertex: CredentialTypeDefinition = {
    type: CREDENTIAL_OF.vertex,
    label: "Google Vertex AI",
    fields: z.object({
      project: z.string().min(1).meta({ placeholder: "my-project" }),
      /** Empty means us-central1. */
      location: z.string().optional().meta({ placeholder: "us-central1 (optional)" }),
      /** The JSON key of a service account with the Vertex AI User role. */
      serviceAccountJson: z
        .string()
        .optional()
        .meta({ placeholder: '{"type":"service_account",…}' }),
      /** Instead of the service account: an API key of Vertex AI express mode. */
      apiKey: z.string().optional().meta({ placeholder: "(optional)" }),
    }),
    ...common,
    secretFields: ["serviceAccountJson", "apiKey"],
  };

  return [
    openai,
    anthropic,
    gemini,
    compatible,
    keyed("mistral", "Mistral AI API key", "(from La Plateforme)"),
    keyed("groq", "Groq API key", "gsk_…"),
    keyed("xai", "xAI API key", "xai-…"),
    keyed("deepseek", "DeepSeek API key", "sk-…"),
    keyed("openrouter", "OpenRouter API key", "sk-or-…"),
    ollama,
    azure,
    bedrock,
    vertex,
  ];
}
