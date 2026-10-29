// SPDX-License-Identifier: AGPL-3.0-only
import { createHash, createSign } from "node:crypto";
import type { ResolvedCredential } from "@zerodot/node-sdk";

export const CALENDAR_OAUTH2_CREDENTIAL = "google_calendar.oauth2";
export const CALENDAR_SERVICE_ACCOUNT_CREDENTIAL = "google_calendar.service_account";
export const CALENDAR_API = "https://www.googleapis.com/calendar/v3";
export const TOKEN_URL = "https://oauth2.googleapis.com/token";
export const CALENDAR_SCOPE = "https://www.googleapis.com/auth/calendar";

/** A token is fetched again this long before it ends. */
const REFRESH_WINDOW_MS = 60_000;
const TOKEN_LIFETIME_S = 3600;

export type CallOptions = { signal: AbortSignal; timeoutMs: number };

const text = (value: unknown): string | undefined =>
  typeof value === "string" && value !== "" ? value : undefined;

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

// ---------------------------------------------------------------------------------------------
// Service account

export type ServiceAccountKey = {
  client_email: string;
  private_key: string;
  private_key_id?: string;
};

/** The fields of a JSON key file. Throws with a short message when the text is not a key. */
export function parseServiceAccountKey(json: string): ServiceAccountKey {
  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch {
    throw new Error("The service account key is not valid JSON");
  }
  if (!isObject(value)) throw new Error("The service account key must be a JSON object");
  const email = text(value.client_email);
  const key = text(value.private_key);
  if (!email || !key) {
    throw new Error('The service account key needs "client_email" and "private_key"');
  }
  return { client_email: email, private_key: key, private_key_id: text(value.private_key_id) };
}

const base64url = (value: string | Buffer) => Buffer.from(value).toString("base64url");

/** A signed JWT (RS256) that asks Google for an access token. `now` is in milliseconds. */
export function signJwt(key: ServiceAccountKey, now: number, scope = CALENDAR_SCOPE): string {
  const iat = Math.floor(now / 1000);
  const header = {
    alg: "RS256",
    typ: "JWT",
    ...(key.private_key_id && { kid: key.private_key_id }),
  };
  const claims = {
    iss: key.client_email,
    scope,
    aud: TOKEN_URL,
    iat,
    exp: iat + TOKEN_LIFETIME_S,
  };
  const unsigned = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(claims))}`;
  let signature: Buffer;
  try {
    signature = createSign("RSA-SHA256").update(unsigned).sign(key.private_key);
  } catch {
    throw new Error("The private key of the service account is not valid");
  }
  return `${unsigned}.${base64url(signature)}`;
}

type CachedToken = { token: string; expiresAt: number };
const tokenCache = new Map<string, CachedToken>();

/** For tests. */
export const clearTokenCache = () => tokenCache.clear();

/** The cache key never has the private key itself. */
const cacheKey = (key: ServiceAccountKey) =>
  `${key.client_email}\n${createHash("sha256").update(key.private_key).digest("hex")}`;

/** An access token for a service account. It is cached until near its end. */
export async function serviceAccountToken(
  key: ServiceAccountKey,
  options: { signal?: AbortSignal; timeoutMs?: number; now?: () => number } = {},
): Promise<string> {
  const now = options.now ?? Date.now;
  const id = cacheKey(key);
  const cached = tokenCache.get(id);
  if (cached && cached.expiresAt - now() > REFRESH_WINDOW_MS) return cached.token;

  const signals = [AbortSignal.timeout(options.timeoutMs ?? 10_000)];
  if (options.signal) signals.push(options.signal);
  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: signJwt(key, now()),
    }).toString(),
    signal: AbortSignal.any(signals),
  });
  const answer: unknown = await response.json().catch(() => null);
  const body = isObject(answer) ? answer : {};
  const token = text(body.access_token);
  if (!response.ok || !token) {
    const reason = text(body.error_description) ?? text(body.error) ?? "no answer";
    throw new Error(`Google did not give an access token (${response.status}): ${reason}`);
  }
  const seconds = typeof body.expires_in === "number" ? body.expires_in : TOKEN_LIFETIME_S;
  tokenCache.set(id, { token, expiresAt: now() + seconds * 1000 });
  return token;
}

/** The access token of a credential: OAuth2 (the server refreshes it) or a service account. */
export async function calendarToken(
  credential: Pick<ResolvedCredential, "type" | "data"> | null,
  options: CallOptions,
): Promise<string> {
  if (credential?.type === CALENDAR_OAUTH2_CREDENTIAL) {
    const token = text(credential.data.accessToken);
    if (!token)
      throw new Error("The Google Calendar credential is not connected to an account yet");
    return token;
  }
  if (credential?.type === CALENDAR_SERVICE_ACCOUNT_CREDENTIAL) {
    const json = text(credential.data.serviceAccountKey);
    if (!json) throw new Error('The credential has no "serviceAccountKey"');
    return await serviceAccountToken(parseServiceAccountKey(json), options);
  }
  throw new Error("The node needs a Google Calendar credential");
}

// ---------------------------------------------------------------------------------------------
// Calendar API

export type CalendarRequest = {
  method: "GET" | "POST" | "PATCH" | "DELETE";
  /** After the Calendar API address. Starts with `/`. */
  path: string;
  query?: Record<string, string | undefined>;
  body?: Record<string, unknown>;
  /** What the call does, for the error text, for example "list the events". */
  action: string;
};

const HINTS: Record<number, string> = {
  401: " Connect the credential again.",
  403: " Share the calendar with the account of the credential, and turn on the Google Calendar API in the Google Cloud project.",
  404: " Check the calendar ID and the event ID.",
  410: " The event is deleted already.",
  429: " Google limits the number of requests per minute. Try again later.",
};

/** A clear error from a Google answer: `{ error: { code, message, status } }`. */
export function calendarError(status: number, answer: unknown, action: string): Error {
  const error = isObject(answer) && isObject(answer.error) ? answer.error : {};
  const message = text(error.message) ?? "no message";
  const code = text(error.status);
  const hint = HINTS[status] ?? "";
  return new Error(
    `Google Calendar could not ${action} (${status}${code ? ` ${code}` : ""}): ${message}.${hint}`,
  );
}

export function urlOf(request: Pick<CalendarRequest, "path" | "query">): string {
  const url = new URL(`${CALENDAR_API}${request.path}`);
  for (const [key, value] of Object.entries(request.query ?? {})) {
    if (value !== undefined && value !== "") url.searchParams.set(key, value);
  }
  return url.toString();
}

/** One call. The error text never has the token. */
export async function callCalendar(
  token: string,
  request: CalendarRequest,
  options: CallOptions,
): Promise<unknown> {
  const response = await fetch(urlOf(request), {
    method: request.method,
    headers: {
      authorization: `Bearer ${token}`,
      accept: "application/json",
      ...(request.body ? { "content-type": "application/json" } : {}),
    },
    body: request.body ? JSON.stringify(request.body) : undefined,
    redirect: "error",
    signal: AbortSignal.any([options.signal, AbortSignal.timeout(options.timeoutMs)]),
  });
  const answer: unknown = await response.json().catch(() => null);
  if (!response.ok) throw calendarError(response.status, answer, request.action);
  return answer;
}
