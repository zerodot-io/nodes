// SPDX-License-Identifier: AGPL-3.0-only
import { z } from "zod";
import { PROVIDER_LABEL, PROVIDERS, type Provider } from "./api";
import {
  ANTHROPIC_MODELS,
  CUSTOM_MODEL,
  GEMINI_EMBEDDING_MODELS,
  GEMINI_IMAGE_MODELS,
  GEMINI_TEXT_MODELS,
  idsOf,
  MODERATION_MODELS,
  type ModelEntry,
  OPENAI_EMBEDDING_MODELS,
  OPENAI_IMAGE_MODELS,
  OPENAI_TEXT_MODELS,
  SPEECH_MODELS,
  TRANSCRIPTION_MODELS,
  TRANSLATION_MODELS,
} from "./models";

// Resource and operation names follow the OpenAI API. The provider decides which ones work.

export const RESOURCES = [
  "text",
  "embedding",
  "image",
  "moderation",
  "audio",
  "file",
  "model",
  "conversation",
  "conversationItem",
] as const;
export type Resource = (typeof RESOURCES)[number];

export const ALL_OPERATIONS = [
  "generate",
  "countTokens",
  "create",
  "check",
  "edit",
  "transcribe",
  "translate",
  "speak",
  "upload",
  "list",
  "delete",
  "get",
  "update",
  "add",
] as const;

type Operations = Partial<Record<Resource, readonly string[]>>;

/** The operations that each provider supports. The config checks it, and the editor shows fields from it. */
export const SUPPORT = {
  openai: {
    text: ["generate"],
    embedding: ["create"],
    image: ["generate", "edit"],
    moderation: ["check"],
    audio: ["transcribe", "translate", "speak"],
    file: ["upload", "list", "delete"],
    model: ["list"],
    conversation: ["create", "get", "update", "delete"],
    conversationItem: ["add", "list", "get", "delete"],
  },
  anthropic: {
    text: ["generate", "countTokens"],
    file: ["upload", "get", "list", "delete"],
    model: ["list"],
  },
  gemini: {
    text: ["generate", "countTokens"],
    embedding: ["create"],
    image: ["generate", "edit"],
    file: ["upload", "get", "list", "delete"],
    model: ["list"],
  },
  compatible: {
    text: ["generate"],
    embedding: ["create"],
    model: ["list"],
  },
} as const satisfies Record<Provider, Operations>;

export const supports = (provider: Provider, resource: Resource, operation: string): boolean => {
  const operations: readonly string[] = (SUPPORT[provider] as Operations)[resource] ?? [];
  return operations.includes(operation);
};

export const RESPONSE_FORMATS = ["text", "json_object", "json_schema"] as const;
export const TOOL_CHOICES = ["auto", "any", "tool", "none"] as const;
export const EFFORTS = ["default", "low", "medium", "high", "xhigh", "max"] as const;
export const SPEECH_FORMATS = ["mp3", "opus", "aac", "flac", "wav", "pcm"] as const;
export const FILE_PURPOSES = [
  "user_data",
  "assistants",
  "batch",
  "fine-tune",
  "vision",
  "evals",
] as const;
export const ITEM_ORDERS = ["asc", "desc"] as const;
export const IMAGE_SIZES = ["auto", "1024x1024", "1536x1024", "1024x1536"] as const;
export const IMAGE_QUALITIES = ["auto", "low", "medium", "high"] as const;
export const IMAGE_FORMATS = ["png", "jpeg", "webp"] as const;
export const IMAGE_BACKGROUNDS = ["auto", "opaque", "transparent"] as const;
export const GEMINI_ASPECT_RATIOS = [
  "auto",
  "1:1",
  "2:3",
  "3:2",
  "3:4",
  "4:3",
  "4:5",
  "5:4",
  "9:16",
  "16:9",
  "21:9",
] as const;
export const GEMINI_IMAGE_SIZES = ["auto", "512", "1K", "2K", "4K"] as const;

/** The provider options. The select reads them. To add an icon to an option, change only this list. */
export const PROVIDER_OPTIONS = [
  {
    id: "openai",
    label: "OpenAI",
    hint: "GPT models. Text, images, audio, moderation, files, and conversations",
  },
  {
    id: "anthropic",
    label: "Anthropic",
    hint: "Claude models. Text, PDF files, token counts, and files",
  },
  {
    id: "gemini",
    label: "Google Gemini",
    hint: "Gemini models. Text, images, token counts, and files",
  },
  {
    id: "compatible",
    label: "OpenAI-compatible",
    hint: "Any service with an OpenAI-style API, such as Ollama or a gateway",
  },
] as const satisfies readonly { id: Provider; label: string; hint: string }[];

type Rule = { provider: Provider[]; resource: Resource[]; operation: string[] };

/** Rules to show a field for these operations when the provider is one of these. */
const rules = (providers: readonly Provider[], operations: Operations): Rule[] =>
  Object.entries(operations).map(([resource, ops]) => ({
    provider: [...providers],
    resource: [resource as Resource],
    operation: [...ops],
  }));

/** Show a field when any of the groups of rules matches. */
const show = (...groups: Rule[][]) => ({ showWhen: groups.flat() });

const EVERY = PROVIDERS;
const NOT_ANTHROPIC = ["openai", "compatible", "gemini"] as const;
const COUNTERS = ["anthropic", "gemini"] as const;

/** Labels and hints for a model select. The last option is Custom. */
const modelMeta = (
  providers: readonly Provider[],
  operations: Operations,
  models: readonly ModelEntry[],
) => ({
  ...show(rules(providers, operations)),
  title: "Model",
  labels: {
    ...Object.fromEntries(models.map((model) => [model.id, model.label])),
    [CUSTOM_MODEL]: "Custom",
  },
  hints: {
    ...Object.fromEntries(models.map((model) => [model.id, model.hint])),
    [CUSTOM_MODEL]: "Type any model id in Custom Model",
  },
});

const hasCustomModel = (
  key: string,
  provider: Provider,
  resource: Resource,
  operations: readonly string[],
) => ({
  provider: [provider],
  resource: [resource],
  operation: [...operations],
  [key]: [CUSTOM_MODEL],
});

export const aiConfig = z
  .object({
    provider: z
      .enum(PROVIDERS)
      .default("openai")
      .meta({
        labels: Object.fromEntries(PROVIDER_OPTIONS.map((option) => [option.id, option.label])),
        hints: Object.fromEntries(PROVIDER_OPTIONS.map((option) => [option.id, option.hint])),
      }),
    resource: z
      .enum(RESOURCES)
      .default("text")
      .meta({
        labels: {
          text: "Text",
          embedding: "Embedding",
          image: "Image",
          moderation: "Moderation",
          audio: "Audio",
          file: "File",
          model: "Model",
          conversation: "Conversation",
          conversationItem: "Conversation Item",
        },
        hints: {
          text: "Write text with a chat model. Images can be input. All providers",
          embedding: "Turn text into a vector of numbers. Not for Anthropic",
          image: "Make images from a prompt. OpenAI and Gemini",
          moderation: "Check text or images for harmful content. OpenAI only",
          audio: "Turn speech into text, or text into speech. OpenAI only",
          file: "Upload, get, list, or delete files. OpenAI, Anthropic, and Gemini",
          model: "List the models that the key can use. All providers",
          conversation: "Make, read, change, or delete a conversation. OpenAI only",
          conversationItem: "Add, list, read, or delete conversation items. OpenAI only",
        },
      }),
    operation: z
      .enum(ALL_OPERATIONS)
      .default("generate")
      .meta({
        labels: {
          generate: "Generate",
          countTokens: "Count Tokens",
          create: "Create",
          check: "Check",
          edit: "Edit",
          transcribe: "Transcribe",
          translate: "Translate",
          speak: "Speak",
          upload: "Upload",
          list: "List",
          delete: "Delete",
          get: "Get",
          update: "Update",
          add: "Add",
        },
        hints: {
          generate: "Make text or images",
          countTokens: "Count the input tokens of a prompt. The model does not answer",
          create: "Make an embedding",
          check: "Find harmful content",
          edit: "Change an image with a prompt",
          transcribe: "Turn an audio file into text",
          translate: "Turn an audio file into English text",
          speak: "Turn text into an audio file",
          upload: "Add a file to the account",
          list: "Get many items",
          delete: "Delete a file, a conversation, or an item",
          get: "Get one file, one conversation, or one item",
          update: "Change the metadata of a conversation",
          add: "Add items to a conversation",
        },
      }),
    // models
    openaiTextModel: z
      .enum(idsOf(OPENAI_TEXT_MODELS))
      .default("gpt-6.1-terra")
      .meta(modelMeta(["openai"], { text: ["generate"] }, OPENAI_TEXT_MODELS)),
    anthropicModel: z
      .enum(idsOf(ANTHROPIC_MODELS))
      .default("claude-sonnet-5-5")
      .meta(modelMeta(["anthropic"], { text: ["generate", "countTokens"] }, ANTHROPIC_MODELS)),
    geminiTextModel: z
      .enum(idsOf(GEMINI_TEXT_MODELS))
      .default("gemini-3.8-flash")
      .meta(modelMeta(["gemini"], { text: ["generate", "countTokens"] }, GEMINI_TEXT_MODELS)),
    openaiEmbeddingModel: z
      .enum(idsOf(OPENAI_EMBEDDING_MODELS))
      .default("text-embedding-3-small")
      .meta(modelMeta(["openai"], { embedding: ["create"] }, OPENAI_EMBEDDING_MODELS)),
    geminiEmbeddingModel: z
      .enum(idsOf(GEMINI_EMBEDDING_MODELS))
      .default("gemini-embedding-2")
      .meta(modelMeta(["gemini"], { embedding: ["create"] }, GEMINI_EMBEDDING_MODELS)),
    openaiImageModel: z
      .enum(idsOf(OPENAI_IMAGE_MODELS))
      .default("gpt-image-2.5-flare")
      .meta(modelMeta(["openai"], { image: ["generate", "edit"] }, OPENAI_IMAGE_MODELS)),
    geminiImageModel: z
      .enum(idsOf(GEMINI_IMAGE_MODELS))
      .default("gemini-nano-banana-2.1")
      .meta(modelMeta(["gemini"], { image: ["generate", "edit"] }, GEMINI_IMAGE_MODELS)),
    moderationModel: z
      .enum(idsOf(MODERATION_MODELS))
      .default("omni-moderation-latest")
      .meta(modelMeta(["openai"], { moderation: ["check"] }, MODERATION_MODELS)),
    audioModel: z
      .enum(idsOf(TRANSCRIPTION_MODELS))
      .default("gpt-transcribe")
      .meta(modelMeta(["openai"], { audio: ["transcribe"] }, TRANSCRIPTION_MODELS)),
    translationModel: z
      .enum(idsOf(TRANSLATION_MODELS))
      .default("whisper-1")
      .meta(modelMeta(["openai"], { audio: ["translate"] }, TRANSLATION_MODELS)),
    speechModel: z
      .enum(idsOf(SPEECH_MODELS))
      .default("gpt-4o-mini-tts")
      .meta(modelMeta(["openai"], { audio: ["speak"] }, SPEECH_MODELS)),
    customModel: z
      .string()
      .optional()
      .meta({
        showWhen: [
          hasCustomModel("openaiTextModel", "openai", "text", ["generate"]),
          hasCustomModel("anthropicModel", "anthropic", "text", ["generate", "countTokens"]),
          hasCustomModel("geminiTextModel", "gemini", "text", ["generate", "countTokens"]),
          hasCustomModel("openaiEmbeddingModel", "openai", "embedding", ["create"]),
          hasCustomModel("geminiEmbeddingModel", "gemini", "embedding", ["create"]),
          hasCustomModel("openaiImageModel", "openai", "image", ["generate", "edit"]),
          hasCustomModel("geminiImageModel", "gemini", "image", ["generate", "edit"]),
          hasCustomModel("moderationModel", "openai", "moderation", ["check"]),
          hasCustomModel("audioModel", "openai", "audio", ["transcribe"]),
          hasCustomModel("translationModel", "openai", "audio", ["translate"]),
          hasCustomModel("speechModel", "openai", "audio", ["speak"]),
          // A compatible service has no model list. The user types the id.
          ...rules(["compatible"], { text: ["generate"], embedding: ["create"] }),
        ],
        title: "Custom Model ID",
        description: "A model id, such as one from the List operation or from a compatible service",
      }),
    // text
    systemPrompt: z
      .string()
      .optional()
      .meta({
        ...show(rules(EVERY, { text: ["generate", "countTokens"] })),
        ui: "textarea",
        description: "Rules for the model. For example its role or its tone",
      }),
    prompt: z
      .string()
      .optional()
      .meta({
        ...show(
          rules(EVERY, { text: ["generate", "countTokens"] }),
          rules(["openai", "gemini"], { image: ["generate", "edit"] }),
        ),
        ui: "textarea",
        description:
          "The message to the model, or the description of the image. Needed when there is no image",
      }),
    imageUrls: z
      .string()
      .optional()
      .meta({
        ui: "textarea",
        ...show(
          rules(EVERY, { text: ["generate", "countTokens"] }),
          rules(["openai"], { moderation: ["check"] }),
        ),
        title: "Image URLs",
        description:
          "One URL on each line. Public image URLs or data URLs. Gemini reads only data URLs and File URIs. The model must read images",
      }),
    imageProperty: z
      .string()
      .optional()
      .meta({
        ...show(
          rules(EVERY, { text: ["generate", "countTokens"] }),
          rules(["openai"], { moderation: ["check"] }),
        ),
        title: "Input Image Field",
        description: "Optional. An image is in binary.<property> of the input",
      }),
    imageFileIds: z
      .string()
      .optional()
      .meta({
        ui: "textarea",
        ...show(rules(["anthropic"], { text: ["generate", "countTokens"] })),
        title: "Image File IDs",
        description: "IDs of uploaded images, one on each line",
      }),
    documentUrls: z
      .string()
      .optional()
      .meta({
        ui: "textarea",
        ...show(rules(["anthropic"], { text: ["generate", "countTokens"] })),
        title: "PDF URLs",
        description: "One public URL of a PDF file on each line. Claude reads text and images",
      }),
    documentProperty: z
      .string()
      .optional()
      .meta({
        ...show(rules(["anthropic"], { text: ["generate", "countTokens"] })),
        title: "Input PDF Field",
        description: "Optional. A PDF file is in binary.<property> of the input",
      }),
    documentFileIds: z
      .string()
      .optional()
      .meta({
        ui: "textarea",
        ...show(rules(["anthropic"], { text: ["generate", "countTokens"] })),
        title: "Document File IDs",
        description: "IDs of uploaded PDF or text files, one on each line",
      }),
    fileUris: z
      .string()
      .optional()
      .meta({
        ui: "textarea",
        ...show(rules(["gemini"], { text: ["generate", "countTokens"] })),
        title: "File URIs",
        description: "URIs of uploaded files, one on each line. Use the uri of a File Upload",
      }),
    temperature: z
      .number()
      .min(0)
      .max(2)
      .optional()
      .meta({
        ...show(rules(NOT_ANTHROPIC, { text: ["generate"] })),
        description: "Empty uses the default of the model. Some models do not accept this value",
      }),
    maxTokens: z
      .number()
      .int()
      .min(1)
      .optional()
      .meta({
        ...show(rules(EVERY, { text: ["generate"] })),
        title: "Max Output Tokens",
        description:
          "The most tokens in the answer. Empty means 1024 for Anthropic and no limit from the node for the others",
      }),
    responseFormat: z
      .enum(RESPONSE_FORMATS)
      .default("text")
      .meta({
        ...show(rules(EVERY, { text: ["generate"] })),
        labels: { text: "Text", json_object: "JSON", json_schema: "JSON Schema" },
        hints: {
          text: "Free text",
          json_object:
            "A valid JSON object. Not for Anthropic. OpenAI needs the word JSON in the prompt",
          json_schema: "A JSON object that follows your schema",
        },
      }),
    jsonSchema: z
      .string()
      .optional()
      .meta({
        showWhen: EVERY.map((provider) => ({
          provider: [provider],
          resource: ["text"],
          operation: ["generate"],
          responseFormat: ["json_schema"],
        })),
        title: "JSON Schema",
        ui: "code",
        description:
          "A JSON Schema as JSON. For OpenAI, set additionalProperties to false on each object",
      }),
    effort: z
      .enum(EFFORTS)
      .default("default")
      .meta({
        ...show(rules(["anthropic"], { text: ["generate"] })),
        description: "How much work Claude does. Default uses the default of the model",
      }),
    tools: z
      .string()
      .optional()
      .meta({
        ...show(rules(EVERY, { text: ["generate"] }), rules(COUNTERS, { text: ["countTokens"] })),
        ui: "code",
        description:
          'Optional. A JSON array of tools. Each tool has "name", "description", and "input_schema" (a JSON Schema object)',
      }),
    toolChoice: z
      .enum(TOOL_CHOICES)
      .default("auto")
      .meta({
        ...show(rules(EVERY, { text: ["generate"] })),
        title: "Tool Choice",
        labels: { auto: "Auto", any: "Any Tool", tool: "One Tool", none: "No Tool" },
        hints: {
          auto: "The model decides if it calls a tool",
          any: "The model must call one of the tools. Some models answer 400 to this",
          tool: "The model must call the tool that you name. Some models answer 400 to this",
          none: "The model does not call a tool",
        },
      }),
    toolChoiceName: z
      .string()
      .optional()
      .meta({
        showWhen: EVERY.map((provider) => ({
          provider: [provider],
          resource: ["text"],
          operation: ["generate"],
          toolChoice: ["tool"],
        })),
        title: "Tool Name",
        description: "The name of the tool that the model must call",
      }),
    disableParallelToolUse: z
      .boolean()
      .default(false)
      .meta({
        ...show(rules(["openai", "compatible", "anthropic"], { text: ["generate"] })),
        title: "Disable Parallel Tool Use",
        description: "On: the model calls at most one tool in an answer",
      }),
    assistantContent: z
      .string()
      .optional()
      .meta({
        ...show(rules(["anthropic"], { text: ["generate"] })),
        title: "Previous Answer Content",
        ui: "code",
        description:
          "Optional. To continue after a tool call: the JSON array in `assistantContent` of the last output",
      }),
    toolResults: z
      .string()
      .optional()
      .meta({
        ...show(rules(["anthropic"], { text: ["generate"] })),
        title: "Tool Results",
        ui: "code",
        description:
          'Optional. A JSON array. Each item has "tool_use_id", "content", and optional "is_error". Set Previous Answer Content too',
      }),
    includeRaw: z
      .boolean()
      .default(false)
      .meta({
        ...show(rules(EVERY, { text: ["generate", "countTokens"] })),
        title: "Include Raw Answer",
        description: "On: the output has the full answer of the provider in `raw`",
      }),
    // embedding, moderation, speech
    input: z
      .string()
      .optional()
      .meta({
        ...show(
          rules(NOT_ANTHROPIC, { embedding: ["create"] }),
          rules(["openai"], { moderation: ["check"], audio: ["speak"] }),
        ),
        ui: "textarea",
        description: "The text to use",
      }),
    dimensions: z
      .number()
      .int()
      .min(1)
      .optional()
      .meta({
        ...show(rules(NOT_ANTHROPIC, { embedding: ["create"] })),
        description: "A shorter vector. Not all models allow it. Empty keeps the full size",
      }),
    // image
    size: z
      .enum(IMAGE_SIZES)
      .default("auto")
      .meta({
        ...show(rules(["openai"], { image: ["generate", "edit"] })),
        labels: {
          auto: "Auto",
          "1024x1024": "Square",
          "1536x1024": "Landscape",
          "1024x1536": "Portrait",
        },
        hints: {
          auto: "The model picks the size",
          "1024x1024": "1024 x 1024",
          "1536x1024": "1536 x 1024",
          "1024x1536": "1024 x 1536",
        },
      }),
    quality: z
      .enum(IMAGE_QUALITIES)
      .default("auto")
      .meta({
        ...show(rules(["openai"], { image: ["generate", "edit"] })),
        labels: { auto: "Auto", low: "Low", medium: "Medium", high: "High" },
        hints: {
          auto: "The model picks the quality",
          low: "Fast and low cost",
          medium: "A balance of cost and detail",
          high: "The most detail. Costs more",
        },
      }),
    outputFormat: z
      .enum(IMAGE_FORMATS)
      .default("png")
      .meta({
        ...show(rules(["openai"], { image: ["generate", "edit"] })),
        labels: { png: "PNG", jpeg: "JPEG", webp: "WebP" },
        hints: {
          png: "No loss. Can have a clear background",
          jpeg: "Small files. No clear background",
          webp: "Small files. Can have a clear background",
        },
      }),
    background: z
      .enum(IMAGE_BACKGROUNDS)
      .default("auto")
      .meta({
        ...show(rules(["openai"], { image: ["generate", "edit"] })),
        labels: { auto: "Auto", opaque: "Opaque", transparent: "Transparent" },
        hints: {
          auto: "The model picks the background",
          opaque: "A solid background",
          transparent: "A clear background. Use PNG or WebP",
        },
      }),
    count: z
      .number()
      .int()
      .min(1)
      .max(10)
      .default(1)
      .meta({
        ...show(rules(["openai"], { image: ["generate", "edit"] })),
        title: "Number of Images",
      }),
    aspectRatio: z
      .enum(GEMINI_ASPECT_RATIOS)
      .default("auto")
      .meta({
        ...show(rules(["gemini"], { image: ["generate", "edit"] })),
        labels: Object.fromEntries(
          GEMINI_ASPECT_RATIOS.map((ratio) => [ratio, ratio === "auto" ? "Auto" : ratio]),
        ),
        hints: Object.fromEntries(
          GEMINI_ASPECT_RATIOS.map((ratio) => [
            ratio,
            ratio === "auto" ? "The model picks the shape" : `Width to height ${ratio}`,
          ]),
        ),
      }),
    imageSize: z
      .enum(GEMINI_IMAGE_SIZES)
      .default("auto")
      .meta({
        ...show(rules(["gemini"], { image: ["generate", "edit"] })),
        labels: { auto: "Auto", "512": "512", "1K": "1K", "2K": "2K", "4K": "4K" },
        hints: {
          auto: "The model uses 1K",
          "512": "Small. Some models do not allow it",
          "1K": "About 1000 pixels on the long side",
          "2K": "About 2000 pixels on the long side",
          "4K": "About 4000 pixels on the long side",
        },
      }),
    // binary input and output
    property: z
      .string()
      .min(1)
      .default("data")
      .meta({
        ...show(
          rules(["openai"], { audio: ["transcribe", "translate"] }),
          rules(["openai", "gemini"], { image: ["edit"] }),
          rules(["openai", "anthropic", "gemini"], { file: ["upload"] }),
        ),
        title: "Input Binary Field",
        description: "The file is in binary.<property> of the input. An audio file: at most 25 MB",
      }),
    outputProperty: z
      .string()
      .min(1)
      .default("data")
      .meta({
        ...show(
          rules(["openai", "gemini"], { image: ["generate", "edit"] }),
          rules(["openai"], { audio: ["speak"] }),
        ),
        title: "Output Binary Field",
        description: "The result goes to binary.<property> of the output",
      }),
    // transcription
    language: z
      .string()
      .optional()
      .meta({
        ...show(rules(["openai"], { audio: ["transcribe"] })),
        description: "Optional. The language of the audio as two letters, such as en",
      }),
    transcriptionPrompt: z
      .string()
      .optional()
      .meta({
        ...show(rules(["openai"], { audio: ["transcribe", "translate"] })),
        title: "Prompt",
        description: "Optional. Words or names that the audio has. This helps the model",
      }),
    // speech
    voice: z
      .string()
      .min(1)
      .default("alloy")
      .meta({
        ...show(rules(["openai"], { audio: ["speak"] })),
        description: "The name of a voice, such as alloy, coral, or nova",
      }),
    speechFormat: z
      .enum(SPEECH_FORMATS)
      .default("mp3")
      .meta({
        ...show(rules(["openai"], { audio: ["speak"] })),
        title: "Format",
        labels: { mp3: "MP3", opus: "Opus", aac: "AAC", flac: "FLAC", wav: "WAV", pcm: "PCM" },
        hints: {
          mp3: "The default format",
          opus: "Small files for streaming",
          aac: "For many phones and browsers",
          flac: "No loss",
          wav: "No loss. Low delay",
          pcm: "Raw audio samples",
        },
      }),
    speed: z
      .number()
      .min(0.25)
      .max(4)
      .optional()
      .meta({
        ...show(rules(["openai"], { audio: ["speak"] })),
        description: "From 0.25 to 4. Empty means normal speed",
      }),
    instructions: z
      .string()
      .optional()
      .meta({
        ...show(rules(["openai"], { audio: ["speak"] })),
        ui: "textarea",
        description: "Optional. How to speak, such as the tone or the pace",
      }),
    // files
    purpose: z
      .enum(FILE_PURPOSES)
      .default("user_data")
      .meta({
        ...show(rules(["openai"], { file: ["upload"] })),
        labels: {
          user_data: "User Data",
          assistants: "Assistants",
          batch: "Batch",
          "fine-tune": "Fine-tune",
          vision: "Vision",
          evals: "Evals",
        },
        hints: {
          user_data: "Any file for a model to use",
          assistants: "A file for the Assistants API",
          batch: "A file of batch requests",
          "fine-tune": "Training data for a fine-tune",
          vision: "An image for a vision fine-tune",
          evals: "Data for an evaluation",
        },
      }),
    expiresInSeconds: z
      .number()
      .int()
      .min(3600)
      .max(7_776_000)
      .optional()
      .meta({
        ...show(rules(["anthropic"], { file: ["upload"] })),
        title: "Expires In (Seconds)",
        description: "From 3600 (1 hour) to 7776000 (90 days). Empty means the file stays",
      }),
    fileId: z
      .string()
      .optional()
      .meta({
        ...show(
          rules(["openai"], { file: ["delete"] }),
          rules(["anthropic", "gemini"], { file: ["get", "delete"] }),
        ),
        title: "File ID",
        description: "OpenAI: file-… Anthropic: file_… Gemini: the part after files/",
      }),
    // conversations
    conversationId: z
      .string()
      .optional()
      .meta({
        ...show(
          rules(["openai"], {
            conversation: ["get", "update", "delete"],
            conversationItem: ["add", "list", "get", "delete"],
          }),
        ),
        title: "Conversation ID",
        description: "An ID that starts with conv_",
      }),
    itemId: z
      .string()
      .optional()
      .meta({
        ...show(rules(["openai"], { conversationItem: ["get", "delete"] })),
        title: "Item ID",
        description: "The ID of an item of the conversation",
      }),
    metadata: z
      .string()
      .optional()
      .meta({
        ...show(rules(["openai"], { conversation: ["create", "update"] })),
        ui: "textarea",
        description:
          'A JSON object, for example {"topic":"demo"}. At most 16 keys. Values are text. Required to update',
      }),
    conversationItems: z
      .string()
      .optional()
      .meta({
        ...show(rules(["openai"], { conversation: ["create"], conversationItem: ["add"] })),
        ui: "textarea",
        description:
          'A JSON array of items, for example [{"type":"message","role":"user","content":"Hello"}]. At most 20 items. Required to add',
      }),
    itemLimit: z
      .number()
      .int()
      .min(1)
      .max(100)
      .default(20)
      .meta({
        ...show(rules(["openai"], { conversationItem: ["list"] })),
        title: "Item Limit",
        description: "How many items to get. From 1 to 100",
      }),
    itemOrder: z
      .enum(ITEM_ORDERS)
      .default("asc")
      .meta({
        ...show(rules(["openai"], { conversationItem: ["list"] })),
        title: "Order",
        labels: { asc: "Oldest first", desc: "Newest first" },
        hints: { asc: "Start with the oldest item", desc: "Start with the newest item" },
      }),
    itemAfter: z
      .string()
      .optional()
      .meta({
        ...show(rules(["openai"], { conversationItem: ["list"] })),
        title: "After",
        description: "Optional. An item ID. Get the items after it",
      }),
    // lists
    nameFilter: z
      .string()
      .optional()
      .meta({
        ...show(rules(EVERY, { model: ["list"] })),
        description: "Optional. Keep only the models with this text in the id",
      }),
    returnAll: z
      .boolean()
      .default(false)
      .meta(
        show(rules(EVERY, { model: ["list"] }), rules(["anthropic", "gemini"], { file: ["list"] })),
      ),
    limit: z
      .number()
      .int()
      .min(1)
      .max(1000)
      .default(20)
      .meta({
        showWhen: [
          ...EVERY.map((provider) => ({
            provider: [provider],
            resource: ["model"],
            operation: ["list"],
            returnAll: [false],
          })),
          ...(["anthropic", "gemini"] as const).map((provider) => ({
            provider: [provider],
            resource: ["file"],
            operation: ["list"],
            returnAll: [false],
          })),
        ],
      }),
    timeoutMs: z.number().int().min(1).max(600_000).default(120_000),
  })
  .superRefine((config, context) => {
    if (!supports(config.provider, config.resource, config.operation)) {
      context.addIssue({
        code: "custom",
        path: ["operation"],
        message: `${PROVIDER_LABEL[config.provider]} has no "${config.resource}.${config.operation}" operation`,
      });
    }
  });

export type AIConfig = z.output<typeof aiConfig>;
