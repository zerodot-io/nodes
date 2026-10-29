// SPDX-License-Identifier: AGPL-3.0-only
import { z } from "zod";

// Resource and operation names follow the Anthropic API.

export const RESOURCES = ["message", "file", "model"] as const;
export type Resource = (typeof RESOURCES)[number];

export const OPERATIONS_OF = {
  message: ["create", "countTokens"],
  file: ["upload", "get", "list", "delete"],
  model: ["list"],
} as const satisfies Record<Resource, readonly string[]>;

const ALL_OPERATIONS = [...new Set(Object.values(OPERATIONS_OF).flat())] as [string, ...string[]];

/**
 * The current models. Checked on 2026-10-29 against the Anthropic models overview.
 * The node SDK cannot load a list of options at run time, so "custom" takes any other ID,
 * and the "list" operation of "model" shows what the account can use.
 */
export const MODELS = [
  "claude-fable-5-1",
  "claude-opus-5-5",
  "claude-sonnet-5-5",
  "claude-haiku-5-5",
] as const;
export const DEFAULT_MODEL = "claude-sonnet-5-5";
export const CUSTOM_MODEL = "custom";

export const EFFORTS = ["default", "low", "medium", "high", "xhigh", "max"] as const;
export const IMAGE_TYPES = ["image/jpeg", "image/png", "image/gif", "image/webp"] as const;

type Operations = { [R in Resource]?: readonly (typeof OPERATIONS_OF)[R][number][] };

/** Show a field for these operations of these resources. */
const on = (operations: Operations) => ({
  showWhen: Object.entries(operations).map(([resource, ops]) => ({
    resource: [resource],
    operation: [...(ops ?? [])],
  })),
});

const isMessage = on({ message: ["create", "countTokens"] });

export const anthropicConfig = z
  .object({
    resource: z
      .enum(RESOURCES)
      .default("message")
      .meta({
        labels: { message: "Message", file: "File", model: "Model" },
        hints: {
          message: "Ask Claude, or count the tokens of a prompt",
          file: "Upload, get, list, or delete a file. Use the file ID in a message",
          model: "Get the models that your account can use",
        },
      }),
    operation: z
      .enum(ALL_OPERATIONS)
      .default("create")
      .meta({
        labels: {
          create: "Create",
          countTokens: "Count Tokens",
          upload: "Upload",
          get: "Get",
          list: "List",
          delete: "Delete",
        },
        hints: {
          create: "Send a prompt to Claude and get the answer",
          countTokens: "Count the input tokens of a prompt. Claude does not answer",
          upload: "Store a file with Anthropic. Get a file ID",
          get: "Get the data of one file by its ID",
          list: "Get many files or models",
          delete: "Delete a file from the Anthropic workspace",
        },
      }),
    model: z
      .enum([...MODELS, CUSTOM_MODEL])
      .default(DEFAULT_MODEL)
      .meta({
        ...isMessage,
        labels: {
          "claude-fable-5-1": "Claude Fable 5.1",
          "claude-opus-5-5": "Claude Opus 5.5",
          "claude-sonnet-5-5": "Claude Sonnet 5.5",
          "claude-haiku-5-5": "Claude Haiku 5.5",
          custom: "Custom ID",
        },
        hints: {
          "claude-fable-5-1": "The strongest. For hard reasoning and long agent work",
          "claude-opus-5-5": "Strong. For coding and knowledge work",
          "claude-sonnet-5-5": "Fast and smart. A good first choice",
          "claude-haiku-5-5": "The fastest and the cheapest. For high volume",
          custom: "Type a model ID, such as an older model",
        },
      }),
    customModel: z
      .string()
      .optional()
      .meta({
        showWhen: {
          resource: ["message"],
          operation: ["create", "countTokens"],
          model: [CUSTOM_MODEL],
        },
        title: "Custom Model ID",
        description: "Use the Model List operation to see the IDs",
      }),
    system: z
      .string()
      .optional()
      .meta({
        ...isMessage,
        title: "System Prompt",
        ui: "textarea",
        description: "Rules for Claude, such as its role and the style of the answer",
      }),
    prompt: z
      .string()
      .optional()
      .meta({
        ...isMessage,
        ui: "textarea",
        description: "The message from the user. Needed when there is no image",
      }),
    imageUrls: z
      .string()
      .optional()
      .meta({
        ...isMessage,
        title: "Image URLs",
        description: "Public URLs of images with commas between. Claude reads them with the prompt",
      }),
    imageBase64: z
      .string()
      .optional()
      .meta({
        ...isMessage,
        title: "Image (Base64)",
        description: "One image as Base64 text, without the data: prefix",
      }),
    imageMediaType: z
      .enum(IMAGE_TYPES)
      .default("image/png")
      .meta({
        ...isMessage,
        title: "Image Type",
        description: "The type of the Base64 image",
      }),
    imageFileIds: z
      .string()
      .optional()
      .meta({
        ...isMessage,
        title: "Image File IDs",
        description: "IDs of uploaded images with commas between",
      }),
    documentUrls: z
      .string()
      .optional()
      .meta({
        ...isMessage,
        title: "PDF URLs",
        description: "Public URLs of PDF files with commas between. Claude reads text and images",
      }),
    documentBase64: z
      .string()
      .optional()
      .meta({
        ...isMessage,
        title: "PDF (Base64)",
        description: "One PDF file as Base64 text, without the data: prefix",
      }),
    documentFileIds: z
      .string()
      .optional()
      .meta({
        ...isMessage,
        title: "Document File IDs",
        description: "IDs of uploaded PDF or text files with commas between",
      }),
    maxTokens: z
      .number()
      .int()
      .min(1)
      .max(128_000)
      .default(1024)
      .meta({
        ...on({ message: ["create"] }),
        title: "Max Tokens",
        description: "The most tokens in the answer. Claude can stop sooner",
      }),
    jsonSchema: z
      .string()
      .optional()
      .meta({
        ...on({ message: ["create"] }),
        title: "JSON Schema",
        ui: "code",
        description: "Optional. A JSON Schema. Claude answers with JSON that fits it",
      }),
    effort: z
      .enum(EFFORTS)
      .default("default")
      .meta({
        ...on({ message: ["create"] }),
        description: "How much work Claude does. Default uses the default of the model",
      }),
    // files
    fileBase64: z
      .string()
      .optional()
      .meta({
        ...on({ file: ["upload"] }),
        title: "File (Base64)",
        description: "The file as Base64 text, without the data: prefix. At most 500 MB",
      }),
    fileName: z
      .string()
      .optional()
      .meta({
        ...on({ file: ["upload"] }),
        description: "A name with 1 to 255 characters, such as report.pdf",
      }),
    fileMimeType: z
      .string()
      .optional()
      .meta({
        ...on({ file: ["upload"] }),
        title: "File Type",
        description: "Such as application/pdf or text/plain. Empty means Anthropic finds the type",
      }),
    expiresInSeconds: z
      .number()
      .int()
      .min(3600)
      .max(7_776_000)
      .optional()
      .meta({
        ...on({ file: ["upload"] }),
        title: "Expires In (Seconds)",
        description: "From 3600 (1 hour) to 7776000 (90 days). Empty means the file stays",
      }),
    fileId: z
      .string()
      .optional()
      .meta({
        ...on({ file: ["get", "delete"] }),
        title: "File ID",
        description: "An ID that starts with file_",
      }),
    // lists
    returnAll: z
      .boolean()
      .default(false)
      .meta(on({ file: ["list"], model: ["list"] })),
    limit: z
      .number()
      .int()
      .min(1)
      .max(1000)
      .default(20)
      .meta({
        showWhen: [
          { resource: ["file"], operation: ["list"], returnAll: [false] },
          { resource: ["model"], operation: ["list"], returnAll: [false] },
        ],
      }),
    timeoutMs: z.number().int().min(1).max(600_000).default(120_000),
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

export type AnthropicConfig = z.output<typeof anthropicConfig>;
