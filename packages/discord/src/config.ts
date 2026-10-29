// SPDX-License-Identifier: AGPL-3.0-only
import { z } from "zod";

// Resource and operation names follow the Discord REST API v10.

export const RESOURCES = ["message", "channel", "member", "guild", "webhook"] as const;
export type Resource = (typeof RESOURCES)[number];

export const OPERATIONS_OF = {
  message: ["send", "edit", "delete", "get", "list", "react"],
  channel: ["list", "get", "create", "delete"],
  member: ["get", "list", "addRole", "removeRole", "kick"],
  guild: ["get"],
  webhook: ["execute"],
} as const satisfies Record<Resource, readonly string[]>;

const ALL_OPERATIONS = [...new Set(Object.values(OPERATIONS_OF).flat())] as [string, ...string[]];

export const AUTHENTICATION = ["botToken", "webhook"] as const;

/** Discord channel types that a bot can make. */
export const CHANNEL_TYPES = {
  text: 0,
  voice: 2,
  category: 4,
  announcement: 5,
  stage: 13,
  forum: 15,
} as const;

/** Show a field only for these operations of a resource. */
const on = (resource: Resource, ...operations: string[]) => ({
  showWhen: { resource: [resource], operation: operations },
});

/** Show a field for operations of more than one resource. */
const onAny = (resources: Resource[], operations: string[]) => ({
  showWhen: { resource: resources, operation: operations },
});

const POSTS: Resource[] = ["message", "webhook"];
const POST_OPERATIONS = ["send", "edit", "execute"];
const LISTS = onAny(["message", "member"], ["list"]);

export const discordConfig = z
  .object({
    authentication: z
      .enum(AUTHENTICATION)
      .default("botToken")
      .meta({
        title: "Authentication",
        labels: { botToken: "Bot Token", webhook: "Webhook" },
        hints: {
          botToken: "A bot of a Discord application. It can do all operations",
          webhook: "A webhook address of a channel. It can only post messages",
        },
      }),
    resource: z
      .enum(RESOURCES)
      .default("message")
      .meta({
        labels: {
          message: "Message",
          channel: "Channel",
          member: "Member",
          guild: "Server",
          webhook: "Webhook",
        },
        hints: {
          message: "Send, edit, delete, get, list, or react to messages",
          channel: "List, get, create, or delete channels of a server",
          member: "Get members, give or remove roles, or kick a member",
          guild: "Get information about a server",
          webhook: "Post a message with a webhook, with its own name and avatar",
        },
      }),
    operation: z
      .enum(ALL_OPERATIONS)
      .default("send")
      .meta({
        labels: {
          send: "Send",
          edit: "Edit",
          delete: "Delete",
          get: "Get",
          list: "List",
          react: "React",
          create: "Create",
          addRole: "Add Role",
          removeRole: "Remove Role",
          kick: "Kick",
          execute: "Execute",
        },
        hints: {
          send: "Send a message to a channel",
          edit: "Change a message that the bot sent",
          delete: "Delete an item",
          get: "Get one item",
          list: "Get many items",
          react: "Add a reaction to a message",
          create: "Create a channel in a server",
          addRole: "Give a role to a member",
          removeRole: "Take a role from a member",
          kick: "Remove a member from the server",
          execute: "Post a message with a webhook",
        },
      }),
    guildId: z
      .string()
      .optional()
      .meta({
        title: "Server ID",
        showWhen: {
          resource: ["channel", "member", "guild"],
          operation: ["list", "create", "get", "addRole", "removeRole", "kick"],
        },
        description: "Right-click the server in Discord and pick Copy Server ID",
      }),
    channelId: z
      .string()
      .optional()
      .meta({
        title: "Channel ID",
        showWhen: {
          resource: ["message", "channel"],
          operation: ["send", "edit", "delete", "get", "list", "react"],
        },
      }),
    messageId: z
      .string()
      .optional()
      .meta({ title: "Message ID", ...on("message", "edit", "delete", "get", "react") }),
    userId: z
      .string()
      .optional()
      .meta({ title: "User ID", ...on("member", "get", "addRole", "removeRole", "kick") }),
    roleId: z
      .string()
      .optional()
      .meta({ title: "Role ID", ...on("member", "addRole", "removeRole") }),
    // webhook with a bot credential: an interaction follow-up, or another webhook
    webhookId: z
      .string()
      .optional()
      .meta({
        title: "Webhook ID",
        showWhen: { authentication: ["botToken"], resource: ["webhook"] },
        description: "For a reply to an interaction: the application ID from the trigger",
      }),
    webhookToken: z
      .string()
      .optional()
      .meta({
        title: "Webhook Token",
        showWhen: { authentication: ["botToken"], resource: ["webhook"] },
        description: "For a reply to an interaction: the interaction token from the trigger",
      }),
    // message content
    content: z
      .string()
      .optional()
      .meta({ ...onAny(POSTS, POST_OPERATIONS), description: "Text, at most 2000 characters" }),
    embeds: z
      .string()
      .optional()
      .meta({
        ...onAny(POSTS, POST_OPERATIONS),
        ui: "code",
        description: "JSON: one embed object or an array of at most 10",
      }),
    components: z
      .string()
      .optional()
      .meta({
        ...onAny(POSTS, POST_OPERATIONS),
        ui: "code",
        description: "JSON array of action rows, for example buttons",
      }),
    mentions: z
      .enum(["default", "none", "users", "usersAndRoles", "all"])
      .default("default")
      .meta({
        ...onAny(POSTS, POST_OPERATIONS),
        title: "Allowed Mentions",
        labels: {
          default: "Default",
          none: "None",
          users: "Users",
          usersAndRoles: "Users and Roles",
          all: "All",
        },
        hints: {
          default: "Discord pings all mentions in the text",
          none: "Ping nobody",
          users: "Ping mentioned users only",
          usersAndRoles: "Ping mentioned users and roles",
          all: "Ping users, roles, @everyone, and @here",
        },
      }),
    tts: z
      .boolean()
      .optional()
      .meta({ title: "Text to Speech", ...onAny(POSTS, ["send", "execute"]) }),
    replyTo: z
      .string()
      .optional()
      .meta({
        title: "Reply to Message ID",
        ...on("message", "send"),
        description: "Send the message as a reply to this message",
      }),
    emoji: z
      .string()
      .optional()
      .meta({
        ...on("message", "react"),
        description: "A Unicode emoji, or a custom emoji as name:id",
      }),
    // webhook execute
    username: z
      .string()
      .optional()
      .meta({
        ...on("webhook", "execute"),
        description: "Show this name in place of the webhook name",
      }),
    avatarUrl: z
      .string()
      .optional()
      .meta({ title: "Avatar URL", ...on("webhook", "execute") }),
    threadId: z
      .string()
      .optional()
      .meta({
        title: "Thread ID",
        ...on("webhook", "execute"),
        description: "Post in this thread",
      }),
    // files
    binaryData: z
      .boolean()
      .default(false)
      .meta({
        title: "Attach Files",
        ...onAny(POSTS, POST_OPERATIONS),
        description: "Attach binary data of the input",
      }),
    binaryPropertyName: z
      .string()
      .default("data")
      .meta({
        title: "Binary Properties",
        showWhen: { binaryData: [true] },
        description: "Names of the binary properties, with commas between",
      }),
    // channel create
    channelName: z
      .string()
      .optional()
      .meta({ title: "Name", ...on("channel", "create") }),
    channelType: z
      .enum(Object.keys(CHANNEL_TYPES) as [keyof typeof CHANNEL_TYPES])
      .default("text")
      .meta({
        title: "Type",
        ...on("channel", "create"),
        labels: {
          text: "Text",
          voice: "Voice",
          category: "Category",
          announcement: "Announcement",
          stage: "Stage",
          forum: "Forum",
        },
        hints: {
          text: "A channel for text messages",
          voice: "A channel for voice and video",
          category: "A group for other channels",
          announcement: "A text channel that other servers can follow",
          stage: "A voice channel for events with an audience",
          forum: "A channel with posts as threads",
        },
      }),
    topic: z.string().optional().meta(on("channel", "create")),
    parentId: z
      .string()
      .optional()
      .meta({ title: "Category ID", ...on("channel", "create") }),
    reason: z
      .string()
      .optional()
      .meta({
        title: "Audit Log Reason",
        showWhen: {
          resource: ["message", "channel", "member"],
          operation: ["delete", "create", "addRole", "removeRole", "kick"],
        },
      }),
    // lists
    returnAll: z.boolean().default(false).meta(LISTS),
    limit: z
      .number()
      .int()
      .min(1)
      .max(1000)
      .default(50)
      .meta({ showWhen: { ...LISTS.showWhen, returnAll: [false] } }),
    timeoutMs: z.number().int().min(1).max(300_000).default(30_000),
  })
  .superRefine((config, context) => {
    const operations: readonly string[] = OPERATIONS_OF[config.resource];
    if (!operations.includes(config.operation)) {
      context.addIssue({
        code: "custom",
        path: ["operation"],
        message: `"${config.operation}" is not an operation of "${config.resource}"`,
      });
    }
    if (config.authentication === "webhook" && config.resource !== "webhook") {
      context.addIssue({
        code: "custom",
        path: ["resource"],
        message: 'A webhook credential can only do "webhook" operations. Use a bot token',
      });
    }
  });

export type DiscordConfig = z.output<typeof discordConfig>;
