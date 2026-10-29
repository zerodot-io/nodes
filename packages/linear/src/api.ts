// SPDX-License-Identifier: AGPL-3.0-only
import type { ResolvedCredential } from "@zerodot/node-sdk";

export const LINEAR_API_KEY_CREDENTIAL = "linear.apiKey";
export const LINEAR_OAUTH2_CREDENTIAL = "linear.oauth2";
export const LINEAR_API = "https://api.linear.app/graphql";

/** The most items that "return all" collects. A node output has a size limit too. */
export const MAX_ITEMS = 5000;
const PAGE_SIZE = 100;

export type LinearAccess = { authorization: string };

/**
 * The `Authorization` value of a Linear credential. A personal API key goes as it is.
 * An OAuth2 token has the `Bearer` prefix.
 */
export function linearAccess(credential: Pick<ResolvedCredential, "type" | "data"> | null) {
  if (
    !credential ||
    (credential.type !== LINEAR_API_KEY_CREDENTIAL && credential.type !== LINEAR_OAUTH2_CREDENTIAL)
  ) {
    throw new Error("The node needs a Linear credential");
  }
  if (credential.type === LINEAR_OAUTH2_CREDENTIAL) {
    const { accessToken } = credential.data;
    if (typeof accessToken !== "string" || accessToken === "") {
      throw new Error("The Linear credential is not connected to an account yet");
    }
    return { authorization: `Bearer ${accessToken}` } satisfies LinearAccess;
  }
  const { apiKey } = credential.data;
  if (typeof apiKey !== "string" || apiKey === "") {
    throw new Error('The credential has no "apiKey"');
  }
  return { authorization: apiKey } satisfies LinearAccess;
}

export type LinearRequest = {
  query: string;
  variables?: Record<string, unknown>;
  /**
   * The path to the list in `data`, with dots, for example `issues` or `issue.comments`. The
   * query must take `$first: Int!` and `$after: String`, and ask for
   * `pageInfo { hasNextPage endCursor }`.
   */
  connection?: string;
  /** The path to the result in `data` for a call that is not a list. */
  result?: string;
};

type CallOptions = { signal: AbortSignal; timeoutMs: number };

type GraphqlAnswer = {
  data?: Record<string, unknown> | null;
  errors?: { message?: string; extensions?: { code?: string } }[];
};

/** One GraphQL call. Returns `data`. Linear can answer 200 with `errors`, so both are checked. */
export async function callLinear(
  access: LinearAccess,
  request: Pick<LinearRequest, "query" | "variables">,
  options: CallOptions,
): Promise<Record<string, unknown>> {
  const response = await fetch(LINEAR_API, {
    method: "POST",
    headers: {
      authorization: access.authorization,
      "content-type": "application/json",
      "user-agent": "zerodot",
    },
    body: JSON.stringify({ query: request.query, variables: request.variables ?? {} }),
    redirect: "error",
    signal: AbortSignal.any([options.signal, AbortSignal.timeout(options.timeoutMs)]),
  });
  const answer = (await response.json().catch(() => null)) as GraphqlAnswer | null;
  if (!response.ok || (answer?.errors && answer.errors.length > 0)) {
    const message =
      answer?.errors
        ?.map((error) => error.message)
        .filter(Boolean)
        .join("; ") || "no message";
    const limited = answer?.errors?.some((error) => error.extensions?.code === "RATELIMITED");
    throw new Error(
      `Linear request failed (${response.status}): ${message}.${limited ? " The rate limit is reached. Try again later." : ""}`,
    );
  }
  if (!answer?.data) throw new Error("Linear sent no data");
  return answer.data;
}

/** The value at a path with dots, for example `issue.comments`. */
export function at(data: unknown, path: string): unknown {
  let value: unknown = data;
  for (const key of path.split(".")) {
    if (typeof value !== "object" || value === null) return undefined;
    value = (value as Record<string, unknown>)[key];
  }
  return value;
}

type Connection = {
  nodes?: unknown[];
  pageInfo?: { hasNextPage?: boolean; endCursor?: string | null };
};

/** A list. Follows the cursors until it has `limit` items, or all items when `limit` is null. */
export async function callLinearList(
  access: LinearAccess,
  request: LinearRequest,
  limit: number | null,
  options: CallOptions,
): Promise<unknown[]> {
  const field = request.connection;
  if (!field) throw new Error("The request is not a list");
  const wanted = Math.min(limit ?? MAX_ITEMS, MAX_ITEMS);
  const items: unknown[] = [];
  let after: string | null = null;
  while (items.length < wanted) {
    const data = await callLinear(
      access,
      {
        query: request.query,
        variables: {
          ...request.variables,
          first: Math.min(PAGE_SIZE, wanted - items.length),
          after,
        },
      },
      options,
    );
    const page = at(data, field) as Connection | undefined;
    if (!page || !Array.isArray(page.nodes)) throw new Error(`Linear sent no list for "${field}"`);
    items.push(...page.nodes);
    if (!page.pageInfo?.hasNextPage || !page.pageInfo.endCursor) break;
    after = page.pageInfo.endCursor;
  }
  return items.slice(0, wanted);
}
