// SPDX-License-Identifier: AGPL-3.0-only
import { z } from "zod";

// Resource and operation names follow the Gmail API v1.

export const RESOURCES = ["message", "draft", "label", "thread"] as const;
export type Resource = (typeof RESOURCES)[number];

export const OPERATIONS_OF = {
  message: [
    "send",
    "reply",
    "get",
    "getMany",
    "markAsRead",
    "markAsUnread",
    "trash",
    "untrash",
    "delete",
    "addLabels",
    "removeLabels",
  ],
  draft: ["create", "get", "getMany", "delete"],
  label: ["create", "get", "getMany", "delete"],
  thread: ["get", "getMany", "trash", "untrash", "delete", "addLabels", "removeLabels"],
} as const satisfies Record<Resource, readonly string[]>;

const ALL_OPERATIONS = [...new Set(Object.values(OPERATIONS_OF).flat())] as [string, ...string[]];

export const AUTHENTICATION = ["oAuth2", "serviceAccount"] as const;

/** Show a field only for these operations of one resource. */
const on = (resource: Resource, ...operations: string[]) => ({
  resource: [resource],
  operation: operations,
});
const when = (...rules: { resource: Resource[]; operation: string[] }[]) => ({ showWhen: rules });

const option = (title: string) => ({ option: true, title });

const MESSAGE_ID_OPERATIONS = [
  "reply",
  "get",
  "markAsRead",
  "markAsUnread",
  "trash",
  "untrash",
  "delete",
  "addLabels",
  "removeLabels",
];
const THREAD_ID_OPERATIONS = ["get", "trash", "untrash", "delete", "addLabels", "removeLabels"];
const COMPOSE = [on("message", "send"), on("draft", "create")];
const BODY = [on("message", "send", "reply"), on("draft", "create")];
const LISTS = [on("message", "getMany"), on("thread", "getMany")];
const PARSED = [
  on("message", "get", "getMany"),
  on("draft", "get", "getMany"),
  on("thread", "get"),
];

export const gmailConfig = z
  .object({
    authentication: z
      .enum(AUTHENTICATION)
      .default("oAuth2")
      .meta({
        title: "Authentication",
        labels: { oAuth2: "OAuth2", serviceAccount: "Service Account" },
        hints: {
          oAuth2: "Sign in with a Google account",
          serviceAccount: "Use the JSON key of a service account with domain-wide delegation",
        },
      }),
    resource: z
      .enum(RESOURCES)
      .default("message")
      .meta({
        labels: { message: "Message", draft: "Draft", label: "Label", thread: "Thread" },
        hints: {
          message: "Send, read, search, label, and delete emails",
          draft: "Create, get, and delete drafts",
          label: "Create, get, and delete labels",
          thread: "Work with all the messages of a conversation",
        },
      }),
    operation: z
      .enum(ALL_OPERATIONS)
      .default("send")
      .meta({
        labels: {
          send: "Send",
          reply: "Reply",
          get: "Get",
          getMany: "Get Many",
          markAsRead: "Mark as Read",
          markAsUnread: "Mark as Unread",
          trash: "Move to Trash",
          untrash: "Restore from Trash",
          delete: "Delete",
          addLabels: "Add Labels",
          removeLabels: "Remove Labels",
          create: "Create",
        },
        hints: {
          send: "Send an email",
          reply: "Answer a message in its thread",
          get: "Get one item with its content",
          getMany: "Search or list items",
          markAsRead: "Remove the unread label",
          markAsUnread: "Add the unread label",
          trash: "Move to the trash. Gmail removes it after 30 days",
          untrash: "Move out of the trash",
          delete: "Delete for good. This cannot be undone",
          addLabels: "Add labels to the item",
          removeLabels: "Remove labels from the item",
          create: "Create a new item",
        },
      }),
    messageId: z
      .string()
      .optional()
      .meta({
        ...when(...MESSAGE_ID_OPERATIONS.map((operation) => on("message", operation))),
        title: "Message ID",
        description: "The ID of the message",
      }),
    threadId: z
      .string()
      .optional()
      .meta({
        ...when(on("thread", ...THREAD_ID_OPERATIONS), on("draft", "create")),
        title: "Thread ID",
        description: "The ID of the thread. For a draft: add the draft to this thread. Optional",
      }),
    draftId: z
      .string()
      .optional()
      .meta({ showWhen: on("draft", "get", "delete"), title: "Draft ID" }),
    labelId: z
      .string()
      .optional()
      .meta({ showWhen: on("label", "get", "delete"), title: "Label ID" }),
    to: z
      .string()
      .optional()
      .meta({
        ...when(...COMPOSE),
        title: "To",
        placeholder: "info@example.com",
        description:
          "Email addresses of the recipients, with commas between. A name works: Nathan Doe <nate@example.com>",
      }),
    subject: z
      .string()
      .optional()
      .meta({ ...when(...COMPOSE), title: "Subject", placeholder: "My subject line" }),
    emailFormat: z
      .enum(["text", "html", "both"])
      .default("html")
      .meta({
        ...when(...BODY),
        title: "Email Format",
        labels: { text: "Text", html: "HTML", both: "Both" },
        hints: {
          text: "Send email as plain text",
          html: "Send email as HTML",
          both: "Send both formats, the email client of the recipient picks one",
        },
      }),
    text: z
      .string()
      .optional()
      .meta({
        showWhen: BODY.map((rule) => ({ ...rule, emailFormat: ["text", "both"] })),
        title: "Text",
        description: "Plain text message of the email",
      }),
    html: z
      .string()
      .optional()
      .meta({
        showWhen: BODY.map((rule) => ({ ...rule, emailFormat: ["html", "both"] })),
        title: "HTML",
        description: "HTML message of the email",
      }),
    replyAll: z
      .boolean()
      .default(false)
      .meta({
        ...when(on("message", "reply")),
        title: "Reply to All",
        description: "Also send the reply to the other recipients of the message",
      }),
    ccEmail: z
      .string()
      .optional()
      .meta({
        showWhen: [...COMPOSE],
        ...option("CC"),
        placeholder: "cc@example.com",
        description: "Email addresses for CC, with commas between",
      }),
    bccEmail: z
      .string()
      .optional()
      .meta({
        showWhen: [...COMPOSE],
        ...option("BCC"),
        placeholder: "bcc@example.com",
        description: "Email addresses for BCC, with commas between",
      }),
    fromEmail: z
      .string()
      .optional()
      .meta({
        showWhen: [...BODY],
        ...option("From"),
        placeholder: "Nathan Doe <nate@example.com>",
        description:
          "Name and address of the sender. The address must be an alias of the mailbox. Empty: the mailbox itself",
      }),
    replyTo: z
      .string()
      .optional()
      .meta({
        showWhen: [...BODY],
        ...option("Reply To"),
        placeholder: "info@example.com",
        description: "The email address for the answers of the recipient",
      }),
    attachments: z
      .string()
      .optional()
      .meta({
        showWhen: [...BODY],
        ...option("Attachments"),
        description:
          'Names of the binary properties that hold the files to attach, with commas between. To show an image in the body: <img src="cid:image_1">',
      }),
    query: z
      .string()
      .optional()
      .meta({
        showWhen: [...LISTS, on("draft", "getMany")],
        title: "Search",
        placeholder: "from:ann@example.com has:attachment",
        description: "A Gmail search, the same as in the search box of Gmail",
      }),
    labelIds: z
      .string()
      .optional()
      .meta({
        showWhen: [
          ...LISTS,
          on("message", "addLabels", "removeLabels"),
          on("thread", "addLabels", "removeLabels"),
        ],
        title: "Labels",
        placeholder: "INBOX, Invoices",
        description:
          "Label names or IDs, with commas between. For a search: only items that have all of them",
      }),
    includeSpamTrash: z
      .boolean()
      .default(false)
      .meta({
        showWhen: [...LISTS, on("draft", "getMany")],
        ...option("Include Spam and Trash"),
      }),
    limit: z
      .number()
      .int()
      .min(1)
      .max(500)
      .default(20)
      .meta({
        showWhen: [...LISTS, on("draft", "getMany"), on("label", "getMany")],
        title: "Limit",
        description: "The most items to return",
      }),
    simplify: z.boolean().default(true).meta({
      showWhen: PARSED,
      title: "Simplify",
      description:
        "Return subject, addresses, text, html, and a list of attachments. Off: the full answer of Gmail",
    }),
    downloadAttachments: z.boolean().default(false).meta({
      showWhen: PARSED,
      title: "Download Attachments",
      description: "Add the files as binary data: attachment_0, attachment_1, and so on",
    }),
    labelName: z
      .string()
      .optional()
      .meta({ showWhen: on("label", "create"), title: "Name", placeholder: "Invoices" }),
    labelListVisibility: z
      .enum(["labelShow", "labelShowIfUnread", "labelHide"])
      .default("labelShow")
      .meta({
        showWhen: on("label", "create"),
        ...option("Label List Visibility"),
        labels: {
          labelShow: "Show",
          labelShowIfUnread: "Show if Unread",
          labelHide: "Hide",
        },
      }),
    messageListVisibility: z
      .enum(["show", "hide"])
      .default("show")
      .meta({
        showWhen: on("label", "create"),
        ...option("Message List Visibility"),
        labels: { show: "Show", hide: "Hide" },
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

export type GmailConfig = z.output<typeof gmailConfig>;
