// SPDX-License-Identifier: AGPL-3.0-only
import type { ResolvedCredential } from "@zerodot/node-sdk";

export const PROVIDERS = ["openai", "anthropic", "gemini", "compatible"] as const;
export type Provider = (typeof PROVIDERS)[number];

/** The credential type of each provider. The node uses the one that matches `provider`. */
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

/** The most items that "return all" collects. */
export const MAX_ITEMS = 5000;
const PAGE_SIZE = 100;

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

/** An error that a provider gave. `code` is the error code or type, for example `model_not_found`. */
export class AIError extends Error {
  readonly provider: Provider;
  readonly code: string | undefined;
  readonly status: number;
  readonly requestId: string | undefined;
  readonly retryAfter: number | undefined;

  constructor(
    provider: Provider,
    message: string,
    status: number,
    code?: string,
    requestId?: string,
    retryAfter?: number,
  ) {
    super(message);
    this.name = "AIError";
    this.provider = provider;
    this.code = code;
    this.status = status;
    this.requestId = requestId;
    this.retryAfter = retryAfter;
  }
}

/** Short help for the OpenAI errors that people see most. */
const CODE_HINTS: Record<string, string> = {
  invalid_api_key: "OpenAI did not accept the API key",
  insufficient_quota: "The account has no credit left. Check the billing page",
  model_not_found: "The model does not exist, or the account cannot use it",
  context_length_exceeded: "The input is too long for the model",
  rate_limit_exceeded: "OpenAI limits the requests. Try again later",
  content_policy_violation: "OpenAI blocked the request because of its content policy",
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

type Answer = Record<string, unknown> & {
  error?: {
    message?: string;
    type?: string;
    code?: string | number | null;
    status?: string;
  } | null;
};

/** The error for an answer with an error status. The text never has the key. */
export function errorOf(
  provider: Provider,
  label: string,
  status: number,
  answer: Answer | null,
  requestId?: string,
  retryAfter?: number,
): AIError {
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
  const hint = (code && CODE_HINTS[code]) || statusHint(provider, status);
  if (hint) parts.push(hint);
  if (code) parts.push(`Error code ${code}`);
  if (requestId) parts.push(`Request ID ${requestId}`);
  if (retryAfter !== undefined) parts.push(`Try again in ${retryAfter} seconds`);
  return new AIError(provider, parts.join(". "), status, code, requestId, retryAfter);
}

const retryAfterOf = (header: string | null): number | undefined => {
  const seconds = Number(header);
  return header !== null && Number.isFinite(seconds) && seconds >= 0 ? seconds : undefined;
};

export type Call = {
  method: "GET" | "POST" | "DELETE";
  /** The path after the base URL, for example `/models`. */
  path: string;
  /** A JSON body. */
  json?: Record<string, unknown>;
  /** A multipart body, for a file upload. */
  form?: FormData;
  /** The query of a GET. Empty values are left out. */
  query?: Record<string, string | number | undefined>;
  /** The answer is a file, not JSON. The call gives it as `{ data, mimeType }`. */
  binary?: boolean;
  /** A Gemini file upload. It has two steps, so it has its own kind of call. */
  upload?: { data: Uint8Array<ArrayBuffer>; mimeType: string; displayName: string };
};

/** The headers of a call. A JSON body adds its type. A multipart body sets its own. */
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

const signalOf = (options: CallOptions): AbortSignal =>
  AbortSignal.any([options.signal, AbortSignal.timeout(options.timeoutMs)]);

/** The answer of a response. An error status gives an error with the time to wait. */
async function readAnswer(
  access: Access,
  label: string,
  response: Response,
): Promise<Record<string, unknown>> {
  const answer = (await response.json().catch(() => null)) as Answer | null;
  if (!response.ok) {
    throw errorOf(
      access.provider,
      label,
      response.status,
      answer,
      response.headers.get("request-id") ?? undefined,
      retryAfterOf(response.headers.get("retry-after")),
    );
  }
  return answer ?? {};
}

/** The two steps of a Gemini upload: start a session, then send the bytes and finish. */
async function uploadGemini(
  access: Access,
  upload: NonNullable<Call["upload"]>,
  options: CallOptions,
): Promise<Record<string, unknown>> {
  const base = new URL(access.baseUrl);
  const start = await fetch(`${base.origin}/upload${base.pathname.replace(/\/+$/, "")}/files`, {
    method: "POST",
    headers: {
      ...headersOf(access, true),
      "x-goog-upload-protocol": "resumable",
      "x-goog-upload-command": "start",
      "x-goog-upload-header-content-length": String(upload.data.length),
      "x-goog-upload-header-content-type": upload.mimeType,
    },
    body: JSON.stringify({ file: { displayName: upload.displayName } }),
    redirect: "error",
    signal: signalOf(options),
  });
  const label = "POST files (upload)";
  if (!start.ok) {
    const answer = (await start.json().catch(() => null)) as Answer | null;
    throw errorOf("gemini", label, start.status, answer);
  }
  const url = start.headers.get("x-goog-upload-url");
  if (!url) throw new Error("Gemini gave no upload address");
  // The upload address is on the host of Gemini. It has its own session ID, so it needs no key.
  const finish = await fetch(url, {
    method: "POST",
    headers: {
      accept: "application/json",
      "x-goog-upload-offset": "0",
      "x-goog-upload-command": "upload, finalize",
    },
    body: new Blob([upload.data]),
    redirect: "error",
    signal: signalOf(options),
  });
  return await readAnswer(access, label, finish);
}

/** One call. HTTP 429 and 529 give an error with the time to wait, when the service sends it. */
export async function callApi(
  access: Access,
  call: Call,
  options: CallOptions,
): Promise<Record<string, unknown>> {
  if (call.upload) return await uploadGemini(access, call.upload, options);
  const url = new URL(`${access.baseUrl}${call.path}`);
  for (const [key, value] of Object.entries(call.query ?? {})) {
    if (value !== undefined && value !== "") url.searchParams.set(key, String(value));
  }
  const label = `${call.method} ${call.path.replace(/^\/v1\//, "")}`;
  const response = await fetch(url, {
    method: call.method,
    headers: headersOf(access, call.json !== undefined),
    body: call.form ?? (call.json === undefined ? undefined : JSON.stringify(call.json)),
    redirect: "error",
    signal: signalOf(options),
  });
  // A file answer is read as bytes. An error answer is always JSON.
  if (call.binary && response.ok) {
    return {
      data: Buffer.from(await response.arrayBuffer()).toString("base64"),
      mimeType: response.headers.get("content-type") ?? "application/octet-stream",
    };
  }
  return await readAnswer(access, label, response);
}

/**
 * A list of models or files. Anthropic follows `next_page` (files) or `last_id` while `has_more`
 * is true (models). Gemini follows `nextPageToken`. OpenAI gives all items in one answer.
 * It stops when it has `wanted` items.
 */
export async function callList(
  access: Access,
  path: string,
  itemsKey: string,
  wanted: number,
  options: CallOptions,
): Promise<unknown[]> {
  const count = Math.min(wanted, MAX_ITEMS);
  const items: unknown[] = [];
  let afterId: string | undefined;
  let nextPage: string | undefined;
  while (items.length < count) {
    const size = Math.min(PAGE_SIZE, count - items.length);
    const query: Call["query"] =
      access.provider === "gemini"
        ? { pageSize: size, pageToken: nextPage }
        : access.provider === "anthropic"
          ? { limit: size, after_id: afterId, page: nextPage }
          : undefined;
    const page: Record<string, unknown> = await callApi(
      access,
      { method: "GET", path, query },
      options,
    );
    const found = page[itemsKey];
    if (Array.isArray(found)) items.push(...found);
    if (access.provider === "gemini") {
      const token = page.nextPageToken;
      nextPage = typeof token === "string" && token !== "" ? token : undefined;
      if (!nextPage) break;
    } else if (access.provider === "anthropic") {
      // Files give `next_page`. Models give `has_more` and `last_id`.
      nextPage =
        typeof page.next_page === "string" && page.next_page !== "" ? page.next_page : undefined;
      afterId = typeof page.last_id === "string" && page.last_id !== "" ? page.last_id : undefined;
      if (nextPage) afterId = undefined;
      else if (page.has_more !== true || !afterId) break;
    } else {
      break;
    }
  }
  return items.slice(0, count);
}
