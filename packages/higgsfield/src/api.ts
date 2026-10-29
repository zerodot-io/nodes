// SPDX-License-Identifier: AGPL-3.0-only
import type { ResolvedCredential } from "@zerodot/node-sdk";

export const HIGGSFIELD_CREDENTIAL = "higgsfield.account";
export const HIGGSFIELD_API = "https://api.higgsfield.ai";

/** A request in one of these states does not change again. */
export const TERMINAL_STATUSES = ["completed", "failed", "nsfw", "canceled"] as const;

const POLL_START_MS = 2_000;
const POLL_MAX_MS = 10_000;
/** A failed call is tried again at most this many times. */
const RETRIES = 2;

export type HiggsfieldAccess = { keyId: string; keySecret: string };
export type CallOptions = { signal: AbortSignal; timeoutMs: number };
export type Sleep = (ms: number, signal: AbortSignal) => Promise<void>;
export type Answer = Record<string, unknown>;

export type Call = {
  method: "GET" | "POST" | "DELETE";
  path: string;
  body?: Record<string, unknown>;
  headers?: Record<string, string>;
};

/** The API key of a credential. */
export function higgsfieldAccess(
  credential: Pick<ResolvedCredential, "type" | "data"> | null,
): HiggsfieldAccess {
  if (!credential || credential.type !== HIGGSFIELD_CREDENTIAL) {
    throw new Error("The node needs a Higgsfield credential");
  }
  const { keyId, keySecret } = credential.data;
  if (typeof keyId !== "string" || keyId === "") {
    throw new Error('The credential has no "keyId"');
  }
  if (typeof keySecret !== "string" || keySecret === "") {
    throw new Error('The credential has no "keySecret"');
  }
  return { keyId, keySecret };
}

export const authHeader = (access: HiggsfieldAccess): string =>
  `Key ${access.keyId}:${access.keySecret}`;

/** An error that Higgsfield gave. `status` is the HTTP status. */
export class HiggsfieldError extends Error {
  readonly status: number;
  readonly retryAfter: number | undefined;

  constructor(message: string, status: number, retryAfter?: number) {
    super(message);
    this.name = "HiggsfieldError";
    this.status = status;
    this.retryAfter = retryAfter;
  }
}

/** Short help for the errors that people see most. */
const HINTS: Record<number, string> = {
  401: "Higgsfield did not accept the API key",
  403: "The account has not enough balance",
  404: "Higgsfield did not find the request or the model. Check the model path and the request ID",
  409: "The request is still running. Try again when it is done",
  422: "Higgsfield did not accept the parameters",
  423: "The model is blocked for a short time. Try again later",
  429: "Higgsfield limits the requests. Try again later",
  503: "The model is not ready. Try again later",
};

/** The `detail` of an error answer is a text, a list, or an object with a message. */
function detailOf(answer: Answer | null): string | undefined {
  const detail = answer?.detail;
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail)) {
    const texts = detail.map((entry) => {
      if (typeof entry === "string") return entry;
      const item = entry as { loc?: unknown; msg?: unknown } | null;
      if (typeof item?.msg !== "string") return undefined;
      const where = Array.isArray(item.loc) ? item.loc.filter((part) => part !== "body") : [];
      return where.length > 0 ? `${where.join(".")}: ${item.msg}` : item.msg;
    });
    const text = texts.filter(Boolean).join("; ");
    return text === "" ? undefined : text;
  }
  const message = (detail as { message?: unknown } | undefined)?.message;
  return typeof message === "string" ? message : undefined;
}

/** The error for an answer with an error status. The text never has the key. */
export function higgsfieldErrorOf(
  label: string,
  status: number,
  answer: Answer | null,
  retryAfter?: number,
): HiggsfieldError {
  const parts = [`Higgsfield ${label} failed (${status})`];
  const detail = detailOf(answer);
  if (detail) parts.push(detail);
  const hint = HINTS[status];
  if (hint) parts.push(hint);
  if (retryAfter !== undefined) parts.push(`Try again in ${retryAfter} seconds`);
  return new HiggsfieldError(parts.join(". "), status, retryAfter);
}

const retryAfterOf = (header: string | null): number | undefined => {
  const seconds = Number(header);
  return header !== null && Number.isFinite(seconds) && seconds >= 0 ? seconds : undefined;
};

/** One call. An answer without a body (cancel gives 202) is `{}`. */
export async function callHiggsfield(
  access: HiggsfieldAccess,
  call: Call,
  options: CallOptions,
): Promise<Answer> {
  const response = await fetch(`${HIGGSFIELD_API}${call.path}`, {
    method: call.method,
    headers: {
      authorization: authHeader(access),
      accept: "application/json",
      ...(call.body ? { "content-type": "application/json" } : {}),
      ...call.headers,
    },
    body: call.body ? JSON.stringify(call.body) : undefined,
    redirect: "error",
    signal: AbortSignal.any([options.signal, AbortSignal.timeout(options.timeoutMs)]),
  });
  const text = await response.text();
  let answer: Answer | null = null;
  try {
    const value: unknown = text === "" ? null : JSON.parse(text);
    if (typeof value === "object" && value !== null && !Array.isArray(value)) {
      answer = value as Answer;
    }
  } catch {
    // An answer that is not JSON has no detail. The status is enough.
  }
  const label = `${call.method} ${call.path.split("/").slice(0, 2).join("/")}`;
  if (!response.ok) {
    throw higgsfieldErrorOf(
      label,
      response.status,
      answer,
      retryAfterOf(response.headers.get("retry-after")),
    );
  }
  return answer ?? {};
}

export const sleep: Sleep = (ms, signal) =>
  new Promise((resolve, reject) => {
    if (signal.aborted) return reject(signal.reason);
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal.reason);
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });

/** A network error, a timeout, a 500, or a 503 can pass when the call is tried again. */
const canRetry = (error: unknown, signal: AbortSignal): boolean => {
  if (signal.aborted) return false;
  if (error instanceof HiggsfieldError) return error.status === 500 || error.status === 503;
  return true;
};

/**
 * One call, tried again after a network error, a 500, or a 503.
 * Only use it for a call that is safe to repeat: a status check, or a submission with an
 * `Idempotency-Key`.
 */
export async function callWithRetry(
  access: HiggsfieldAccess,
  call: Call,
  options: CallOptions,
  wait: Sleep = sleep,
): Promise<Answer> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await callHiggsfield(access, call, options);
    } catch (error) {
      if (attempt >= RETRIES || !canRetry(error, options.signal)) throw error;
      await wait(1_000 * 2 ** attempt + Math.random() * 250, options.signal);
    }
  }
}

export const isTerminal = (status: unknown): boolean =>
  typeof status === "string" && (TERMINAL_STATUSES as readonly string[]).includes(status);

/** The status of a request, from the first call or later. */
export const requestStatus = (
  access: HiggsfieldAccess,
  requestId: string,
  options: CallOptions,
  wait?: Sleep,
): Promise<Answer> =>
  callWithRetry(access, { method: "GET", path: `/requests/${requestId}/status` }, options, wait);

export type WaitOptions = CallOptions & { waitTimeoutMs: number; sleep?: Sleep };

/** Checks the status with a growing pause until the request is done or the time is up. */
export async function waitForRequest(
  access: HiggsfieldAccess,
  requestId: string,
  options: WaitOptions,
): Promise<Answer> {
  const wait = options.sleep ?? sleep;
  const deadline = Date.now() + options.waitTimeoutMs;
  let delay = POLL_START_MS;
  for (;;) {
    const status = await requestStatus(access, requestId, options, wait);
    if (isTerminal(status.status)) return status;
    if (Date.now() + delay > deadline) {
      throw new Error(
        `Higgsfield request ${requestId} did not finish in ${Math.round(options.waitTimeoutMs / 1000)} seconds. ` +
          `It is "${String(status.status)}". Use Get with the request ID to check it later`,
      );
    }
    await wait(delay + Math.random() * 500, options.signal);
    delay = Math.min(delay * 1.5, POLL_MAX_MS);
  }
}

const urlOf = (value: unknown): string | undefined => {
  const url = (value as { url?: unknown } | null)?.url;
  return typeof url === "string" && url !== "" ? url : undefined;
};

/** The URLs of the files in a finished request: images, video, audio, and other files. */
export function outputUrls(answer: Answer): string[] {
  const urls = new Set<string>();
  for (const value of Object.values(answer)) {
    const entries = Array.isArray(value) ? value : [value];
    for (const entry of entries) {
      const url = urlOf(entry);
      if (url) urls.add(url);
    }
  }
  return [...urls];
}
