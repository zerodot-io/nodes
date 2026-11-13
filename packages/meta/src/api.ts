// SPDX-License-Identifier: AGPL-3.0-only
import type { ResolvedCredential } from "@zerodot/node-sdk";

export const META_CREDENTIAL = "meta.api";

/** The Graph API hosts. Threads has its own host with its own version. */
export const GRAPH_HOST = "graph.facebook.com";
export const THREADS_HOST = "graph.threads.net";
export const THREADS_VERSION = "v1.0";

export type MetaAccess = { token: string; appSecret?: string };

/** The token, and the app secret of a credential, when it has one. */
export function metaAccess(
  credential: Pick<ResolvedCredential, "type" | "data"> | null,
): MetaAccess {
  if (!credential || credential.type !== META_CREDENTIAL) {
    throw new Error("The node needs a Meta credential");
  }
  const { accessToken, appSecret } = credential.data;
  if (typeof accessToken !== "string" || accessToken === "") {
    throw new Error('The credential has no "accessToken"');
  }
  return {
    token: accessToken,
    appSecret: typeof appSecret === "string" && appSecret !== "" ? appSecret : undefined,
  };
}

/** An error that the Graph API gave. `code` is the numeric error code, for example 190. */
export class GraphError extends Error {
  readonly code: string;
  readonly status: number;
  readonly subcode: string | undefined;

  constructor(message: string, code: string, status: number, subcode?: string) {
    super(message);
    this.name = "GraphError";
    this.code = code;
    this.status = status;
    this.subcode = subcode;
  }
}

/** Short help for the codes that people see most. */
const HINTS: Record<string, string> = {
  "2": "The request hit a temporary issue. Try again later",
  "4": "Too many requests from the app. Slow down",
  "17": "Too many requests from the user. Slow down",
  "32": "Too many requests. The page is over its rate limit",
  "100": "A parameter is missing, or its value is wrong",
  "102": "The session expired or was invalidated",
  "190": "The access token is invalid, expired, or was changed. Make a new long-lived token",
  "200": "The token does not have the permission that this call needs",
  "210": "The user ID is missing. Add the user ID of the call",
  "2500": "The path of the request is not valid",
};

type GraphProblem = {
  message?: string;
  type?: string;
  code?: number;
  error_subcode?: number;
  error_user_msg?: string;
  fbtrace_id?: string;
};

type GraphAnswer = Record<string, unknown> & { error?: GraphProblem };

/** The error for an answer with an `error` object. The text never has the token. */
export function graphErrorOf(label: string, status: number, answer: GraphAnswer | null) {
  const problem = answer?.error;
  const code = String(problem?.code ?? "no_answer");
  const parts = [`${label} failed (${status})`];
  if (problem?.message) parts.push(problem.message);
  if (problem?.error_user_msg) parts.push(problem.error_user_msg);
  const hint = HINTS[code];
  if (hint) parts.push(hint);
  return new GraphError(
    parts.join(". "),
    code,
    status,
    problem?.error_subcode ? String(problem.error_subcode) : undefined,
  );
}

export type GraphRequest = {
  host: string;
  version: string;
  path: string;
  method: "GET" | "POST";
  params: Record<string, unknown>;
};

/** Form fields for a Graph call. Empty values are left out. */
export function formBody(params: Record<string, unknown>): URLSearchParams {
  const form = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === "") continue;
    form.set(key, String(value));
  }
  return form;
}

/** One Graph API call. Both hosts accept form fields. */
export async function callGraph(
  access: MetaAccess,
  request: GraphRequest,
  options: { signal: AbortSignal; timeoutMs: number },
): Promise<Record<string, unknown>> {
  const url = new URL(`https://${request.host}/${request.version}${request.path}`);
  if (request.method === "GET") {
    const form = formBody({ access_token: access.token, ...request.params });
    for (const [key, value] of form) url.searchParams.set(key, value);
  }
  const response = await fetch(url, {
    method: request.method,
    headers: { "content-type": "application/x-www-form-urlencoded; charset=utf-8" },
    // The token goes in the body of a POST, never in the URL.
    body:
      request.method === "POST"
        ? formBody({ access_token: access.token, ...request.params })
        : undefined,
    redirect: "error",
    signal: AbortSignal.any([options.signal, AbortSignal.timeout(options.timeoutMs)]),
  });
  const answer = (await response.json().catch(() => null)) as GraphAnswer | null;
  if (!response.ok || answer?.error) throw graphErrorOf(request.path, response.status, answer);
  return answer ?? {};
}

/** The statuses of a media container: wait for this one. */
export const CONTAINER_FINISHED = "FINISHED";
/** The statuses that mean that the container will never publish. */
export const CONTAINER_FAILED = ["ERROR", "EXPIRED"];

export type ContainerStatus = {
  statusCode: string | undefined;
  raw: Record<string, unknown>;
};

const statusOf = (answer: Record<string, unknown>): string | undefined => {
  const code = answer.status_code ?? answer.status;
  return typeof code === "string" ? code : undefined;
};

/** The status of a media container. Instagram uses `status_code`, Threads uses `status`. */
export async function containerStatus(
  access: MetaAccess,
  request: GraphRequest,
  options: { signal: AbortSignal; timeoutMs: number },
): Promise<ContainerStatus> {
  const answer = await callGraph(access, request, options);
  return { statusCode: statusOf(answer), raw: answer };
}

/**
 * Polls a container until it is finished. Throws on error, or when it takes longer than
 * `maxWaitMs`. The media of Instagram and Threads are ready seconds after creation.
 */
export async function waitUntilFinished(
  access: MetaAccess,
  request: GraphRequest,
  options: { signal: AbortSignal; timeoutMs: number; maxWaitMs: number; intervalMs: number },
): Promise<Record<string, unknown>> {
  const deadline = Date.now() + options.maxWaitMs;
  for (;;) {
    const status = await containerStatus(access, request, options);
    const code = status.statusCode ?? "";
    if (code === CONTAINER_FINISHED) return status.raw;
    if (CONTAINER_FAILED.includes(code)) {
      throw new Error(`The media container failed with status "${code}"`);
    }
    if (Date.now() >= deadline) {
      throw new Error(
        `The media container did not finish in ${Math.round(options.maxWaitMs / 1000)} seconds (status "${code || "unknown"}")`,
      );
    }
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(resolve, options.intervalMs);
      options.signal.addEventListener(
        "abort",
        () => {
          clearTimeout(timer);
          reject(options.signal.reason);
        },
        { once: true },
      );
    });
  }
}

/** Media containers are at most 1 GB of data per reel, and the wait is at most 1 hour. */
export const MAX_WAIT_MS = 60 * 60 * 1000;
