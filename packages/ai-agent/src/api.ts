// SPDX-License-Identifier: AGPL-3.0-only
import type { ResolvedCredential } from "@zerodot/node-sdk";
import { StatusError } from "./retry";

// The access code of @zerodot/ai, with only the JSON calls that the agent needs.

export const PROVIDERS = ["openai", "anthropic", "gemini", "compatible"] as const;
export type Provider = (typeof PROVIDERS)[number];

/** The credential type of each provider. The same types as @zerodot/ai, so saved keys work in both. */
export const CREDENTIAL_OF = {
  openai: "ai.openai",
  anthropic: "ai.anthropic",
  gemini: "ai.gemini",
  compatible: "ai.compatible",
} as const satisfies Record<Provider, string>;

export const PROVIDER_LABEL = {
  openai: "OpenAI",
  anthropic: "Anthropic",
  gemini: "Gemini",
  compatible: "The compatible service",
} as const satisfies Record<Provider, string>;

export const BASE_URL_OF = {
  openai: "https://api.openai.com/v1",
  anthropic: "https://api.anthropic.com",
  gemini: "https://generativelanguage.googleapis.com/v1beta",
  compatible: "",
} as const satisfies Record<Provider, string>;

/** The current Anthropic API version (checked on 2026-10-29). It removed temperature, top_p, and top_k. */
export const ANTHROPIC_VERSION = "2026-10-21";

export type Access = {
  provider: Provider;
  /** Empty only for a compatible service that needs no key. */
  apiKey: string | undefined;
  organization?: string;
  project?: string;
  /** The address up to the version, without a slash at the end. */
  baseUrl: string;
};
export type CallOptions = { signal: AbortSignal; timeoutMs: number };

/** Plain http is for a service on the same machine only. */
const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]"]);

const text = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim() !== "" ? value.trim() : undefined;

/** The key and the settings of the credential that matches the provider. */
export function accessOf(
  provider: Provider,
  credential: Pick<ResolvedCredential, "type" | "data"> | null,
): Access {
  if (!credential || credential.type !== CREDENTIAL_OF[provider]) {
    const name = provider === "compatible" ? "a compatible service" : PROVIDER_LABEL[provider];
    throw new Error(`The node needs a credential for ${name}`);
  }
  const apiKey = text(credential.data.apiKey);
  if (!apiKey && provider !== "compatible") throw new Error('The credential has no "apiKey"');
  const base = text(credential.data.baseUrl) ?? BASE_URL_OF[provider];
  if (!base) throw new Error('The credential has no "baseUrl"');
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
  return {
    provider,
    apiKey,
    organization: text(credential.data.organization),
    project: text(credential.data.project),
    baseUrl: base.replace(/\/+$/, ""),
  };
}

type Answer = Record<string, unknown> & {
  error?: {
    message?: string;
    type?: string;
    code?: string | number | null;
    status?: string;
  } | null;
};

/** Short help for the status codes. The name of the service comes first. */
const statusHint = (provider: Provider, status: number): string | undefined => {
  const name = PROVIDER_LABEL[provider];
  const hints: Record<number, string> = {
    401: `${name} did not accept the API key`,
    403: "The key cannot use this resource. Check the project, the organization, and the model",
    404: `${name} did not find the resource. Check the model ID and the base URL`,
    413: "The request is too large",
    429: `${name} limits the requests. Try again later`,
    529: `${name} is busy. Try again later`,
  };
  return hints[status];
};

/** The error for an answer with an error status. The text never has the key. */
export function errorOf(
  provider: Provider,
  label: string,
  status: number,
  answer: Answer | null,
  requestId?: string,
): Error {
  const found = answer?.error;
  const code =
    typeof found?.code === "string"
      ? found.code
      : typeof found?.type === "string"
        ? found.type
        : typeof found?.status === "string"
          ? found.status
          : undefined;
  const parts = [`${PROVIDER_LABEL[provider]} ${label} failed (${status})`];
  if (typeof found?.message === "string" && found.message) parts.push(found.message);
  const hint = statusHint(provider, status);
  if (hint) parts.push(hint);
  if (code) parts.push(`Error code ${code}`);
  if (requestId) parts.push(`Request ID ${requestId}`);
  return new StatusError(parts.join(". "), status);
}

export type Call = {
  method: "GET" | "POST";
  /** The path after the base URL, for example `/chat/completions`. */
  path: string;
  json?: Record<string, unknown>;
  /** The query of a GET. Empty values are left out. */
  query?: Record<string, string | number | undefined>;
};

/** The headers of a call. A JSON body adds its type. */
export function headersOf(access: Access, hasJson: boolean): Record<string, string> {
  const { provider, apiKey } = access;
  const auth: Record<string, string> = {};
  if (provider === "anthropic" && apiKey) {
    auth["x-api-key"] = apiKey;
    auth["anthropic-version"] = ANTHROPIC_VERSION;
  } else if (provider === "gemini" && apiKey) {
    auth["x-goog-api-key"] = apiKey;
  } else if (apiKey) {
    auth.authorization = `Bearer ${apiKey}`;
  }
  return {
    accept: "application/json",
    ...auth,
    ...(provider === "openai" && access.organization
      ? { "openai-organization": access.organization }
      : {}),
    ...(provider === "openai" && access.project ? { "openai-project": access.project } : {}),
    ...(hasJson ? { "content-type": "application/json" } : {}),
  };
}

/** One JSON call. An error status gives an error with the message of the service. */
export async function callApi(
  access: Access,
  call: Call,
  options: CallOptions,
): Promise<Record<string, unknown>> {
  const url = new URL(`${access.baseUrl}${call.path}`);
  for (const [key, value] of Object.entries(call.query ?? {})) {
    if (value !== undefined && value !== "") url.searchParams.set(key, String(value));
  }
  const label = `${call.method} ${call.path.replace(/^\/v1\//, "")}`;
  const response = await fetch(url, {
    method: call.method,
    headers: headersOf(access, call.json !== undefined),
    body: call.json === undefined ? undefined : JSON.stringify(call.json),
    redirect: "error",
    signal: AbortSignal.any([options.signal, AbortSignal.timeout(options.timeoutMs)]),
  });
  const answer = (await response.json().catch(() => null)) as Answer | null;
  if (!response.ok) {
    throw errorOf(
      access.provider,
      label,
      response.status,
      answer,
      response.headers.get("request-id") ?? undefined,
    );
  }
  return answer ?? {};
}
