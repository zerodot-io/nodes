// SPDX-License-Identifier: AGPL-3.0-only
import type { ResolvedCredential } from "@zerodot/node-sdk";

export const FEEDBACKJAR_CREDENTIAL = "feedbackjar.token";
export const FEEDBACKJAR_API = "https://api.feedbackjar.com/api/v1";

/** The most items that "return all" collects. A node output has a size limit too. */
export const MAX_ITEMS = 5000;
/** The most posts that FeedbackJar gives in one page. */
const PAGE_SIZE = 100;

/** An account token starts with this. A project token starts with `fj_live_`. */
const ACCOUNT_PREFIX = "fj_user_";

export type FeedbackjarAccess = { token: string; baseUrl: string; organizationId?: string };

const text = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim() !== "" ? value.trim() : undefined;

/**
 * The token and the API address of a FeedbackJar credential. An account token (`fj_user_`) works
 * for many projects, so the calls need the project ID, except the list of projects.
 */
export function feedbackjarAccess(
  credential: Pick<ResolvedCredential, "type" | "data"> | null,
  options: { needsOrganization: boolean } = { needsOrganization: true },
): FeedbackjarAccess {
  if (!credential || credential.type !== FEEDBACKJAR_CREDENTIAL) {
    throw new Error("The node needs a FeedbackJar credential");
  }
  const token = text(credential.data.apiToken);
  if (!token) throw new Error('The credential has no "apiToken"');
  const organizationId = text(credential.data.organizationId);
  if (options.needsOrganization && token.startsWith(ACCOUNT_PREFIX) && !organizationId) {
    throw new Error(
      'An account token needs the "organizationId" (the project ID) in the credential. Use the Organization "Get Many" operation to find it',
    );
  }
  const base = text(credential.data.server) ?? FEEDBACKJAR_API;
  return { token, baseUrl: base.replace(/\/+$/, ""), organizationId };
}

export type FeedbackjarRequest = {
  method: string;
  /** Starts with `/`. */
  path: string;
  query?: Record<string, string | number | undefined>;
  body?: Record<string, unknown>;
};

export type CallOptions = { signal: AbortSignal; timeoutMs: number };

function urlFor(access: FeedbackjarAccess, request: FeedbackjarRequest): URL {
  const url = new URL(`${access.baseUrl}${request.path}`);
  for (const [key, value] of Object.entries(request.query ?? {})) {
    if (value !== undefined && value !== "") url.searchParams.set(key, String(value));
  }
  return url;
}

/** One call. The error text never has the token. */
export async function callFeedbackjar(
  access: FeedbackjarAccess,
  request: FeedbackjarRequest,
  options: CallOptions,
): Promise<unknown> {
  const response = await fetch(urlFor(access, request), {
    method: request.method,
    headers: {
      authorization: `Bearer ${access.token}`,
      accept: "application/json",
      "user-agent": "zerodot",
      ...(access.organizationId ? { "x-organization-id": access.organizationId } : {}),
      ...(request.body ? { "content-type": "application/json" } : {}),
    },
    body: request.body ? JSON.stringify(request.body) : undefined,
    redirect: "error",
    signal: AbortSignal.any([options.signal, AbortSignal.timeout(options.timeoutMs)]),
  });
  if (!response.ok) {
    const answer = (await response.json().catch(() => null)) as { error?: string } | null;
    const hint =
      response.status === 401
        ? " Check the API token."
        : response.status === 403
          ? " Check that the token has the permission for this call."
          : "";
    throw new Error(
      `FeedbackJar ${request.method} ${request.path} failed (${response.status}): ${answer?.error ?? "no message"}.${hint}`,
    );
  }
  return response.status === 204 ? null : ((await response.json().catch(() => null)) as unknown);
}

/**
 * A list of posts. FeedbackJar answers with `{ items, nextCursor }`. This follows the cursor until
 * it has `limit` items, or all items when `limit` is null.
 */
export async function callFeedbackjarList(
  access: FeedbackjarAccess,
  request: FeedbackjarRequest,
  limit: number | null,
  options: CallOptions,
): Promise<unknown[]> {
  const wanted = Math.min(limit ?? MAX_ITEMS, MAX_ITEMS);
  const items: unknown[] = [];
  let cursor: string | undefined;
  do {
    const page = await callFeedbackjar(
      access,
      {
        ...request,
        query: {
          ...request.query,
          limit: Math.min(PAGE_SIZE, wanted - items.length),
          cursor,
        },
      },
      options,
    );
    if (typeof page !== "object" || page === null) break;
    const found = (page as { items?: unknown; nextCursor?: unknown }).items;
    if (Array.isArray(found)) items.push(...found);
    const next = (page as { nextCursor?: unknown }).nextCursor;
    cursor = typeof next === "string" && next !== "" ? next : undefined;
  } while (cursor && items.length < wanted);
  return items.slice(0, wanted);
}
