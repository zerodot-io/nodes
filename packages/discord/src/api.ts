// SPDX-License-Identifier: AGPL-3.0-only
import { setTimeout as sleep } from "node:timers/promises";
import type { ResolvedCredential } from "@zerodot/node-sdk";

export const DISCORD_BOT_CREDENTIAL = "discord.bot";
export const DISCORD_WEBHOOK_CREDENTIAL = "discord.webhook";
export const DISCORD_API = "https://discord.com/api/v10";
/** Discord wants this form of user agent for bots. */
const USER_AGENT = "DiscordBot (https://zerodot.io, 1.0.0)";

/** The most items that a list collects. A node output has a size limit too. */
export const MAX_ITEMS = 1000;
/** The longest wait for a rate limit. A longer wait fails the node. */
const MAX_RETRY_WAIT_MS = 60_000;
const MAX_RETRIES = 3;

type Credential = Pick<ResolvedCredential, "type" | "data"> | null;

const text = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim() !== "" ? value.trim() : undefined;

/** The bot token of a bot credential. */
export function botToken(credential: Credential): string {
  if (!credential || credential.type !== DISCORD_BOT_CREDENTIAL) {
    throw new Error("This operation needs a Discord bot credential");
  }
  const token = text(credential.data.botToken);
  if (!token) throw new Error('The credential has no "botToken"');
  return token;
}

export type WebhookTarget = { id: string; token: string };

const WEBHOOK_HOSTS = new Set([
  "discord.com",
  "discordapp.com",
  "ptb.discord.com",
  "canary.discord.com",
]);

/** The id and token of a Discord webhook address, or null when it is not one. */
export function parseWebhookUrl(value: string): WebhookTarget | null {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || !WEBHOOK_HOSTS.has(url.hostname)) return null;
  const match = /^\/api\/(?:v\d+\/)?webhooks\/(\d+)\/([\w-]+)\/?$/.exec(url.pathname);
  return match?.[1] && match[2] ? { id: match[1], token: match[2] } : null;
}

/** The webhook of a webhook credential. */
export function webhookOf(credential: Credential): WebhookTarget {
  if (!credential || credential.type !== DISCORD_WEBHOOK_CREDENTIAL) {
    throw new Error("This operation needs a Discord webhook credential");
  }
  const target = parseWebhookUrl(text(credential.data.webhookUrl) ?? "");
  if (!target)
    throw new Error('The "webhookUrl" of the credential is not a Discord webhook address');
  return target;
}

export type DiscordFile = { name: string; mimeType: string; data: string };

export type DiscordRequest = {
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  /** Starts with `/`. */
  path: string;
  query?: Record<string, string | number | boolean | undefined>;
  body?: Record<string, unknown>;
  /** Text for the audit log of the server. */
  reason?: string;
  /** Files go in a multipart form, with the body as `payload_json`. */
  files?: DiscordFile[];
};

export type CallOptions = { signal: AbortSignal; timeoutMs: number };

/** The token of a webhook is in its path. It never goes in an error text. */
export const redactPath = (path: string) =>
  path.replace(/\/webhooks\/(\d+)\/[^/?]+/, "/webhooks/$1/***");

type DiscordError = {
  message?: string;
  code?: number;
  retry_after?: number;
  global?: boolean;
  errors?: unknown;
};

/** The first detail in the nested `errors` object, for example `embeds.0.title: Too long`. */
function firstDetail(errors: unknown, path: string[] = []): string | null {
  if (typeof errors !== "object" || errors === null) return null;
  const record = errors as Record<string, unknown>;
  const list = record._errors;
  if (Array.isArray(list)) {
    const first = list[0] as { message?: unknown } | undefined;
    if (typeof first?.message === "string") {
      return path.length ? `${path.join(".")}: ${first.message}` : first.message;
    }
  }
  for (const [key, value] of Object.entries(record)) {
    if (key === "_errors") continue;
    const found = firstDetail(value, [...path, key]);
    if (found) return found;
  }
  return null;
}

const HINTS: Record<number, string> = {
  401: " Check the bot token.",
  403: " The bot does not have the permission for this, or its role is too low.",
  404: " Check the IDs.",
};

/** The error of an answer that is not OK. */
export function discordError(request: DiscordRequest, status: number, answer: DiscordError | null) {
  const detail = firstDetail(answer?.errors);
  const code = answer?.code ? ` [code ${answer.code}]` : "";
  return new Error(
    `Discord ${request.method} ${redactPath(request.path)} failed (${status}): ${
      answer?.message ?? "no message"
    }${code}${detail ? ` (${detail})` : ""}.${HINTS[status] ?? ""}`,
  );
}

function urlOf(request: DiscordRequest): URL {
  const url = new URL(`${DISCORD_API}${request.path}`);
  for (const [key, value] of Object.entries(request.query ?? {})) {
    if (value !== undefined && value !== "") url.searchParams.set(key, String(value));
  }
  return url;
}

/** A new body for each try, because fetch reads a form once. */
function bodyOf(request: DiscordRequest): { body?: FormData | string; json: boolean } {
  if (request.files?.length) {
    const form = new FormData();
    const attachments = request.files.map((file, id) => ({ id, filename: file.name }));
    form.set("payload_json", JSON.stringify({ ...request.body, attachments }));
    request.files.forEach((file, index) => {
      const bytes = Buffer.from(file.data, "base64");
      form.set(`files[${index}]`, new Blob([bytes], { type: file.mimeType }), file.name);
    });
    return { body: form, json: false };
  }
  if (request.body) return { body: JSON.stringify(request.body), json: true };
  return { json: false };
}

/** Seconds to wait from a 429 answer. The body has `retry_after`, the header is a fallback. */
function retryAfterMs(answer: DiscordError | null, header: string | null): number {
  const seconds =
    typeof answer?.retry_after === "number" ? answer.retry_after : Number(header ?? Number.NaN);
  return Number.isFinite(seconds) && seconds >= 0 ? Math.ceil(seconds * 1000) : 1000;
}

/**
 * One REST call. `token` null sends no Authorization header (a webhook has its token in the
 * path). A 204 answer gives null. A 429 answer waits `retry_after` and tries again.
 */
export async function callDiscord(
  token: string | null,
  request: DiscordRequest,
  options: CallOptions,
): Promise<unknown> {
  const url = urlOf(request);
  for (let attempt = 0; ; attempt++) {
    const { body, json } = bodyOf(request);
    const headers: Record<string, string> = { "user-agent": USER_AGENT };
    if (token) headers.authorization = `Bot ${token}`;
    if (json) headers["content-type"] = "application/json";
    if (request.reason) headers["x-audit-log-reason"] = encodeURIComponent(request.reason);
    const response = await fetch(url, {
      method: request.method,
      headers,
      body,
      redirect: "error",
      signal: AbortSignal.any([options.signal, AbortSignal.timeout(options.timeoutMs)]),
    });
    if (response.status === 204) return null;
    const answer = (await response.json().catch(() => null)) as unknown;
    if (response.ok) return answer;
    const error = (typeof answer === "object" ? answer : null) as DiscordError | null;
    if (response.status === 429) {
      const wait = retryAfterMs(error, response.headers.get("retry-after"));
      if (attempt >= MAX_RETRIES || wait > MAX_RETRY_WAIT_MS) {
        throw new Error(
          `Discord rate limit on ${request.method} ${redactPath(request.path)}: try again in ${Math.ceil(wait / 1000)} s${error?.global ? " (global limit)" : ""}`,
        );
      }
      await sleep(wait, undefined, { signal: options.signal });
      continue;
    }
    throw discordError(request, response.status, error);
  }
}

export type Pager = {
  /** The query key of the next page. */
  cursor: "before" | "after";
  /** The most items of one page. */
  pageSize: number;
  /** The id that the next page starts after. */
  idOf(item: unknown): string | undefined;
};

/** A list that has pages. Collects `limit` items, or all items up to MAX_ITEMS when null. */
export async function callDiscordList(
  token: string,
  request: DiscordRequest,
  pager: Pager,
  limit: number | null,
  options: CallOptions,
): Promise<unknown[]> {
  const wanted = Math.min(limit ?? MAX_ITEMS, MAX_ITEMS);
  const items: unknown[] = [];
  let cursor: string | undefined;
  while (items.length < wanted) {
    const size = Math.min(pager.pageSize, wanted - items.length);
    const page = await callDiscord(
      token,
      { ...request, query: { ...request.query, limit: size, [pager.cursor]: cursor } },
      options,
    );
    if (!Array.isArray(page) || page.length === 0) break;
    items.push(...page);
    cursor = pager.idOf(page[page.length - 1]);
    if (page.length < size || !cursor) break;
  }
  return items.slice(0, wanted);
}
