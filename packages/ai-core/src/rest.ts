// SPDX-License-Identifier: AGPL-3.0-only
import { type Access, ANTHROPIC_VERSION, type CallOptions, signalOf } from "./access";
import { type Answer, errorOf, retryAfterOf } from "./errors";

// The plain HTTP calls: files, model lists, token counts, and the other calls that the AI SDK
// does not have.

/** The most items that "return all" collects. */
export const MAX_ITEMS = 5000;
const PAGE_SIZE = 100;

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
