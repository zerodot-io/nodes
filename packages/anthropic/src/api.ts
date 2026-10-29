// SPDX-License-Identifier: AGPL-3.0-only
import type { ResolvedCredential } from "@zerodot/node-sdk";

export const ANTHROPIC_CREDENTIAL = "anthropic.apiKey";
export const ANTHROPIC_API = "https://api.anthropic.com";
/** The current API version (checked on 2026-10-29). It removed temperature, top_p, and top_k. */
export const ANTHROPIC_VERSION = "2026-10-21";

/** The most models that "return all" collects. */
export const MAX_ITEMS = 5000;
const PAGE_SIZE = 100;

export type AnthropicAccess = { apiKey: string; baseUrl: string };
export type CallOptions = { signal: AbortSignal; timeoutMs: number };

/** The API key and the base address of a credential. The base address is optional. */
export function anthropicAccess(
  credential: Pick<ResolvedCredential, "type" | "data"> | null,
): AnthropicAccess {
  if (!credential || credential.type !== ANTHROPIC_CREDENTIAL) {
    throw new Error("The node needs an Anthropic credential");
  }
  const { apiKey, baseUrl } = credential.data;
  if (typeof apiKey !== "string" || apiKey === "") {
    throw new Error('The credential has no "apiKey"');
  }
  const base =
    typeof baseUrl === "string" && baseUrl.trim() !== "" ? baseUrl.trim() : ANTHROPIC_API;
  let url: URL;
  try {
    url = new URL(base);
  } catch {
    throw new Error('The "baseUrl" of the credential is not a valid address');
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error('The "baseUrl" of the credential must start with https://');
  }
  return { apiKey, baseUrl: base.replace(/\/+$/, "") };
}

/** An error that Anthropic gave. `type` is the error type, for example `rate_limit_error`. */
export class AnthropicError extends Error {
  readonly type: string | undefined;
  readonly status: number;
  readonly requestId: string | undefined;
  readonly retryAfter: number | undefined;

  constructor(
    message: string,
    status: number,
    type?: string,
    requestId?: string,
    retryAfter?: number,
  ) {
    super(message);
    this.name = "AnthropicError";
    this.type = type;
    this.status = status;
    this.requestId = requestId;
    this.retryAfter = retryAfter;
  }
}

/** Short help for the errors that people see most. */
const HINTS: Record<number, string> = {
  401: "Anthropic did not accept the API key",
  403: "The API key cannot use this resource",
  404: "Anthropic did not find the resource. Check the model ID",
  413: "The request is too large",
  429: "Anthropic limits the requests. Try again later",
  529: "The Anthropic API is busy. Try again later",
};

type AnthropicAnswer = Record<string, unknown> & {
  error?: { type?: string; message?: string };
};

/** The error for an answer with an error status. The text never has the key. */
export function anthropicErrorOf(
  label: string,
  status: number,
  answer: AnthropicAnswer | null,
  requestId?: string,
  retryAfter?: number,
) {
  const type = typeof answer?.error?.type === "string" ? answer.error.type : undefined;
  const parts = [`Anthropic ${label} failed (${status})`];
  if (typeof answer?.error?.message === "string" && answer.error.message) {
    parts.push(answer.error.message);
  }
  const hint = HINTS[status];
  if (hint) parts.push(hint);
  if (type) parts.push(`Error type ${type}`);
  if (requestId) parts.push(`Request ID ${requestId}`);
  if (retryAfter !== undefined) parts.push(`Try again in ${retryAfter} seconds`);
  return new AnthropicError(parts.join(". "), status, type, requestId, retryAfter);
}

const retryAfterOf = (header: string | null): number | undefined => {
  const seconds = Number(header);
  return header !== null && Number.isFinite(seconds) && seconds >= 0 ? seconds : undefined;
};

export type Call = {
  method: "GET" | "POST" | "DELETE";
  /** The path after the base address, for example `/v1/messages`. */
  path: string;
  /** The JSON body of a POST. */
  body?: Record<string, unknown>;
  /** A form body of a POST, for a file upload. It replaces `body`. */
  form?: FormData;
  /** The query of a GET. Empty values are left out. */
  query?: Record<string, string | number | undefined>;
};

/** One call. HTTP 429 and 529 give an error with the time to wait, when Anthropic sends it. */
export async function callAnthropic(
  access: AnthropicAccess,
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
    headers: {
      "x-api-key": access.apiKey,
      "anthropic-version": ANTHROPIC_VERSION,
      accept: "application/json",
      ...(call.method === "POST" && !call.form ? { "content-type": "application/json" } : {}),
    },
    body: call.form ?? (call.method === "POST" ? JSON.stringify(call.body ?? {}) : undefined),
    redirect: "error",
    signal: AbortSignal.any([options.signal, AbortSignal.timeout(options.timeoutMs)]),
  });
  const answer = (await response.json().catch(() => null)) as AnthropicAnswer | null;
  if (!response.ok) {
    throw anthropicErrorOf(
      label,
      response.status,
      answer,
      response.headers.get("request-id") ?? undefined,
      retryAfterOf(response.headers.get("retry-after")),
    );
  }
  return answer ?? {};
}

/**
 * A list of models or files. Follows `next_page` (files) or `last_id` while `has_more` is true
 * (models), until it has `limit` items.
 */
export async function callAnthropicList(
  access: AnthropicAccess,
  path: string,
  limit: number | null,
  options: CallOptions,
): Promise<unknown[]> {
  const wanted = Math.min(limit ?? MAX_ITEMS, MAX_ITEMS);
  const items: unknown[] = [];
  let afterId: string | undefined;
  let nextPage: string | undefined;
  while (items.length < wanted) {
    const page: Record<string, unknown> = await callAnthropic(
      access,
      {
        method: "GET",
        path,
        query: {
          limit: Math.min(PAGE_SIZE, wanted - items.length),
          after_id: afterId,
          page: nextPage,
        },
      },
      options,
    );
    if (Array.isArray(page.data)) items.push(...page.data);
    nextPage =
      typeof page.next_page === "string" && page.next_page !== "" ? page.next_page : undefined;
    afterId = typeof page.last_id === "string" && page.last_id !== "" ? page.last_id : undefined;
    // Files give `next_page`. Models give `has_more` and `last_id`.
    if (nextPage) afterId = undefined;
    else if (page.has_more !== true || !afterId) break;
  }
  return items.slice(0, wanted);
}

/** The text of the answer: all text blocks joined. */
export function textOf(answer: Record<string, unknown>): string {
  const content = Array.isArray(answer.content) ? answer.content : [];
  return content
    .map((block: unknown) =>
      typeof block === "object" &&
      block !== null &&
      "type" in block &&
      block.type === "text" &&
      "text" in block &&
      typeof block.text === "string"
        ? block.text
        : "",
    )
    .join("");
}
