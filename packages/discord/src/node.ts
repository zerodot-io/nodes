// SPDX-License-Identifier: AGPL-3.0-only
import { defineNode, readBinary } from "@zerodot/node-sdk";
import {
  botToken,
  callDiscord,
  callDiscordList,
  DISCORD_BOT_CREDENTIAL,
  DISCORD_WEBHOOK_CREDENTIAL,
  type DiscordFile,
  webhookOf,
} from "./api";
import { discordConfig } from "./config";
import { DISCORD_ICON } from "./icon";
import { buildRequest } from "./request";

/** The most files of one message. */
const MAX_FILES = 10;
/** The operations that can attach files. */
const FILE_OPERATIONS = ["send", "edit", "execute"];

/** The files of the input, from binary properties with commas between. */
export function filesOf(input: unknown, properties: string): DiscordFile[] {
  const names = properties
    .split(",")
    .map((name) => name.trim())
    .filter(Boolean);
  if (names.length === 0) throw new Error('"binaryPropertyName" is empty');
  if (names.length > MAX_FILES) throw new Error(`A message can have at most ${MAX_FILES} files`);
  return names.map((name, index) => {
    const file = readBinary(input, name);
    return {
      name: file.fileName || `file-${index + 1}`,
      mimeType: file.mimeType,
      data: file.data,
    };
  });
}

export default defineNode({
  type: "discord.api",
  label: "Discord",
  description: "Send messages and manage channels and members with a Discord bot or webhook",
  category: "integration",
  app: "Discord",
  // The names of the actions of the Discord node.
  actions: [
    { label: "Send a message", config: { resource: "message", operation: "send" } },
    { label: "Edit a message", config: { resource: "message", operation: "edit" } },
    { label: "Delete a message", config: { resource: "message", operation: "delete" } },
    { label: "Get a message", config: { resource: "message", operation: "get" } },
    { label: "List messages in a channel", config: { resource: "message", operation: "list" } },
    { label: "React to a message", config: { resource: "message", operation: "react" } },
    { label: "List channels of a server", config: { resource: "channel", operation: "list" } },
    { label: "Get a channel", config: { resource: "channel", operation: "get" } },
    { label: "Create a channel", config: { resource: "channel", operation: "create" } },
    { label: "Delete a channel", config: { resource: "channel", operation: "delete" } },
    { label: "Get a member", config: { resource: "member", operation: "get" } },
    { label: "List members of a server", config: { resource: "member", operation: "list" } },
    { label: "Add a role to a member", config: { resource: "member", operation: "addRole" } },
    {
      label: "Remove a role from a member",
      config: { resource: "member", operation: "removeRole" },
    },
    { label: "Kick a member", config: { resource: "member", operation: "kick" } },
    { label: "Get a server", config: { resource: "guild", operation: "get" } },
    {
      label: "Post a message with a webhook",
      config: { authentication: "webhook", resource: "webhook", operation: "execute" },
    },
  ],
  icon: "Message01Icon",
  iconUrl: DISCORD_ICON,
  config: discordConfig,
  defaultConfig: {
    authentication: "botToken",
    resource: "message",
    operation: "send",
    channelId: "",
    content: "",
    mentions: "default",
    binaryData: false,
    binaryPropertyName: "data",
    returnAll: false,
    limit: 50,
    timeoutMs: 30_000,
  },
  credentialTypes: [DISCORD_BOT_CREDENTIAL, DISCORD_WEBHOOK_CREDENTIAL],
  // The Authentication field says which credential type the user picks.
  credentialRules: {
    [DISCORD_BOT_CREDENTIAL]: { showWhen: { authentication: ["botToken"] } },
    [DISCORD_WEBHOOK_CREDENTIAL]: { showWhen: { authentication: ["webhook"] } },
  },
  ports: { in: ["in"], out: ["out"] },
  subtitle: (config) =>
    typeof config.operation === "string"
      ? `${String(config.resource ?? "message")}: ${config.operation}`
      : undefined,
  async run({ config, input, credential, signal }) {
    const options = { signal, timeoutMs: config.timeoutMs };
    const webhook = config.authentication === "webhook" ? webhookOf(credential) : undefined;
    const request = buildRequest(config, webhook);
    if (config.binaryData && FILE_OPERATIONS.includes(config.operation)) {
      request.files = filesOf(input, config.binaryPropertyName);
    }

    if (request.pager) {
      const items = await callDiscordList(
        botToken(credential),
        request,
        request.pager,
        config.returnAll ? null : config.limit,
        options,
      );
      return { port: "out", data: items };
    }

    // A webhook has its token in the path, so it needs no bot token.
    const token = request.webhook ? null : botToken(credential);
    const data = await callDiscord(token, request, options);
    // A delete, a reaction, a role change, and a kick answer with no body.
    return { port: "out", data: data ?? { success: true } };
  },
});
