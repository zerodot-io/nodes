// SPDX-License-Identifier: AGPL-3.0-only
import type { ResolvedCredential } from "@zerodot/node-sdk";

export const SLACK_CREDENTIAL = "slack.bot";
export const SLACK_API = "https://slack.com/api";

/** The most items that "return all" collects. A node output has a size limit too. */
export const MAX_ITEMS = 5000;
const PAGE_SIZE = 200;

export type SlackAccess = { token: string };
export type CallOptions = { signal: AbortSignal; timeoutMs: number };

/** The bot token of a credential. */
export function slackAccess(
  credential: Pick<ResolvedCredential, "type" | "data"> | null,
): SlackAccess {
  if (!credential || credential.type !== SLACK_CREDENTIAL) {
    throw new Error("The node needs a Slack bot credential");
  }
  const { accessToken } = credential.data;
  if (typeof accessToken !== "string" || accessToken === "") {
    throw new Error('The credential has no "accessToken"');
  }
  return { token: accessToken };
}

/** An error that Slack gave. `code` is the `error` field of the answer, for example `channel_not_found`. */
export class SlackError extends Error {
  readonly code: string;
  readonly status: number;
  readonly retryAfter: number | undefined;

  constructor(message: string, code: string, status: number, retryAfter?: number) {
    super(message);
    this.name = "SlackError";
    this.code = code;
    this.status = status;
    this.retryAfter = retryAfter;
  }
}

/** Short help for the errors that people see most. */
const HINTS: Record<string, string> = {
  not_authed: "No token was sent",
  invalid_auth: "Slack did not accept the token",
  account_inactive: "The token is for a deleted user or workspace",
  token_revoked: "The token was revoked",
  token_expired: "The token expired",
  missing_scope: "The token does not have the scope that this method needs",
  channel_not_found: "Slack did not find the channel. Use a channel ID, such as C0123456789",
  not_in_channel:
    "The bot is not in the channel. Add the app to the channel, or use Channel > Join",
  is_archived: "The channel is archived",
  message_not_found: "Slack did not find the message. Check the channel and the timestamp",
  cant_update_message: "The bot can change only its own messages",
  cant_delete_message: "The bot can delete only its own messages",
  user_not_found: "Slack did not find the user",
  users_not_found: "Slack did not find the user with this email",
  already_reacted: "The bot already added this reaction",
  no_reaction: "The message does not have this reaction from the bot",
  invalid_name: "The name is not valid",
  name_taken: "A channel with this name exists",
  already_in_channel: "The user is in the channel already",
  invalid_blocks: "The blocks are not valid",
  ratelimited: "Slack limits the requests. Try again later",
};

type SlackAnswer = Record<string, unknown> & {
  ok?: boolean;
  error?: string;
  needed?: string;
  response_metadata?: { next_cursor?: string; messages?: string[] };
};

/** The error for an answer with `ok: false`. The text never has the token. */
export function slackErrorOf(method: string, status: number, answer: SlackAnswer | null) {
  const code = typeof answer?.error === "string" ? answer.error : "no_answer";
  const parts = [`Slack ${method} failed: ${code}`];
  const hint = HINTS[code];
  if (hint) parts.push(hint);
  if (code === "missing_scope" && typeof answer?.needed === "string") {
    parts.push(`Add the scope "${answer.needed}" to the app, and install it again`);
  }
  const details = answer?.response_metadata?.messages;
  if (Array.isArray(details) && details.length > 0) parts.push(details.join("; "));
  if (code === "no_answer") parts.push(`HTTP status ${status}`);
  return new SlackError(parts.join(". "), code, status);
}

/** Form fields for a method. Objects and arrays go in as JSON text. Empty values are left out. */
export function formBody(args: Record<string, unknown>): URLSearchParams {
  const form = new URLSearchParams();
  for (const [key, value] of Object.entries(args)) {
    if (value === undefined || value === null || value === "") continue;
    form.set(key, typeof value === "object" ? JSON.stringify(value) : String(value));
  }
  return form;
}

const retryAfterOf = (header: string | null): number | undefined => {
  const seconds = Number(header);
  return header !== null && Number.isFinite(seconds) && seconds >= 0 ? seconds : undefined;
};

/**
 * One Web API call. Slack accepts form fields for all methods, so the body is always a form.
 * Slack answers HTTP 200 with `ok: false` for most errors. HTTP 429 means a rate limit.
 */
export async function callSlack(
  access: SlackAccess,
  method: string,
  args: Record<string, unknown>,
  options: CallOptions,
): Promise<SlackAnswer> {
  const response = await fetch(`${SLACK_API}/${method}`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${access.token}`,
      "content-type": "application/x-www-form-urlencoded; charset=utf-8",
    },
    body: formBody(args),
    redirect: "error",
    signal: AbortSignal.any([options.signal, AbortSignal.timeout(options.timeoutMs)]),
  });
  if (response.status === 429) {
    const retryAfter = retryAfterOf(response.headers.get("retry-after"));
    const wait = retryAfter === undefined ? "" : ` Try again in ${retryAfter} seconds`;
    throw new SlackError(
      `Slack ${method} failed: ratelimited. ${HINTS.ratelimited}.${wait}`,
      "ratelimited",
      429,
      retryAfter,
    );
  }
  const answer = (await response.json().catch(() => null)) as SlackAnswer | null;
  if (!answer?.ok) throw slackErrorOf(method, response.status, answer);
  return answer;
}

/** A list. Follows `next_cursor` until it has `limit` items, or all items when `limit` is null. */
export async function callSlackList(
  access: SlackAccess,
  method: string,
  args: Record<string, unknown>,
  itemsKey: string,
  limit: number | null,
  options: CallOptions,
): Promise<unknown[]> {
  const wanted = Math.min(limit ?? MAX_ITEMS, MAX_ITEMS);
  const items: unknown[] = [];
  let cursor: string | undefined;
  do {
    const page = await callSlack(
      access,
      method,
      { ...args, limit: Math.min(PAGE_SIZE, wanted - items.length), cursor },
      options,
    );
    const found = page[itemsKey];
    if (Array.isArray(found)) items.push(...found);
    cursor = page.response_metadata?.next_cursor || undefined;
  } while (cursor && items.length < wanted);
  return items.slice(0, wanted);
}

export type Upload = {
  bytes: Uint8Array;
  fileName: string;
  title?: string;
  channelId?: string;
  initialComment?: string;
  threadTs?: string;
};

/**
 * Uploads a file in three steps: get an upload address, send the bytes there, and complete the
 * upload. With a channel, Slack shares the file in it.
 */
export async function uploadSlackFile(access: SlackAccess, upload: Upload, options: CallOptions) {
  const target = await callSlack(
    access,
    "files.getUploadURLExternal",
    { filename: upload.fileName, length: upload.bytes.byteLength },
    options,
  );
  const { upload_url: uploadUrl, file_id: fileId } = target;
  if (typeof uploadUrl !== "string" || typeof fileId !== "string") {
    throw new Error("Slack did not give an upload address");
  }
  if (new URL(uploadUrl).protocol !== "https:") {
    throw new Error("Slack gave an upload address that is not HTTPS");
  }
  // The address is signed. The token does not go to it.
  const sent = await fetch(uploadUrl, {
    method: "POST",
    headers: { "content-type": "application/octet-stream" },
    body: new Blob([new Uint8Array(upload.bytes)]),
    signal: AbortSignal.any([options.signal, AbortSignal.timeout(options.timeoutMs)]),
  });
  if (!sent.ok) throw new Error(`Slack file upload failed (${sent.status})`);
  return await callSlack(
    access,
    "files.completeUploadExternal",
    {
      files: [{ id: fileId, title: upload.title || upload.fileName }],
      channel_id: upload.channelId,
      initial_comment: upload.channelId ? upload.initialComment : undefined,
      thread_ts: upload.channelId ? upload.threadTs : undefined,
    },
    options,
  );
}
