// SPDX-License-Identifier: AGPL-3.0-only
import type { ResolvedCredential } from "@zerodot/node-sdk";

export const STRIPE_CREDENTIAL = "stripe.account";
export const STRIPE_API = "https://api.stripe.com";

/** The most items that "return all" collects. A node output has a size limit too. */
export const MAX_ITEMS = 5000;
const PAGE_SIZE = 100;

export type StripeAccess = { secretKey: string; webhookSecret: string | undefined };
export type CallOptions = { signal: AbortSignal; timeoutMs: number };

/** The secret key and the webhook secret of a credential. */
export function stripeAccess(
  credential: Pick<ResolvedCredential, "type" | "data"> | null,
): StripeAccess {
  if (!credential || credential.type !== STRIPE_CREDENTIAL) {
    throw new Error("The node needs a Stripe credential");
  }
  const { secretKey, webhookSecret } = credential.data;
  if (typeof secretKey !== "string" || secretKey === "") {
    throw new Error('The credential has no "secretKey"');
  }
  return {
    secretKey,
    webhookSecret:
      typeof webhookSecret === "string" && webhookSecret !== "" ? webhookSecret : undefined,
  };
}

/** An error that Stripe gave. `code` is the Stripe error code, for example resource_missing. */
export class StripeError extends Error {
  readonly code: string | undefined;
  readonly status: number;
  readonly retryAfter: number | undefined;

  constructor(message: string, status: number, code?: string, retryAfter?: number) {
    super(message);
    this.name = "StripeError";
    this.code = code;
    this.status = status;
    this.retryAfter = retryAfter;
  }
}

/** Short help for the errors that people see most. */
const HINTS: Record<string, string> = {
  invalid_api_key: "Stripe did not accept the secret key",
  api_key_expired: "The secret key expired. Make a new key",
  rate_limit: "Stripe limits the requests. Try again later",
  resource_missing: "Stripe did not find the resource. Check the ID",
  parameter_missing: "A needed field is missing",
  parameter_invalid_empty: "A field has an empty value that is not allowed",
  amount_too_small: "The amount is less than the minimum for this currency",
  card_declined: "The card was declined",
  charge_already_refunded: "The charge has a full refund already",
  payment_intent_unexpected_state: "The payment intent is not in a state that allows this action",
  invoice_not_editable: "The invoice is final. Void it or make a new one",
  idempotency_key_in_use: "A request with this Idempotency Key is in progress. Try again later",
};

type StripeAnswer = Record<string, unknown> & {
  error?: {
    type?: string;
    code?: string;
    message?: string;
    param?: string;
    decline_code?: string;
  };
};

/** The error for an answer with an error status. The text never has the key. */
export function stripeErrorOf(label: string, status: number, answer: StripeAnswer | null) {
  const error = answer?.error;
  const code = typeof error?.code === "string" ? error.code : undefined;
  const parts = [`Stripe ${label} failed (${status})`];
  if (typeof error?.message === "string" && error.message) parts.push(error.message);
  const hint = code === undefined ? undefined : HINTS[code];
  if (hint) parts.push(hint);
  if (code !== undefined) parts.push(`Error code ${code}`);
  return new StripeError(parts.join(". "), status, code);
}

function append(form: URLSearchParams, key: string, value: unknown): void {
  if (value === undefined || value === null || value === "") return;
  if (Array.isArray(value)) {
    value.forEach((entry, index) => {
      append(form, `${key}[${index}]`, entry);
    });
  } else if (typeof value === "object") {
    for (const [name, entry] of Object.entries(value as Record<string, unknown>)) {
      append(form, `${key}[${name}]`, entry);
    }
  } else {
    form.append(key, String(value));
  }
}

/**
 * Form fields for a call, in the style that Stripe wants: `metadata[a]=b` for an object and
 * `items[0][price]=x` for a list. Empty values are left out. `false` and `0` stay.
 */
export function formBody(args: Record<string, unknown>): URLSearchParams {
  const form = new URLSearchParams();
  for (const [key, value] of Object.entries(args)) append(form, key, value);
  return form;
}

const retryAfterOf = (header: string | null): number | undefined => {
  const seconds = Number(header);
  return header !== null && Number.isFinite(seconds) && seconds >= 0 ? seconds : undefined;
};

export const bearerAuth = (access: StripeAccess): string => `Bearer ${access.secretKey}`;

export type Call = {
  method: "GET" | "POST" | "DELETE";
  /** The path of the API, for example `/v1/customers`. */
  path: string;
  /** Form fields of a POST, or the query of a GET. */
  args?: Record<string, unknown>;
  /** Stripe runs a POST with the same key only once. */
  idempotencyKey?: string;
};

/**
 * One call. A POST has a form body. HTTP 429 means a rate limit.
 */
export async function callStripe(
  access: StripeAccess,
  call: Call,
  options: CallOptions,
): Promise<Record<string, unknown>> {
  const form = formBody(call.args ?? {});
  const url = new URL(`${STRIPE_API}${call.path}`);
  if (call.method === "GET") {
    for (const [key, value] of form) url.searchParams.append(key, value);
  }
  const label = `${call.method} ${call.path}`;
  const response = await fetch(url, {
    method: call.method,
    headers: {
      authorization: bearerAuth(access),
      accept: "application/json",
      ...(call.method === "POST"
        ? { "content-type": "application/x-www-form-urlencoded; charset=utf-8" }
        : {}),
      ...(call.method === "POST" && call.idempotencyKey
        ? { "idempotency-key": call.idempotencyKey }
        : {}),
    },
    body: call.method === "POST" ? form : undefined,
    redirect: "error",
    signal: AbortSignal.any([options.signal, AbortSignal.timeout(options.timeoutMs)]),
  });
  if (response.status === 429) {
    const retryAfter = retryAfterOf(response.headers.get("retry-after"));
    const wait = retryAfter === undefined ? "" : ` Try again in ${retryAfter} seconds`;
    throw new StripeError(
      `Stripe ${label} failed (429). ${HINTS.rate_limit}.${wait}`,
      429,
      "rate_limit",
      retryAfter,
    );
  }
  const answer = (await response.json().catch(() => null)) as StripeAnswer | null;
  if (!response.ok) throw stripeErrorOf(label, response.status, answer);
  return answer ?? {};
}

/**
 * A list. Follows `has_more` with `starting_after` until it has `limit` items, or all items
 * when `limit` is null.
 */
export async function callStripeList(
  access: StripeAccess,
  path: string,
  args: Record<string, unknown>,
  limit: number | null,
  options: CallOptions,
): Promise<unknown[]> {
  const wanted = Math.min(limit ?? MAX_ITEMS, MAX_ITEMS);
  const items: unknown[] = [];
  let after: string | undefined;
  while (items.length < wanted) {
    const page = await callStripe(
      access,
      {
        method: "GET",
        path,
        args: { ...args, limit: Math.min(PAGE_SIZE, wanted - items.length), starting_after: after },
      },
      options,
    );
    const found: unknown[] = Array.isArray(page.data) ? page.data : [];
    items.push(...found);
    const last = found.at(-1);
    const id = typeof last === "object" && last !== null && "id" in last ? last.id : undefined;
    if (page.has_more !== true || typeof id !== "string") break;
    after = id;
  }
  return items.slice(0, wanted);
}
