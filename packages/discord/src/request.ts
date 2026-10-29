// SPDX-License-Identifier: AGPL-3.0-only
import type { DiscordRequest, Pager, WebhookTarget } from "./api";
import { CHANNEL_TYPES, type DiscordConfig } from "./config";

const seg = encodeURIComponent;

const need = <T>(value: T | undefined, name: string, operation: string): T => {
  if (value === undefined || (typeof value === "string" && value.trim() === "")) {
    throw new Error(`"${name}" is needed to ${operation}`);
  }
  return value;
};

const compact = (body: Record<string, unknown>) =>
  Object.fromEntries(Object.entries(body).filter(([, value]) => value !== undefined));

const filled = (value: string | undefined) =>
  value === undefined || value.trim() === "" ? undefined : value;

/** JSON text of a field. Empty text gives undefined. */
function parseJson(value: string | undefined, name: string): unknown {
  if (!filled(value)) return undefined;
  try {
    return JSON.parse(value ?? "");
  } catch {
    throw new Error(`"${name}" is not valid JSON`);
  }
}

/** One embed object or an array of them. */
export function parseEmbeds(value: string | undefined): Record<string, unknown>[] | undefined {
  const parsed = parseJson(value, "embeds");
  if (parsed === undefined) return undefined;
  const list = Array.isArray(parsed) ? parsed : [parsed];
  if (list.some((item) => typeof item !== "object" || item === null || Array.isArray(item))) {
    throw new Error('"embeds" must be an embed object or an array of embed objects');
  }
  if (list.length > 10) throw new Error('"embeds" can have at most 10 embeds');
  return list as Record<string, unknown>[];
}

function parseComponents(value: string | undefined): unknown[] | undefined {
  const parsed = parseJson(value, "components");
  if (parsed === undefined) return undefined;
  if (!Array.isArray(parsed)) throw new Error('"components" must be a JSON array');
  return parsed;
}

const PARSE: Record<DiscordConfig["mentions"], string[] | undefined> = {
  default: undefined,
  none: [],
  users: ["users"],
  usersAndRoles: ["users", "roles"],
  all: ["users", "roles", "everyone"],
};

/** The message fields that send, edit, and execute share. */
function messageBody(c: DiscordConfig, operation: string, needContent: boolean) {
  const content = filled(c.content);
  const embeds = parseEmbeds(c.embeds);
  const components = parseComponents(c.components);
  if (needContent && !content && !embeds && !components && !c.binaryData) {
    throw new Error(`"content", "embeds", "components", or a file is needed to ${operation}`);
  }
  if (content && content.length > 2000) {
    throw new Error('"content" can have at most 2000 characters');
  }
  const parse = PARSE[c.mentions];
  return compact({
    content,
    embeds,
    components,
    allowed_mentions: parse ? { parse } : undefined,
  });
}

/** A custom emoji can come as `<:name:id>` or `<a:name:id>`. The API wants `name:id`. */
export function emojiOf(value: string): string {
  const custom = /^<a?:(\w+):(\d+)>$/.exec(value.trim());
  return custom ? `${custom[1]}:${custom[2]}` : value.trim();
}

const idOf = (item: unknown) => {
  const id = (item as { id?: unknown } | null)?.id;
  return typeof id === "string" ? id : undefined;
};

const MESSAGE_PAGES: Pager = { cursor: "before", pageSize: 100, idOf };
const MEMBER_PAGES: Pager = {
  cursor: "after",
  pageSize: 1000,
  idOf: (item) => idOf((item as { user?: unknown } | null)?.user),
};

export type BuiltRequest = DiscordRequest & {
  /** The list has pages. */
  pager?: Pager;
  /** The call goes to a webhook and needs no bot token. */
  webhook?: boolean;
};

/**
 * The API call for one operation, without the network. `webhook` is the webhook of a webhook
 * credential. Without it, webhook operations use `webhookId` and `webhookToken`.
 */
export function buildRequest(c: DiscordConfig, webhook?: WebhookTarget): BuiltRequest {
  const op = `${c.resource}.${c.operation}`;
  const guild = () => `/guilds/${seg(need(c.guildId, "guildId", op))}`;
  const channel = () => `/channels/${seg(need(c.channelId, "channelId", op))}`;
  const message = () => `${channel()}/messages/${seg(need(c.messageId, "messageId", op))}`;
  const member = () => `${guild()}/members/${seg(need(c.userId, "userId", op))}`;
  const reason = filled(c.reason);

  switch (op) {
    case "message.send":
      return {
        method: "POST",
        path: `${channel()}/messages`,
        body: compact({
          ...messageBody(c, op, true),
          tts: c.tts,
          message_reference: filled(c.replyTo)
            ? { message_id: c.replyTo, fail_if_not_exists: false }
            : undefined,
        }),
      };
    case "message.edit":
      return { method: "PATCH", path: message(), body: messageBody(c, op, true) };
    case "message.delete":
      return { method: "DELETE", path: message(), reason };
    case "message.get":
      return { method: "GET", path: message() };
    case "message.list":
      return { method: "GET", path: `${channel()}/messages`, pager: MESSAGE_PAGES };
    case "message.react":
      return {
        method: "PUT",
        path: `${message()}/reactions/${seg(emojiOf(need(c.emoji, "emoji", op)))}/@me`,
      };

    case "channel.list":
      return { method: "GET", path: `${guild()}/channels` };
    case "channel.get":
      return { method: "GET", path: channel() };
    case "channel.create":
      return {
        method: "POST",
        path: `${guild()}/channels`,
        reason,
        body: compact({
          name: need(c.channelName, "channelName", op),
          type: CHANNEL_TYPES[c.channelType],
          topic: filled(c.topic),
          parent_id: filled(c.parentId),
        }),
      };
    case "channel.delete":
      return { method: "DELETE", path: channel(), reason };

    case "member.get":
      return { method: "GET", path: member() };
    case "member.list":
      return { method: "GET", path: `${guild()}/members`, pager: MEMBER_PAGES };
    case "member.addRole":
    case "member.removeRole":
      return {
        method: c.operation === "addRole" ? "PUT" : "DELETE",
        path: `${member()}/roles/${seg(need(c.roleId, "roleId", op))}`,
        reason,
      };
    case "member.kick":
      return { method: "DELETE", path: member(), reason };

    case "guild.get":
      return { method: "GET", path: guild(), query: { with_counts: true } };

    case "webhook.execute": {
      const id = webhook?.id ?? need(c.webhookId, "webhookId", op);
      const token = webhook?.token ?? need(c.webhookToken, "webhookToken", op);
      return {
        method: "POST",
        path: `/webhooks/${seg(id)}/${seg(token)}`,
        query: { wait: true, thread_id: filled(c.threadId) },
        webhook: true,
        body: compact({
          ...messageBody(c, op, true),
          username: filled(c.username),
          avatar_url: filled(c.avatarUrl),
          tts: c.tts,
        }),
      };
    }
  }
  throw new Error(`Unknown Discord operation "${op}"`);
}
