// SPDX-License-Identifier: AGPL-3.0-only
import { createHash, createSign } from "node:crypto";
import type { ResolvedCredential } from "@zerodot/node-sdk";

export const GMAIL_OAUTH2_CREDENTIAL = "gmail.oauth2";
export const GMAIL_SERVICE_ACCOUNT_CREDENTIAL = "gmail.service_account";
export const GMAIL_API = "https://gmail.googleapis.com/gmail/v1/users";
export const TOKEN_URL = "https://oauth2.googleapis.com/token";
/** Full access. Only this scope can delete a message for good. */
export const GMAIL_SCOPE = "https://mail.google.com/";

/** A token is fetched again this long before it ends. */
const REFRESH_WINDOW_MS = 60_000;
const TOKEN_LIFETIME_S = 3600;

export type CallOptions = { signal: AbortSignal; timeoutMs: number };

export const text = (value: unknown): string | undefined =>
  typeof value === "string" && value !== "" ? value : undefined;

export const isObject = (value: unknown): value is Record<string, unknown> =>
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

/**
 * A signed JWT (RS256) that asks Google for an access token. `subject` is the user that the
 * service account acts as (domain-wide delegation). `now` is in milliseconds.
 */
export function signJwt(
  key: ServiceAccountKey,
  now: number,
  subject: string,
  scope = GMAIL_SCOPE,
): string {
  const iat = Math.floor(now / 1000);
  const header = {
    alg: "RS256",
    typ: "JWT",
    ...(key.private_key_id && { kid: key.private_key_id }),
  };
  const claims = {
    iss: key.client_email,
    sub: subject,
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
const cacheKey = (key: ServiceAccountKey, subject: string) =>
  `${key.client_email}\n${subject}\n${createHash("sha256").update(key.private_key).digest("hex")}`;

/** An access token for a service account that acts as `subject`. It is cached until near its end. */
export async function serviceAccountToken(
  key: ServiceAccountKey,
  subject: string,
  options: { signal?: AbortSignal; timeoutMs?: number; now?: () => number } = {},
): Promise<string> {
  const now = options.now ?? Date.now;
  const id = cacheKey(key, subject);
  const cached = tokenCache.get(id);
  if (cached && cached.expiresAt - now() > REFRESH_WINDOW_MS) return cached.token;

  const signals = [AbortSignal.timeout(options.timeoutMs ?? 10_000)];
  if (options.signal) signals.push(options.signal);
  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: signJwt(key, now(), subject),
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
export async function gmailToken(
  credential: Pick<ResolvedCredential, "type" | "data"> | null,
  options: CallOptions,
): Promise<string> {
  if (credential?.type === GMAIL_OAUTH2_CREDENTIAL) {
    const token = text(credential.data.accessToken);
    if (!token) throw new Error("The Gmail credential is not connected to an account yet");
    return token;
  }
  if (credential?.type === GMAIL_SERVICE_ACCOUNT_CREDENTIAL) {
    const json = text(credential.data.serviceAccountKey);
    if (!json) throw new Error('The credential has no "serviceAccountKey"');
    const subject = text(credential.data.impersonatedUser);
    if (!subject) throw new Error('The credential has no "impersonatedUser"');
    return await serviceAccountToken(parseServiceAccountKey(json), subject, options);
  }
  throw new Error("The node needs a Gmail credential");
}

// ---------------------------------------------------------------------------------------------
// Gmail API

export type GmailRequest = {
  method: "GET" | "POST" | "DELETE";
  /** After `/users/me`. Starts with `/`. */
  path: string;
  /** A list value makes the same key more than once, for example `labelIds`. */
  query?: Record<string, string | string[] | undefined>;
  body?: Record<string, unknown>;
  /** What the call does, for the error text, for example "send the message". */
  action: string;
};

const HINTS: Record<number, string> = {
  400: " Check the values of the node.",
  401: " Connect the credential again.",
  403: " Turn on the Gmail API in the Google Cloud project, and check the access of the account.",
  404: " Check the ID.",
  429: " Google limits the number of requests per minute. Try again later.",
};

/** A clear error from a Google answer: `{ error: { code, message, status } }`. */
export function gmailError(status: number, answer: unknown, action: string): Error {
  const error = isObject(answer) && isObject(answer.error) ? answer.error : {};
  const message = text(error.message) ?? "no message";
  const code = text(error.status);
  const hint = HINTS[status] ?? "";
  return new Error(
    `Gmail could not ${action} (${status}${code ? ` ${code}` : ""}): ${message}.${hint}`,
  );
}

export function urlOf(request: Pick<GmailRequest, "path" | "query">): string {
  const url = new URL(`${GMAIL_API}/me${request.path}`);
  for (const [key, value] of Object.entries(request.query ?? {})) {
    for (const entry of Array.isArray(value) ? value : [value]) {
      if (entry !== undefined && entry !== "") url.searchParams.append(key, entry);
    }
  }
  return url.toString();
}

/** One call. The error text never has the token. A 204 answer gives `{}`. */
export async function callGmail(
  token: string,
  request: GmailRequest,
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
  if (!response.ok) throw gmailError(response.status, answer, request.action);
  return answer ?? {};
}
