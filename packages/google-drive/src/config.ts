// SPDX-License-Identifier: AGPL-3.0-only
import { z } from "zod";

// Resource and operation names follow the Google Drive API v3.

export const RESOURCES = ["file", "folder", "permission"] as const;
export type Resource = (typeof RESOURCES)[number];

export const OPERATIONS_OF = {
  file: [
    "list",
    "get",
    "download",
    "upload",
    "createFromText",
    "update",
    "copy",
    "move",
    "delete",
    "share",
  ],
  folder: ["create", "delete", "share"],
  permission: ["list", "delete"],
} as const satisfies Record<Resource, readonly string[]>;

const ALL_OPERATIONS = [...new Set(Object.values(OPERATIONS_OF).flat())] as [string, ...string[]];

export const AUTHENTICATION = ["oAuth2", "serviceAccount"] as const;

type Rule = { resource: string[]; operation?: string[] };

/** Show a field only for these operations of a resource. */
const rule = (resource: Resource, ...operation: string[]): Rule => ({
  resource: [resource],
  operation,
});

/** Show a field for the rules. One rule is an object, more rules are a list. */
const show = (...rules: Rule[]) => ({
  showWhen: rules.length === 1 ? (rules[0] as Rule) : rules,
});

/** The operations that act on one file or folder by its ID. */
const ON_FILE_ID = [
  rule("file", "get", "download", "update", "copy", "move", "delete", "share"),
  rule("folder", "delete", "share"),
  rule("permission", "list", "delete"),
];
const SHARE = [rule("file", "share"), rule("folder", "share")];
const DELETE = [rule("file", "delete"), rule("folder", "delete")];
const NEEDS_BYTES = [rule("file", "upload"), rule("file", "createFromText")];

export const driveConfig = z
  .object({
    authentication: z
      .enum(AUTHENTICATION)
      .default("oAuth2")
      .meta({
        title: "Authentication",
        labels: { oAuth2: "OAuth2", serviceAccount: "Service Account" },
        hints: {
          oAuth2: "Sign in with a Google account",
          serviceAccount: "Use the JSON key of a service account",
        },
      }),
    resource: z
      .enum(RESOURCES)
      .default("file")
      .meta({
        labels: { file: "File", folder: "Folder", permission: "Permission" },
        hints: {
          file: "Find, read, write, copy, move, and share files",
          folder: "Create, delete, and share folders",
          permission: "See who can open a file or folder, and remove access",
        },
      }),
    operation: z
      .enum(ALL_OPERATIONS)
      .default("list")
      .meta({
        labels: {
          list: "List or Search",
          get: "Get",
          download: "Download",
          upload: "Upload",
          createFromText: "Create From Text",
          update: "Update",
          copy: "Copy",
          move: "Move",
          delete: "Delete",
          share: "Share",
          create: "Create",
        },
        hints: {
          list: "Find files and folders by name, type, folder, or a Drive query",
          get: "Get the details of a file or folder",
          download: "Get the content of a file as binary data",
          upload: "Upload binary data from the input as a new file",
          createFromText: "Make a new file from text",
          update: "Change the name or the description of a file",
          copy: "Make a copy of a file",
          move: "Move a file to another folder",
          delete: "Move to the trash, or delete for good",
          share: "Give a user, a group, a domain, or everyone access",
          create: "Make a new folder",
        },
      }),
    fileId: z
      .string()
      .optional()
      .meta({
        ...show(...ON_FILE_ID),
        title: "File or Folder",
        description: "The URL, or the ID",
      }),
    parentId: z
      .string()
      .optional()
      .meta({
        ...show(
          rule("file", "list", "upload", "createFromText", "copy", "move"),
          rule("folder", "create"),
        ),
        title: "Folder",
        description:
          "The URL or the ID of the folder, or root for My Drive. Empty: the root for a new file, any folder for a search. A move needs a folder",
      }),
    query: z
      .string()
      .optional()
      .meta({
        ...show(rule("file", "list")),
        title: "Drive Query",
        description: "A Drive search query, for example modifiedTime > '2026-01-01T00:00:00'",
      }),
    nameContains: z
      .string()
      .optional()
      .meta({ ...show(rule("file", "list")), title: "Name Contains" }),
    mimeTypeFilter: z
      .string()
      .optional()
      .meta({
        ...show(rule("file", "list")),
        title: "Type",
        description:
          "A MIME type, for example application/pdf or application/vnd.google-apps.folder",
      }),
    includeTrashed: z
      .boolean()
      .default(false)
      .meta({ ...show(rule("file", "list")), title: "Include Trashed" }),
    returnAll: z
      .boolean()
      .default(false)
      .meta({ ...show(rule("file", "list")), title: "Return All" }),
    limit: z
      .number()
      .int()
      .min(1)
      .max(1000)
      .default(100)
      .meta({
        showWhen: { resource: ["file"], operation: ["list"], returnAll: [false] },
        title: "Limit",
      }),
    name: z
      .string()
      .optional()
      .meta({
        ...show(
          rule("file", "upload", "createFromText", "copy", "update"),
          rule("folder", "create"),
        ),
        title: "Name",
        description:
          "Upload: empty means the name of the binary data. Copy and update: empty means no change",
      }),
    description: z
      .string()
      .optional()
      .meta({ ...show(rule("file", "upload", "createFromText", "update")), title: "Description" }),
    binaryPropertyName: z
      .string()
      .default("data")
      .meta({
        ...show(rule("file", "download", "upload")),
        title: "Binary Property",
        description:
          "Name of the binary property to read from the input, or to write the download to",
      }),
    content: z
      .string()
      .optional()
      .meta({ ...show(rule("file", "createFromText")), title: "Text", ui: "textarea" }),
    contentType: z
      .string()
      .optional()
      .meta({
        ...show(...NEEDS_BYTES),
        title: "MIME Type",
        description:
          "Empty means the type of the binary data, or text/plain for text. A Google type, such as application/vnd.google-apps.document, converts the file",
      }),
    exportMimeType: z
      .string()
      .optional()
      .meta({
        ...show(rule("file", "download")),
        title: "Export Format",
        description:
          "For Google Docs, Sheets, and Slides files: the MIME type of the download. Empty means PDF (Sheets: xlsx)",
      }),
    permanently: z
      .boolean()
      .default(false)
      .meta({
        ...show(...DELETE),
        title: "Delete Permanently",
        description: "Skip the trash. You cannot undo this",
      }),
    role: z
      .enum(["reader", "commenter", "writer", "fileOrganizer", "organizer"])
      .default("reader")
      .meta({
        ...show(...SHARE),
        title: "Role",
        labels: {
          reader: "Viewer",
          commenter: "Commenter",
          writer: "Editor",
          fileOrganizer: "Content Manager",
          organizer: "Manager",
        },
        hints: {
          fileOrganizer: "Shared drives only",
          organizer: "Shared drives only",
        },
      }),
    shareType: z
      .enum(["user", "group", "domain", "anyone"])
      .default("user")
      .meta({
        ...show(...SHARE),
        title: "Share With",
        labels: { user: "User", group: "Group", domain: "Domain", anyone: "Anyone" },
        hints: { anyone: "Anyone with the link" },
      }),
    emailAddress: z
      .string()
      .optional()
      .meta({
        showWhen: [
          { resource: ["file"], operation: ["share"], shareType: ["user", "group"] },
          { resource: ["folder"], operation: ["share"], shareType: ["user", "group"] },
        ],
        title: "Email Address",
      }),
    domain: z
      .string()
      .optional()
      .meta({
        showWhen: [
          { resource: ["file"], operation: ["share"], shareType: ["domain"] },
          { resource: ["folder"], operation: ["share"], shareType: ["domain"] },
        ],
        title: "Domain",
      }),
    sendNotification: z
      .boolean()
      .default(true)
      .meta({
        showWhen: [
          { resource: ["file"], operation: ["share"], shareType: ["user", "group"] },
          { resource: ["folder"], operation: ["share"], shareType: ["user", "group"] },
        ],
        title: "Send Email",
        description: "Send an email to tell the person about the access",
      }),
    message: z
      .string()
      .optional()
      .meta({
        showWhen: [
          {
            resource: ["file"],
            operation: ["share"],
            shareType: ["user", "group"],
            sendNotification: [true],
          },
          {
            resource: ["folder"],
            operation: ["share"],
            shareType: ["user", "group"],
            sendNotification: [true],
          },
        ],
        title: "Message",
        ui: "textarea",
      }),
    permissionId: z
      .string()
      .optional()
      .meta({
        ...show(rule("permission", "delete")),
        title: "Permission ID",
        description: "Get the ID from the Permission list operation",
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

export type DriveConfig = z.output<typeof driveConfig>;
