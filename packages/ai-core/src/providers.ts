// SPDX-License-Identifier: AGPL-3.0-only
import type { EmbeddingModel, LanguageModel } from "ai";
import { type Access, PROVIDER_LABEL, type Provider } from "./access";

// The AI SDK models of each provider. A new provider needs a line in each function. The packages
// load on the first call, so loading the node package stays fast.

/** A Gemini model goes in a path. It can start with "models/". */
export function geminiModelId(model: string): string {
  const id = model.replace(/^models\//, "");
  if (!/^[A-Za-z0-9._-]{1,128}$/.test(id)) throw new Error(`"${model}" is not a model id`);
  return id;
}

/** The providers that have embedding models. */
export const EMBEDDING_PROVIDERS = [
  "openai",
  "gemini",
  "compatible",
  "mistral",
  "ollama",
  "azure",
  "bedrock",
  "vertex",
] as const satisfies readonly Provider[];

const openaiOf = async (access: Access) =>
  (await import("@ai-sdk/openai")).createOpenAI({
    apiKey: access.apiKey,
    baseURL: access.baseUrl,
    organization: access.organization,
    project: access.project,
  });

/** A compatible service or Ollama. Both have the API of OpenAI Chat Completions. */
const compatibleOf = async (access: Access, extraBody?: Record<string, unknown>) =>
  (await import("@ai-sdk/openai-compatible")).createOpenAICompatible({
    name: access.provider,
    apiKey: access.apiKey,
    baseURL: access.baseUrl,
    ...(extraBody ? { transformRequestBody: (body) => ({ ...body, ...extraBody }) } : {}),
  });

const geminiOf = async (access: Access) =>
  (await import("@ai-sdk/google")).createGoogleGenerativeAI({
    apiKey: access.apiKey,
    baseURL: access.baseUrl,
  });

const anthropicOf = async (access: Access) =>
  (await import("@ai-sdk/anthropic")).createAnthropic({
    apiKey: access.apiKey,
    // The base URL of the credential has no version. The AI SDK wants it.
    baseURL: `${access.baseUrl}/v1`,
  });

const mistralOf = async (access: Access) =>
  (await import("@ai-sdk/mistral")).createMistral({
    apiKey: access.apiKey,
    baseURL: access.baseUrl,
  });

const azureOf = async (access: Access) =>
  (await import("@ai-sdk/azure")).createAzure({
    apiKey: access.apiKey,
    baseURL: access.baseUrl,
    apiVersion: access.apiVersion,
  });

const bedrockOf = async (access: Access) =>
  (await import("@ai-sdk/amazon-bedrock")).createAmazonBedrock({
    region: access.region,
    apiKey: access.apiKey,
    accessKeyId: access.accessKeyId,
    secretAccessKey: access.secretAccessKey,
    sessionToken: access.sessionToken,
  });

const vertexOf = async (access: Access) =>
  (await import("@ai-sdk/google-vertex")).createVertex({
    project: access.project,
    location: access.location,
    ...(access.serviceAccount
      ? { googleAuthOptions: { credentials: access.serviceAccount } }
      : { apiKey: access.apiKey }),
  });

/**
 * The chat model. OpenAI and Azure use Chat Completions, as a proxy in the base URL can too.
 * `extraBody` goes in each request of a compatible service, for a field the AI SDK does not set.
 */
export async function languageModelOf(
  access: Access,
  model: string,
  extraBody?: Record<string, unknown>,
): Promise<LanguageModel> {
  switch (access.provider) {
    case "openai":
      return (await openaiOf(access)).chat(model);
    case "anthropic":
      return (await anthropicOf(access))(model);
    case "gemini": {
      const id = geminiModelId(model);
      return (await geminiOf(access))(id);
    }
    case "compatible":
    case "ollama":
      return (await compatibleOf(access, extraBody)).chatModel(model);
    case "mistral":
      return (await mistralOf(access))(model);
    case "groq": {
      const { createGroq } = await import("@ai-sdk/groq");
      return createGroq({ apiKey: access.apiKey, baseURL: access.baseUrl })(model);
    }
    case "xai": {
      const { createXai } = await import("@ai-sdk/xai");
      return createXai({ apiKey: access.apiKey, baseURL: access.baseUrl })(model);
    }
    case "deepseek": {
      const { createDeepSeek } = await import("@ai-sdk/deepseek");
      return createDeepSeek({ apiKey: access.apiKey, baseURL: access.baseUrl })(model);
    }
    case "openrouter": {
      const { createOpenRouter } = await import("@openrouter/ai-sdk-provider");
      return createOpenRouter({ apiKey: access.apiKey, baseURL: access.baseUrl }).chat(model);
    }
    case "azure":
      // The model is the name of a deployment.
      return (await azureOf(access)).chat(model);
    case "bedrock":
      return (await bedrockOf(access))(model);
    case "vertex":
      return (await vertexOf(access))(model);
  }
}

/** The embedding model. Only the providers in EMBEDDING_PROVIDERS have one. */
export async function embeddingModelOf(access: Access, model: string): Promise<EmbeddingModel> {
  switch (access.provider) {
    case "openai":
      return (await openaiOf(access)).embedding(model);
    case "gemini": {
      const id = geminiModelId(model);
      return (await geminiOf(access)).embedding(id);
    }
    case "compatible":
    case "ollama":
      return (await compatibleOf(access)).embeddingModel(model);
    case "mistral":
      return (await mistralOf(access)).embedding(model);
    case "azure":
      return (await azureOf(access)).embedding(model);
    case "bedrock":
      return (await bedrockOf(access)).embedding(model);
    case "vertex":
      return (await vertexOf(access)).embeddingModel(model);
    default:
      throw new Error(`${PROVIDER_LABEL[access.provider]} has no embedding models`);
  }
}
