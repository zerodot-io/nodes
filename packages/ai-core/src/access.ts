// SPDX-License-Identifier: AGPL-3.0-only
import type { ResolvedCredential } from "@zerodot/node-sdk";

export const PROVIDERS = [
  "openai",
  "anthropic",
  "gemini",
  "compatible",
  "mistral",
  "groq",
  "xai",
  "deepseek",
  "openrouter",
  "ollama",
  "azure",
  "bedrock",
  "vertex",
] as const;
export type Provider = (typeof PROVIDERS)[number];

/** The credential type of each provider. The node uses the one that matches `provider`. */
export const CREDENTIAL_OF = {
  openai: "ai.openai",
  anthropic: "ai.anthropic",
  gemini: "ai.gemini",
  compatible: "ai.compatible",
  mistral: "ai.mistral",
  groq: "ai.groq",
  xai: "ai.xai",
  deepseek: "ai.deepseek",
  openrouter: "ai.openrouter",
  ollama: "ai.ollama",
  azure: "ai.azure",
  bedrock: "ai.bedrock",
  vertex: "ai.vertex",
} as const satisfies Record<Provider, string>;

export const PROVIDER_LABEL = {
  openai: "OpenAI",
  anthropic: "Anthropic",
  gemini: "Gemini",
  compatible: "The compatible service",
  mistral: "Mistral",
  groq: "Groq",
  xai: "xAI",
  deepseek: "DeepSeek",
  openrouter: "OpenRouter",
  ollama: "Ollama",
  azure: "Azure OpenAI",
  bedrock: "Amazon Bedrock",
  vertex: "Vertex AI",
} as const satisfies Record<Provider, string>;

/** The default address of each provider. Azure, Bedrock, and Vertex make it from the credential. */
export const BASE_URL_OF = {
  openai: "https://api.openai.com/v1",
  anthropic: "https://api.anthropic.com",
  gemini: "https://generativelanguage.googleapis.com/v1beta",
  compatible: "",
  mistral: "https://api.mistral.ai/v1",
  groq: "https://api.groq.com/openai/v1",
  xai: "https://api.x.ai/v1",
  deepseek: "https://api.deepseek.com",
  openrouter: "https://openrouter.ai/api/v1",
  ollama: "http://localhost:11434/v1",
  azure: "",
  bedrock: "",
  vertex: "",
} as const satisfies Record<Provider, string>;

/** The providers with an OpenAI-style `/models` list and a key in a Bearer header. */
export const OPENAI_STYLE = [
  "openai",
  "compatible",
  "mistral",
  "groq",
  "xai",
  "deepseek",
  "openrouter",
  "ollama",
] as const satisfies readonly Provider[];

/** The current Anthropic API version (checked on 2026-10-29). It removed temperature, top_p, and top_k. */
export const ANTHROPIC_VERSION = "2026-10-21";

export type Access = {
  provider: Provider;
  /** Empty only for a service that needs no key, or for Bedrock and Vertex with other keys. */
  apiKey: string | undefined;
  organization?: string;
  /** The OpenAI project, or the Google Cloud project of Vertex. */
  project?: string;
  /** The address up to the version, without a slash at the end. */
  baseUrl: string;
  /** Azure: the API version. Empty uses the default of the AI SDK. */
  apiVersion?: string;
  /** Bedrock: the AWS Region. */
  region?: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  sessionToken?: string;
  /** Vertex: the location, such as us-central1 or global. */
  location?: string;
  /** Vertex: the JSON key of a service account. */
  serviceAccount?: Record<string, unknown>;
};
export type CallOptions = { signal: AbortSignal; timeoutMs: number };

/** Plain http is for a service on the same machine only. */
const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]"]);

const text = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim() !== "" ? value.trim() : undefined;

/** These providers work without a key. */
const KEYLESS = new Set<Provider>(["compatible", "ollama"]);

/** An http(s) address: https, or http on the same machine. */
function checkUrl(base: string): string {
  let parsed: URL;
  try {
    parsed = new URL(base);
  } catch {
    throw new Error('"baseUrl" is not a valid address');
  }
  if (
    parsed.protocol !== "https:" &&
    !(parsed.protocol === "http:" && LOOPBACK.has(parsed.hostname))
  ) {
    throw new Error('"baseUrl" must start with https:// (http:// only for localhost)');
  }
  return base.replace(/\/+$/, "");
}

/** A part of a host name, such as an Azure resource or an AWS Region. */
function hostPart(value: string | undefined, name: string): string {
  if (!value) throw new Error(`The credential has no "${name}"`);
  if (!/^[a-z0-9][a-z0-9-]{0,62}$/i.test(value)) throw new Error(`"${name}" is not valid`);
  return value;
}

/** The JSON key of a Google service account. */
function serviceAccountOf(value: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error('"serviceAccountJson" must be JSON');
  }
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    !("client_email" in parsed) ||
    !("private_key" in parsed)
  ) {
    throw new Error('"serviceAccountJson" needs "client_email" and "private_key"');
  }
  return parsed as Record<string, unknown>;
}

/** The address of Azure, Bedrock, and Vertex, from the other fields of the credential. */
function cloudAccess(
  provider: Provider,
  data: Record<string, unknown>,
  apiKey: string | undefined,
) {
  if (provider === "azure") {
    const base = text(data.baseUrl);
    const resource = base ? undefined : hostPart(text(data.resourceName), "resourceName");
    return {
      baseUrl: checkUrl(base ?? `https://${resource}.openai.azure.com/openai`),
      apiVersion: text(data.apiVersion),
    };
  }
  if (provider === "bedrock") {
    const region = hostPart(text(data.region), "region");
    const accessKeyId = text(data.accessKeyId);
    const secretAccessKey = text(data.secretAccessKey);
    if (!apiKey && !(accessKeyId && secretAccessKey)) {
      throw new Error('The credential needs "apiKey", or "accessKeyId" and "secretAccessKey"');
    }
    return {
      baseUrl: `https://bedrock-runtime.${region}.amazonaws.com`,
      region,
      accessKeyId,
      secretAccessKey,
      sessionToken: text(data.sessionToken),
    };
  }
  const project = hostPart(text(data.project), "project");
  const location = hostPart(text(data.location) ?? "us-central1", "location");
  const json = text(data.serviceAccountJson);
  if (!apiKey && !json) throw new Error('The credential needs "serviceAccountJson" or "apiKey"');
  return {
    baseUrl:
      location === "global"
        ? "https://aiplatform.googleapis.com"
        : `https://${location}-aiplatform.googleapis.com`,
    project,
    location,
    ...(json ? { serviceAccount: serviceAccountOf(json) } : {}),
  };
}

/** The key and the settings of the credential that matches the provider. */
export function accessOf(
  provider: Provider,
  credential: Pick<ResolvedCredential, "type" | "data"> | null,
): Access {
  if (!credential || credential.type !== CREDENTIAL_OF[provider]) {
    const name = provider === "compatible" ? "a compatible service" : PROVIDER_LABEL[provider];
    throw new Error(`The node needs a credential for ${name}`);
  }
  const { data } = credential;
  const apiKey = text(data.apiKey);
  if (provider === "azure" || provider === "bedrock" || provider === "vertex") {
    if (provider === "azure" && !apiKey) throw new Error('The credential has no "apiKey"');
    return { provider, apiKey, ...cloudAccess(provider, data, apiKey) };
  }
  if (!apiKey && !KEYLESS.has(provider)) throw new Error('The credential has no "apiKey"');
  const base = text(data.baseUrl) ?? BASE_URL_OF[provider];
  if (!base) throw new Error('The credential has no "baseUrl"');
  return {
    provider,
    apiKey,
    organization: text(data.organization),
    project: text(data.project),
    baseUrl: checkUrl(base),
  };
}

/** The signal of one call: the run signal and the time limit. */
export const signalOf = (options: CallOptions): AbortSignal =>
  AbortSignal.any([options.signal, AbortSignal.timeout(options.timeoutMs)]);
