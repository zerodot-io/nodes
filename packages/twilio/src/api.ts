// SPDX-License-Identifier: AGPL-3.0-only
import type { ResolvedCredential } from "@zerodot/node-sdk";

export const TWILIO_CREDENTIAL = "twilio.account";
export const TWILIO_API = "https://api.twilio.com";
export const TWILIO_LOOKUP_API = "https://lookups.twilio.com";

/** The most items that "return all" collects. A node output has a size limit too. */
export const MAX_ITEMS = 5000;
const PAGE_SIZE = 100;

export type TwilioAccess = { accountSid: string; authToken: string };
export type CallOptions = { signal: AbortSignal; timeoutMs: number };

/** The Account SID and the Auth Token of a credential. */
export function twilioAccess(
  credential: Pick<ResolvedCredential, "type" | "data"> | null,
): TwilioAccess {
  if (!credential || credential.type !== TWILIO_CREDENTIAL) {
    throw new Error("The node needs a Twilio credential");
  }
  const { accountSid, authToken } = credential.data;
  if (typeof accountSid !== "string" || accountSid === "") {
    throw new Error('The credential has no "accountSid"');
  }
  if (typeof authToken !== "string" || authToken === "") {
    throw new Error('The credential has no "authToken"');
  }
  return { accountSid, authToken };
}

/** An error that Twilio gave. `code` is the Twilio error code, for example 21211. */
export class TwilioError extends Error {
  readonly code: number | undefined;
  readonly status: number;
  readonly retryAfter: number | undefined;

  constructor(message: string, status: number, code?: number, retryAfter?: number) {
    super(message);
    this.name = "TwilioError";
    this.code = code;
    this.status = status;
    this.retryAfter = retryAfter;
  }
}

/** Short help for the errors that people see most. */
const HINTS: Record<number, string> = {
  20003: "Twilio did not accept the Account SID and the Auth Token",
  20404: "Twilio did not find the resource. Check the SID",
  20429: "Twilio limits the requests. Try again later",
  21211: "The To number is not valid. Use the E.164 format, such as +14155550100",
  21212: "The From number is not valid",
  21408: "Your account cannot send to this region. Turn it on in Geo Permissions",
  21606: "The From number cannot send messages. Use a number of your account",
  21608: "A trial account can send only to verified numbers",
  21610: "The recipient stopped the messages from this number",
  21611: "The From number has a full queue. Try again later",
  21614: "The To number cannot get messages",
  21617: "The message is longer than 1600 characters",
  21620: "The media URL is not valid",
  21705: "The Messaging Service SID is not valid",
  30007: "A carrier filtered the message",
  63016: "WhatsApp allows free text only in the 24 hours after a user message. Use a template",
};

type TwilioAnswer = Record<string, unknown> & {
  code?: number;
  message?: string;
  more_info?: string;
  next_page_uri?: string | null;
};

/** The error for an answer with an error status. The text never has the token. */
export function twilioErrorOf(label: string, status: number, answer: TwilioAnswer | null) {
  const code = typeof answer?.code === "number" ? answer.code : undefined;
  const parts = [`Twilio ${label} failed (${status})`];
  if (typeof answer?.message === "string" && answer.message) parts.push(answer.message);
  const hint = code === undefined ? undefined : HINTS[code];
  if (hint) parts.push(hint);
  if (code !== undefined) parts.push(`Error code ${code}`);
  return new TwilioError(parts.join(". "), status, code);
}

/** Form fields for a call. Arrays repeat the key. Empty values are left out. */
export function formBody(args: Record<string, unknown>): URLSearchParams {
  const form = new URLSearchParams();
  for (const [key, value] of Object.entries(args)) {
    if (value === undefined || value === null || value === "") continue;
    if (Array.isArray(value)) {
      for (const entry of value) form.append(key, String(entry));
    } else {
      form.set(key, String(value));
    }
  }
  return form;
}

const retryAfterOf = (header: string | null): number | undefined => {
  const seconds = Number(header);
  return header !== null && Number.isFinite(seconds) && seconds >= 0 ? seconds : undefined;
};

export const basicAuth = (access: TwilioAccess): string =>
  `Basic ${Buffer.from(`${access.accountSid}:${access.authToken}`).toString("base64")}`;

/** The address of a path of the account, for example `Messages.json`. */
export const accountUrl = (accountSid: string, path: string): string =>
  `${TWILIO_API}/2010-04-01/Accounts/${encodeURIComponent(accountSid)}/${path}`;

export type Call = {
  method: "GET" | "POST" | "DELETE";
  url: string;
  /** Form fields of a POST, or the query of a GET. */
  args?: Record<string, unknown>;
};

/**
 * One call. A POST has a form body. Twilio answers 204 without a body for a delete.
 * HTTP 429 means a rate limit.
 */
export async function callTwilio(
  access: TwilioAccess,
  call: Call,
  options: CallOptions,
): Promise<Record<string, unknown>> {
  const form = formBody(call.args ?? {});
  const url = new URL(call.url);
  if (call.method === "GET") {
    for (const [key, value] of form) url.searchParams.append(key, value);
  }
  const label = `${call.method} ${url.pathname
    .split("/")
    .slice(-1)[0]
    ?.replace(/\.json$/, "")}`;
  const response = await fetch(url, {
    method: call.method,
    headers: {
      authorization: basicAuth(access),
      accept: "application/json",
      ...(call.method === "POST"
        ? { "content-type": "application/x-www-form-urlencoded; charset=utf-8" }
        : {}),
    },
    body: call.method === "POST" ? form : undefined,
    redirect: "error",
    signal: AbortSignal.any([options.signal, AbortSignal.timeout(options.timeoutMs)]),
  });
  if (response.status === 429) {
    const retryAfter = retryAfterOf(response.headers.get("retry-after"));
    const wait = retryAfter === undefined ? "" : ` Try again in ${retryAfter} seconds`;
    throw new TwilioError(
      `Twilio ${label} failed (429). ${HINTS[20429]}.${wait}`,
      429,
      20429,
      retryAfter,
    );
  }
  if (response.status === 204) return {};
  const answer = (await response.json().catch(() => null)) as TwilioAnswer | null;
  if (!response.ok) throw twilioErrorOf(label, response.status, answer);
  return answer ?? {};
}

/**
 * A list. Follows `next_page_uri` until it has `limit` items, or all items when `limit` is null.
 * The next page must stay on the Twilio API host.
 */
export async function callTwilioList(
  access: TwilioAccess,
  url: string,
  args: Record<string, unknown>,
  itemsKey: string,
  limit: number | null,
  options: CallOptions,
): Promise<unknown[]> {
  const wanted = Math.min(limit ?? MAX_ITEMS, MAX_ITEMS);
  const items: unknown[] = [];
  let next: string | undefined = url;
  let first = true;
  while (next && items.length < wanted) {
    const page: Record<string, unknown> = await callTwilio(
      access,
      {
        method: "GET",
        url: next,
        // The next page address has the query already.
        args: first ? { ...args, PageSize: Math.min(PAGE_SIZE, wanted) } : undefined,
      },
      options,
    );
    first = false;
    const found = page[itemsKey];
    if (Array.isArray(found)) items.push(...found);
    const uri = page.next_page_uri;
    next = typeof uri === "string" && uri !== "" ? new URL(uri, TWILIO_API).href : undefined;
    if (next && new URL(next).origin !== TWILIO_API) {
      throw new Error("Twilio gave a next page address on another host");
    }
  }
  return items.slice(0, wanted);
}
