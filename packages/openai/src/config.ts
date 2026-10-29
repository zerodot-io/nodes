// SPDX-License-Identifier: AGPL-3.0-only
import { z } from "zod";
import {
  CUSTOM_MODEL,
  EMBEDDING_MODELS,
  IMAGE_MODELS,
  idsOf,
  MODERATION_MODELS,
  type ModelEntry,
  SPEECH_MODELS,
  TEXT_MODELS,
  TRANSCRIPTION_MODELS,
  TRANSLATION_MODELS,
} from "./models";

// Resource and operation names follow the OpenAI API.

export const RESOURCES = [
  "text",
  "embedding",
  "image",
  "moderation",
  "audio",
  "file",
  "model",
] as const;
export type Resource = (typeof RESOURCES)[number];

export const OPERATIONS_OF = {
  text: ["generate"],
  embedding: ["create"],
  image: ["generate", "edit"],
  moderation: ["check"],
  audio: ["transcribe", "translate", "speak"],
  file: ["upload", "list", "delete"],
  model: ["list"],
} as const satisfies Record<Resource, readonly string[]>;

const ALL_OPERATIONS = [...new Set(Object.values(OPERATIONS_OF).flat())] as [string, ...string[]];

export const RESPONSE_FORMATS = ["text", "json_object", "json_schema"] as const;
export const SPEECH_FORMATS = ["mp3", "opus", "aac", "flac", "wav", "pcm"] as const;
export const FILE_PURPOSES = [
  "user_data",
  "assistants",
  "batch",
  "fine-tune",
  "vision",
  "evals",
] as const;
export const IMAGE_SIZES = ["auto", "1024x1024", "1536x1024", "1024x1536"] as const;
export const IMAGE_QUALITIES = ["auto", "low", "medium", "high"] as const;
export const IMAGE_FORMATS = ["png", "jpeg", "webp"] as const;
export const IMAGE_BACKGROUNDS = ["auto", "opaque", "transparent"] as const;

type Operations = { [R in Resource]?: readonly (typeof OPERATIONS_OF)[R][number][] };

/** Show a field for these operations of these resources. */
const on = (operations: Operations) => ({
  showWhen: Object.entries(operations).map(([resource, ops]) => ({
    resource: [resource],
    operation: [...(ops ?? [])],
  })),
});

/** Labels and hints for a model select. The last option is Custom. */
const modelMeta = (
  resource: Resource,
  operations: readonly string[],
  models: readonly ModelEntry[],
) => ({
  ...on({ [resource]: operations }),
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

const hasCustomModel = (key: string, resource: Resource, operation: string) => ({
  resource: [resource],
  operation: [operation],
  [key]: [CUSTOM_MODEL],
});

export const openaiConfig = z
  .object({
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
        },
        hints: {
          text: "Write text with a chat model. Images can be input",
          embedding: "Turn text into a vector of numbers",
          image: "Make images from a prompt",
          moderation: "Check text or images for harmful content",
          audio: "Turn speech into text, or text into speech",
          file: "Upload, list, or delete files of the account",
          model: "List the models that the key can use",
        },
      }),
    operation: z
      .enum(ALL_OPERATIONS)
      .default("generate")
      .meta({
        labels: {
          generate: "Generate",
          create: "Create",
          check: "Check",
          edit: "Edit",
          transcribe: "Transcribe",
          translate: "Translate",
          speak: "Speak",
          upload: "Upload",
          list: "List",
          delete: "Delete",
        },
        hints: {
          generate: "Make text or images",
          create: "Make an embedding",
          check: "Find harmful content",
          edit: "Change an image with a prompt",
          transcribe: "Turn an audio file into text",
          translate: "Turn an audio file into English text",
          speak: "Turn text into an audio file",
          upload: "Add a file to the account",
          list: "Get many items",
          delete: "Delete a file from the account",
        },
      }),
    // models
    textModel: z
      .enum(idsOf(TEXT_MODELS))
      .default("gpt-6.1-terra")
      .meta(modelMeta("text", ["generate"], TEXT_MODELS)),
    embeddingModel: z
      .enum(idsOf(EMBEDDING_MODELS))
      .default("text-embedding-3-small")
      .meta(modelMeta("embedding", ["create"], EMBEDDING_MODELS)),
    imageModel: z
      .enum(idsOf(IMAGE_MODELS))
      .default("gpt-image-2.5-flare")
      .meta(modelMeta("image", ["generate", "edit"], IMAGE_MODELS)),
    moderationModel: z
      .enum(idsOf(MODERATION_MODELS))
      .default("omni-moderation-latest")
      .meta(modelMeta("moderation", ["check"], MODERATION_MODELS)),
    audioModel: z
      .enum(idsOf(TRANSCRIPTION_MODELS))
      .default("gpt-transcribe")
      .meta(modelMeta("audio", ["transcribe"], TRANSCRIPTION_MODELS)),
    translationModel: z
      .enum(idsOf(TRANSLATION_MODELS))
      .default("whisper-1")
      .meta(modelMeta("audio", ["translate"], TRANSLATION_MODELS)),
    speechModel: z
      .enum(idsOf(SPEECH_MODELS))
      .default("gpt-4o-mini-tts")
      .meta(modelMeta("audio", ["speak"], SPEECH_MODELS)),
    customModel: z
      .string()
      .optional()
      .meta({
        showWhen: [
          hasCustomModel("textModel", "text", "generate"),
          hasCustomModel("embeddingModel", "embedding", "create"),
          hasCustomModel("imageModel", "image", "generate"),
          hasCustomModel("imageModel", "image", "edit"),
          hasCustomModel("moderationModel", "moderation", "check"),
          hasCustomModel("audioModel", "audio", "transcribe"),
          hasCustomModel("translationModel", "audio", "translate"),
          hasCustomModel("speechModel", "audio", "speak"),
        ],
        description: "A model id, such as one from the List operation or from a compatible service",
      }),
    // text
    systemPrompt: z
      .string()
      .optional()
      .meta({
        ...on({ text: ["generate"] }),
        ui: "textarea",
        description: "Rules for the model. For example its role or its tone",
      }),
    prompt: z
      .string()
      .optional()
      .meta({
        ...on({ text: ["generate"], image: ["generate", "edit"] }),
        ui: "textarea",
        description: "The message to the model, or the description of the image",
      }),
    imageUrls: z
      .string()
      .optional()
      .meta({
        ...on({ text: ["generate"], moderation: ["check"] }),
        title: "Image URLs",
        description:
          "Public image URLs with commas between, or data URLs. The model must read images",
      }),
    imageProperty: z
      .string()
      .optional()
      .meta({
        ...on({ text: ["generate"], moderation: ["check"] }),
        title: "Input Image Field",
        description: "Optional. An image is in binary.<property> of the input",
      }),
    temperature: z
      .number()
      .min(0)
      .max(2)
      .optional()
      .meta({
        ...on({ text: ["generate"] }),
        description: "Empty uses the default of the model. Some models do not accept this value",
      }),
    maxTokens: z
      .number()
      .int()
      .min(1)
      .optional()
      .meta({
        ...on({ text: ["generate"] }),
        title: "Max Output Tokens",
        description: "The most tokens in the answer. Empty means no limit from the node",
      }),
    responseFormat: z
      .enum(RESPONSE_FORMATS)
      .default("text")
      .meta({
        ...on({ text: ["generate"] }),
        labels: { text: "Text", json_object: "JSON", json_schema: "JSON Schema" },
        hints: {
          text: "Free text",
          json_object: "A valid JSON object. The prompt must say the word JSON",
          json_schema: "A JSON object that follows your schema",
        },
      }),
    jsonSchema: z
      .string()
      .optional()
      .meta({
        showWhen: { resource: ["text"], operation: ["generate"], responseFormat: ["json_schema"] },
        title: "JSON Schema",
        ui: "code",
        description: "A JSON Schema as JSON. Set additionalProperties to false on each object",
      }),
    // embedding, moderation
    input: z
      .string()
      .optional()
      .meta({
        ...on({ embedding: ["create"], moderation: ["check"], audio: ["speak"] }),
        ui: "textarea",
        description: "The text to use",
      }),
    dimensions: z
      .number()
      .int()
      .min(1)
      .optional()
      .meta({
        ...on({ embedding: ["create"] }),
        description: "A shorter vector. Only for the Embedding 3 models. Empty keeps the full size",
      }),
    // image
    size: z
      .enum(IMAGE_SIZES)
      .default("auto")
      .meta({
        ...on({ image: ["generate", "edit"] }),
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
        ...on({ image: ["generate", "edit"] }),
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
        ...on({ image: ["generate", "edit"] }),
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
        ...on({ image: ["generate", "edit"] }),
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
        ...on({ image: ["generate", "edit"] }),
        title: "Number of Images",
      }),
    // image output, transcription input
    property: z
      .string()
      .min(1)
      .default("data")
      .meta({
        ...on({
          audio: ["transcribe", "translate"],
          image: ["edit"],
          file: ["upload"],
        }),
        title: "Input Binary Field",
        description: "The file is in binary.<property> of the input. An audio file: at most 25 MB",
      }),
    outputProperty: z
      .string()
      .min(1)
      .default("data")
      .meta({
        ...on({ image: ["generate", "edit"], audio: ["speak"] }),
        title: "Output Binary Field",
        description: "The result goes to binary.<property> of the output",
      }),
    // transcription
    language: z
      .string()
      .optional()
      .meta({
        ...on({ audio: ["transcribe"] }),
        description: "Optional. The language of the audio as two letters, such as en",
      }),
    transcriptionPrompt: z
      .string()
      .optional()
      .meta({
        ...on({ audio: ["transcribe", "translate"] }),
        title: "Prompt",
        description: "Optional. Words or names that the audio has. This helps the model",
      }),
    // speech
    voice: z
      .string()
      .min(1)
      .default("alloy")
      .meta({
        ...on({ audio: ["speak"] }),
        description: "The name of a voice, such as alloy, coral, or nova",
      }),
    speechFormat: z
      .enum(SPEECH_FORMATS)
      .default("mp3")
      .meta({
        ...on({ audio: ["speak"] }),
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
        ...on({ audio: ["speak"] }),
        description: "From 0.25 to 4. Empty means normal speed",
      }),
    instructions: z
      .string()
      .optional()
      .meta({
        ...on({ audio: ["speak"] }),
        ui: "textarea",
        description: "Optional. How to speak, such as the tone or the pace",
      }),
    // files
    purpose: z
      .enum(FILE_PURPOSES)
      .default("user_data")
      .meta({
        ...on({ file: ["upload"] }),
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
    fileId: z
      .string()
      .optional()
      .meta({
        ...on({ file: ["delete"] }),
        title: "File ID",
        description: "An ID that starts with file-",
      }),
    // lists
    nameFilter: z
      .string()
      .optional()
      .meta({
        ...on({ model: ["list"] }),
        description: "Optional. Keep only the models with this text in the id",
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

export type OpenAIConfig = z.output<typeof openaiConfig>;
