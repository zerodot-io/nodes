// SPDX-License-Identifier: AGPL-3.0-only
import type { ResolvedCredential } from "@zerodot/node-sdk";

export const NOTION_CREDENTIAL = "notion.integration";
export const NOTION_API = "https://api.notion.com";
/** The API version that the node sends in each call. */
export const NOTION_VERSION = "2026-03-11";

/** The most items that "return all" collects. A node output has a size limit too. */
export const MAX_ITEMS = 5000;
const PAGE_SIZE = 100;

export type NotionAccess = { token: string };
export type CallOptions = { signal: AbortSignal; timeoutMs: number };

/** The integration token of a credential. */
export function notionAccess(
  credential: Pick<ResolvedCredential, "type" | "data"> | null,
): NotionAccess {
  if (!credential || credential.type !== NOTION_CREDENTIAL) {
    throw new Error("The node needs a Notion credential");
  }
  const { token } = credential.data;
  if (typeof token !== "string" || token === "") {
    throw new Error('The credential has no "token"');
  }
  return { token };
}

/** An error that Notion gave. `code` is the Notion error code, for example `object_not_found`. */
export class NotionError extends Error {
  readonly code: string | undefined;
  readonly status: number;
  readonly retryAfter: number | undefined;

  constructor(message: string, status: number, code?: string, retryAfter?: number) {
    super(message);
    this.name = "NotionError";
    this.code = code;
    this.status = status;
    this.retryAfter = retryAfter;
  }
}

/** Short help for the errors that people see most. */
const HINTS: Record<string, string> = {
  unauthorized: "Notion did not accept the token",
  restricted_resource: "The integration cannot do this. Check its capabilities",
  object_not_found:
    "Notion did not find the object, or the integration has no access. Share the page or database with the integration",
  rate_limited: "Notion limits the requests. Try again later",
  conflict_error: "The object changed while Notion saved it. Try again",
  validation_error: "Notion did not accept the data. Check the IDs and the JSON",
};

type NotionAnswer = Record<string, unknown> & {
  code?: string;
  message?: string;
  has_more?: boolean;
  next_cursor?: string | null;
};

/** The error for an answer with an error status. The text never has the token. */
export function notionErrorOf(label: string, status: number, answer: NotionAnswer | null) {
  const code = typeof answer?.code === "string" ? answer.code : undefined;
  const parts = [`Notion ${label} failed (${status})`];
  if (typeof answer?.message === "string" && answer.message) parts.push(answer.message);
  const hint = code === undefined ? undefined : HINTS[code];
  if (hint) parts.push(hint);
  if (code !== undefined) parts.push(`Error code ${code}`);
  return new NotionError(parts.join(". "), status, code);
}

const retryAfterOf = (header: string | null): number | undefined => {
  const seconds = Number(header);
  return header !== null && Number.isFinite(seconds) && seconds >= 0 ? seconds : undefined;
};

export type Call = {
  method: "GET" | "POST" | "PATCH" | "DELETE";
  /** A path of the Notion API, for example `/v1/pages`. */
  path: string;
  /** The query of the address. Empty values are left out. */
  query?: Record<string, unknown>;
  /** The JSON body of a POST or a PATCH. */
  body?: Record<string, unknown>;
};

/** The address of a call. The host is always the Notion API. */
function urlOf(call: Call): URL {
  const url = new URL(call.path, NOTION_API);
  for (const [key, value] of Object.entries(call.query ?? {})) {
    if (value === undefined || value === null || value === "") continue;
    url.searchParams.set(key, String(value));
  }
  return url;
}

/** One call. HTTP 429 means a rate limit. */
export async function callNotion(
  access: NotionAccess,
  call: Call,
  options: CallOptions,
): Promise<NotionAnswer> {
  const url = urlOf(call);
  const label = `${call.method} ${url.pathname.split("/").slice(2, 3)[0] ?? ""}`.trim();
  const response = await fetch(url, {
    method: call.method,
    headers: {
      authorization: `Bearer ${access.token}`,
      "notion-version": NOTION_VERSION,
      accept: "application/json",
      ...(call.body ? { "content-type": "application/json" } : {}),
    },
    body: call.body ? JSON.stringify(call.body) : undefined,
    redirect: "error",
    signal: AbortSignal.any([options.signal, AbortSignal.timeout(options.timeoutMs)]),
  });
  if (response.status === 429) {
    const retryAfter = retryAfterOf(response.headers.get("retry-after"));
    const wait = retryAfter === undefined ? "" : ` Try again in ${retryAfter} seconds`;
    throw new NotionError(
      `Notion ${label} failed (429). ${HINTS.rate_limited}.${wait}`,
      429,
      "rate_limited",
      retryAfter,
    );
  }
  const answer = (await response.json().catch(() => null)) as NotionAnswer | null;
  if (!response.ok) throw notionErrorOf(label, response.status, answer);
  return answer ?? {};
}

/**
 * A list. Follows `next_cursor` until it has `limit` items, or all items when `limit` is null.
 * A POST sends the cursor in the body. A GET sends it in the query.
 */
export async function callNotionList(
  access: NotionAccess,
  call: Call,
  limit: number | null,
  options: CallOptions,
): Promise<unknown[]> {
  const wanted = Math.min(limit ?? MAX_ITEMS, MAX_ITEMS);
  const items: unknown[] = [];
  let cursor: string | undefined;
  while (items.length < wanted) {
    const paging = { start_cursor: cursor, page_size: Math.min(PAGE_SIZE, wanted - items.length) };
    const page = await callNotion(
      access,
      call.method === "GET"
        ? { ...call, query: { ...call.query, ...paging } }
        : { ...call, body: { ...call.body, ...paging } },
      options,
    );
    if (Array.isArray(page.results)) items.push(...page.results);
    if (!page.has_more || typeof page.next_cursor !== "string" || page.next_cursor === "") break;
    cursor = page.next_cursor;
  }
  return items.slice(0, wanted);
}
