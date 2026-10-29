// SPDX-License-Identifier: AGPL-3.0-only
import { z } from "zod";

// Resource and operation names follow the Slack Web API.

export const RESOURCES = ["message", "channel", "user", "reaction", "file"] as const;
export type Resource = (typeof RESOURCES)[number];

export const OPERATIONS_OF = {
  message: ["send", "update", "delete", "getPermalink"],
  channel: ["list", "get", "create", "archive", "join", "invite"],
  user: ["get", "list", "getByEmail"],
  reaction: ["add", "remove"],
  file: ["upload"],
} as const satisfies Record<Resource, readonly string[]>;

const ALL_OPERATIONS = [...new Set(Object.values(OPERATIONS_OF).flat())] as [string, ...string[]];

export const CHANNEL_TYPES = ["public_channel", "private_channel", "mpim", "im"] as const;

type Operations = { [R in Resource]?: readonly (typeof OPERATIONS_OF)[R][number][] };

/** Show a field for these operations of these resources. */
const on = (operations: Operations) => ({
  showWhen: Object.entries(operations).map(([resource, ops]) => ({
    resource: [resource],
    operation: [...(ops ?? [])],
  })),
});

const isList = on({ channel: ["list"], user: ["list"] });

export const slackConfig = z
  .object({
    resource: z
      .enum(RESOURCES)
      .default("message")
      .meta({
        labels: {
          message: "Message",
          channel: "Channel",
          user: "User",
          reaction: "Reaction",
          file: "File",
        },
        hints: {
          message: "Send, update, or delete a message, or get its link",
          channel: "List, get, create, archive, or join a channel, or invite users",
          user: "Get one user or many users",
          reaction: "Add or remove an emoji reaction on a message",
          file: "Upload a file and share it in a channel",
        },
      }),
    operation: z
      .enum(ALL_OPERATIONS)
      .default("send")
      .meta({
        labels: {
          send: "Send",
          update: "Update",
          delete: "Delete",
          getPermalink: "Get Permalink",
          list: "List",
          get: "Get",
          create: "Create",
          archive: "Archive",
          join: "Join",
          invite: "Invite",
          getByEmail: "Get by Email",
          add: "Add",
          remove: "Remove",
          upload: "Upload",
        },
        hints: {
          send: "Send a message to a channel, a user, or a thread",
          update: "Change the text or the blocks of a message",
          delete: "Delete a message",
          getPermalink: "Get the link to a message",
          list: "Get many channels or users",
          get: "Get one channel or user by its ID",
          create: "Create a public or private channel",
          archive: "Archive a channel",
          join: "Add the bot to a public channel",
          invite: "Add users to a channel",
          getByEmail: "Find a user by email address",
          add: "Add a reaction to a message",
          remove: "Remove a reaction from a message",
          upload: "Upload a file to Slack",
        },
      }),
    channelId: z
      .string()
      .optional()
      .meta({
        ...on({
          message: ["send", "update", "delete", "getPermalink"],
          channel: ["get", "archive", "join", "invite"],
          reaction: ["add", "remove"],
          file: ["upload"],
        }),
        title: "Channel",
        description:
          "Channel ID, such as C0123456789. To send a direct message, use a user ID. Empty for a file upload means no channel",
      }),
    messageTs: z
      .string()
      .optional()
      .meta({
        ...on({ message: ["update", "delete", "getPermalink"], reaction: ["add", "remove"] }),
        title: "Message Timestamp",
        description: "The `ts` of the message, such as 1712345678.123456",
      }),
    text: z
      .string()
      .optional()
      .meta({
        ...on({ message: ["send", "update"] }),
        ui: "textarea",
        description: "The text, in Slack mrkdwn. With blocks, it is the text of the notification",
      }),
    blocks: z
      .string()
      .optional()
      .meta({
        ...on({ message: ["send", "update"] }),
        ui: "code",
        description: "Block Kit blocks as a JSON array, or an object with a `blocks` array",
      }),
    threadTs: z
      .string()
      .optional()
      .meta({
        ...on({ message: ["send"], file: ["upload"] }),
        title: "Thread Timestamp",
        description: "The `ts` of the parent message, to reply in its thread",
      }),
    messageOptions: z
      .object({
        reply_broadcast: z
          .boolean()
          .meta({ description: "Also send the thread reply to the channel" }),
        unfurl_links: z.boolean().meta({ description: "Show previews of links" }),
        unfurl_media: z.boolean().meta({ description: "Show previews of media" }),
        mrkdwn: z.boolean().meta({ description: "Format the text as mrkdwn. Default: true" }),
        username: z.string().meta({ description: "Name of the bot. Needs chat:write.customize" }),
        icon_emoji: z.string().meta({ description: "Emoji as the bot icon, such as :robot_face:" }),
        icon_url: z.url().meta({ description: "Image URL as the bot icon" }),
      })
      .partial()
      .default({})
      .meta(on({ message: ["send"] })),
    // channels
    channelName: z
      .string()
      .optional()
      .meta({
        ...on({ channel: ["create"] }),
        description: "Lowercase letters, numbers, hyphens, and underscores. At most 80",
      }),
    isPrivate: z
      .boolean()
      .default(false)
      .meta({ ...on({ channel: ["create"] }), description: "Create a private channel" }),
    userIds: z
      .string()
      .optional()
      .meta({
        ...on({ channel: ["invite"] }),
        title: "Users",
        description: "User IDs with commas between, at most 1000",
      }),
    channelTypes: z
      .array(z.enum(CHANNEL_TYPES))
      .min(1)
      .default(["public_channel"])
      .meta({
        ...on({ channel: ["list"] }),
        title: "Channel Types",
        labels: {
          public_channel: "Public Channel",
          private_channel: "Private Channel",
          mpim: "Group Direct Message",
          im: "Direct Message",
        },
        hints: {
          public_channel: "Channels that all members can find",
          private_channel: "Channels that the bot is a member of",
          mpim: "Direct messages with more than two people",
          im: "Direct messages between the bot and one user",
        },
      }),
    excludeArchived: z
      .boolean()
      .default(true)
      .meta({ ...on({ channel: ["list"] }), description: "Leave out archived channels" }),
    // users
    userId: z
      .string()
      .optional()
      .meta({
        ...on({ user: ["get"] }),
        title: "User",
        description: "User ID, such as U0123456789",
      }),
    email: z
      .string()
      .optional()
      .meta(on({ user: ["getByEmail"] })),
    // reactions
    reactionName: z
      .string()
      .optional()
      .meta({
        ...on({ reaction: ["add", "remove"] }),
        title: "Emoji",
        description: "Emoji name without colons, such as thumbsup",
      }),
    // files
    binaryData: z
      .boolean()
      .default(true)
      .meta({
        ...on({ file: ["upload"] }),
        description: "Upload the binary data of the input. Off: upload the text of File Content",
      }),
    binaryPropertyName: z
      .string()
      .default("data")
      .meta({
        showWhen: { resource: ["file"], operation: ["upload"], binaryData: [true] },
        description: "The property of `binary` in the input that holds the file",
      }),
    fileContent: z
      .string()
      .optional()
      .meta({
        showWhen: { resource: ["file"], operation: ["upload"], binaryData: [false] },
        ui: "textarea",
      }),
    fileName: z
      .string()
      .optional()
      .meta({
        ...on({ file: ["upload"] }),
        description: "Empty uses the name of the binary data",
      }),
    title: z
      .string()
      .optional()
      .meta(on({ file: ["upload"] })),
    initialComment: z
      .string()
      .optional()
      .meta({ ...on({ file: ["upload"] }), description: "A message with the file in the channel" }),
    // lists
    returnAll: z.boolean().default(false).meta(isList),
    limit: z
      .number()
      .int()
      .min(1)
      .max(5000)
      .default(50)
      .meta({
        showWhen: [
          { resource: ["channel"], operation: ["list"], returnAll: [false] },
          { resource: ["user"], operation: ["list"], returnAll: [false] },
        ],
      }),
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
  });

export type SlackConfig = z.output<typeof slackConfig>;
