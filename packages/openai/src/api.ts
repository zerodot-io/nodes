// SPDX-License-Identifier: AGPL-3.0-only
import type { ResolvedCredential } from "@zerodot/node-sdk";

export const OPENAI_CREDENTIAL = "openai.api";
export const OPENAI_API = "https://api.openai.com/v1";

export type OpenAIAccess = {
  apiKey: string;
  organization?: string;
  project?: string;
  /** The address up to the version, without a slash at the end. */
  baseUrl: string;
};
export type CallOptions = { signal: AbortSignal; timeoutMs: number };

const text = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim() !== "" ? value.trim() : undefined;

/** The API key and the optional settings of a credential. */
export function openaiAccess(
  credential: Pick<ResolvedCredential, "type" | "data"> | null,
): OpenAIAccess {
  if (!credential || credential.type !== OPENAI_CREDENTIAL) {
    throw new Error("The node needs an OpenAI credential");
  }
  const apiKey = text(credential.data.apiKey);
  if (!apiKey) throw new Error('The credential has no "apiKey"');
  const base = text(credential.data.baseUrl) ?? OPENAI_API;
  let parsed: URL;
  try {
    parsed = new URL(base);
  } catch {
    throw new Error('"baseUrl" is not a valid address');
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new Error('"baseUrl" must start with https:// or http://');
  }
  return {
    apiKey,
    organization: text(credential.data.organization),
    project: text(credential.data.project),
    baseUrl: base.replace(/\/+$/, ""),
  };
}

/** An error that OpenAI gave. `code` is the OpenAI error code, for example `model_not_found`. */
export class OpenAIError extends Error {
  readonly code: string | undefined;
  readonly status: number;
  readonly retryAfter: number | undefined;

  constructor(message: string, status: number, code?: string, retryAfter?: number) {
    super(message);
    this.name = "OpenAIError";
    this.code = code;
    this.status = status;
    this.retryAfter = retryAfter;
  }
}

/** Short help for the errors that people see most. */
const HINTS: Record<string, string> = {
  invalid_api_key: "OpenAI did not accept the API key",
  insufficient_quota: "The account has no credit left. Check the billing page",
  model_not_found: "The model does not exist, or the account cannot use it",
  context_length_exceeded: "The input is too long for the model",
  rate_limit_exceeded: "OpenAI limits the requests. Try again later",
  content_policy_violation: "OpenAI blocked the request because of its content policy",
};

const STATUS_HINTS: Record<number, string> = {
  401: "OpenAI did not accept the API key",
  403: "The key cannot use this resource. Check the project and the organization",
  404: "OpenAI did not find the resource. Check the model and the base URL",
  429: "OpenAI limits the requests. Try again later",
};

type OpenAIAnswer = Record<string, unknown> & {
  error?: { message?: string; type?: string; code?: string | number | null } | null;
};

/** The error for an answer with an error status. The text never has the key. */
export function openaiErrorOf(label: string, status: number, answer: OpenAIAnswer | null) {
  const found = answer?.error;
  const code = typeof found?.code === "string" ? found.code : undefined;
  const parts = [`OpenAI ${label} failed (${status})`];
  if (typeof found?.message === "string" && found.message) parts.push(found.message);
  const hint = (code && HINTS[code]) || STATUS_HINTS[status];
  if (hint) parts.push(hint);
  if (code) parts.push(`Error code ${code}`);
  return new OpenAIError(parts.join(". "), status, code);
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
  /** The answer is a file, not JSON. The call gives it as `{ data, mimeType }`. */
  binary?: boolean;
};

/** The headers of a call. A JSON body adds its type. A multipart body sets its own. */
export function headersOf(access: OpenAIAccess, hasJson: boolean): Record<string, string> {
  return {
    authorization: `Bearer ${access.apiKey}`,
    accept: "application/json",
    ...(access.organization ? { "openai-organization": access.organization } : {}),
    ...(access.project ? { "openai-project": access.project } : {}),
    ...(hasJson ? { "content-type": "application/json" } : {}),
  };
}

/** One call. HTTP 429 means a rate limit. */
export async function callOpenAI(
  access: OpenAIAccess,
  call: Call,
  options: CallOptions,
): Promise<Record<string, unknown>> {
  const label = `${call.method} ${call.path}`;
  const response = await fetch(`${access.baseUrl}${call.path}`, {
    method: call.method,
    headers: headersOf(access, call.json !== undefined),
    body: call.form ?? (call.json === undefined ? undefined : JSON.stringify(call.json)),
    redirect: "error",
    signal: AbortSignal.any([options.signal, AbortSignal.timeout(options.timeoutMs)]),
  });
  // A file answer is read as bytes. An error answer is always JSON.
  if (call.binary && response.ok) {
    return {
      data: Buffer.from(await response.arrayBuffer()).toString("base64"),
      mimeType: response.headers.get("content-type") ?? "application/octet-stream",
    };
  }
  const answer = (await response.json().catch(() => null)) as OpenAIAnswer | null;
  if (!response.ok) {
    const error = openaiErrorOf(label, response.status, answer);
    if (response.status !== 429) throw error;
    const retryAfter = retryAfterOf(response.headers.get("retry-after"));
    const wait = retryAfter === undefined ? "" : `. Try again in ${retryAfter} seconds`;
    throw new OpenAIError(`${error.message}${wait}`, 429, error.code, retryAfter);
  }
  return answer ?? {};
}
