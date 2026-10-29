// SPDX-License-Identifier: AGPL-3.0-only
import type { SlackConfig } from "./config";

export type SlackRequest = {
  method: string;
  args: Record<string, unknown>;
  /** A list: the items are in this key of each page. */
  itemsKey?: string;
};

const list = (text: string | undefined): string[] =>
  (text ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

const need = <T>(value: T | undefined, name: string, operation: string): T => {
  if (value === undefined || (typeof value === "string" && value.trim() === "")) {
    throw new Error(`Slack ${operation} needs "${name}"`);
  }
  return value;
};

/** Block Kit blocks from JSON text: an array, or an object with a `blocks` array. */
export function parseBlocks(text: string | undefined): unknown[] | undefined {
  if (!text?.trim()) return undefined;
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error('"blocks" must be JSON');
  }
  if (Array.isArray(value)) return value;
  if (typeof value === "object" && value !== null && "blocks" in value) {
    const { blocks } = value;
    if (Array.isArray(blocks)) return blocks;
  }
  throw new Error('"blocks" must be a JSON array, or an object with a "blocks" array');
}

/** Text, blocks, or both. Slack needs one of them. */
function content(c: SlackConfig, op: string) {
  const blocks = parseBlocks(c.blocks);
  const text = c.text?.trim() ? c.text : undefined;
  if (!text && !blocks) throw new Error(`Slack ${op} needs "text" or "blocks"`);
  return { text, blocks };
}

/** The Web API call for one operation, without the network. File upload is not here. */
export function buildRequest(c: SlackConfig): SlackRequest {
  const op = `${c.resource}.${c.operation}`;
  const channel = () => need(c.channelId, "channelId", op).trim();
  const ts = () => need(c.messageTs, "messageTs", op).trim();

  switch (op) {
    case "message.send":
      return {
        method: "chat.postMessage",
        args: {
          channel: channel(),
          ...content(c, op),
          thread_ts: c.threadTs?.trim(),
          ...c.messageOptions,
        },
      };
    case "message.update":
      return {
        method: "chat.update",
        args: { channel: channel(), ts: ts(), ...content(c, op) },
      };
    case "message.delete":
      return { method: "chat.delete", args: { channel: channel(), ts: ts() } };
    case "message.getPermalink":
      return { method: "chat.getPermalink", args: { channel: channel(), message_ts: ts() } };

    case "channel.list":
      return {
        method: "conversations.list",
        args: { types: c.channelTypes.join(","), exclude_archived: c.excludeArchived },
        itemsKey: "channels",
      };
    case "channel.get":
      return { method: "conversations.info", args: { channel: channel() } };
    case "channel.create":
      return {
        method: "conversations.create",
        args: { name: need(c.channelName, "channelName", op).trim(), is_private: c.isPrivate },
      };
    case "channel.archive":
      return { method: "conversations.archive", args: { channel: channel() } };
    case "channel.join":
      return { method: "conversations.join", args: { channel: channel() } };
    case "channel.invite": {
      const users = list(c.userIds);
      if (users.length === 0) throw new Error(`Slack ${op} needs "userIds"`);
      return {
        method: "conversations.invite",
        args: { channel: channel(), users: users.join(",") },
      };
    }

    case "user.get":
      return { method: "users.info", args: { user: need(c.userId, "userId", op).trim() } };
    case "user.list":
      return { method: "users.list", args: {}, itemsKey: "members" };
    case "user.getByEmail":
      return {
        method: "users.lookupByEmail",
        args: { email: need(c.email, "email", op).trim() },
      };

    case "reaction.add":
    case "reaction.remove":
      return {
        method: op === "reaction.add" ? "reactions.add" : "reactions.remove",
        args: {
          channel: channel(),
          timestamp: ts(),
          name: need(c.reactionName, "reactionName", op).trim().replace(/^:|:$/g, ""),
        },
      };
  }
  throw new Error(`Unknown Slack operation "${op}"`);
}
