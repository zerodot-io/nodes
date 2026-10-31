// SPDX-License-Identifier: AGPL-3.0-only
import { type Call, CUSTOM_MODEL, PROVIDER_LABEL } from "@zerodot/ai-core";
import { type BinaryData, isRecord, readBinary, toBinary } from "@zerodot/node-sdk";
import type { AIConfig } from "./config";

type JsonObject = Record<string, unknown>;

export type Request = {
  call: Call;
  /** A list: the node follows the pages until it has `limit` items. `null` means all. */
  list?: { itemsKey: string; limit: number | null };
};

/** Lines of a field. One value on each line, because a signed URL can have commas. */
export const lines = (text: string | undefined): string[] =>
  (text ?? "")
    .split(/\r?\n/)
    .map((item) => item.trim())
    .filter(Boolean);

const need = <T>(value: T | undefined, name: string, operation: string): T => {
  if (value === undefined || (typeof value === "string" && value.trim() === "")) {
    throw new Error(`${operation} needs "${name}"`);
  }
  return value;
};

/** The model id the user chose in the select of the provider, or undefined. */
function chosenModel(c: AIConfig): string | undefined {
  switch (c.provider) {
    case "openai":
      return {
        text: c.openaiTextModel,
        embedding: c.openaiEmbeddingModel,
        image: c.openaiImageModel,
        moderation: c.moderationModel,
        audio: (
          {
            transcribe: c.audioModel,
            translate: c.translationModel,
            speak: c.speechModel,
          } as Record<string, string>
        )[c.operation],
        file: undefined,
        model: undefined,
        conversation: undefined,
        conversationItem: undefined,
      }[c.resource];
    case "anthropic":
      return c.anthropicModel;
    case "gemini":
      return {
        text: c.geminiTextModel,
        embedding: c.geminiEmbeddingModel,
        image: c.geminiImageModel,
      }[c.resource as "text" | "embedding" | "image"];
    case "mistral":
      return { text: c.mistralTextModel, embedding: c.mistralEmbeddingModel }[
        c.resource as "text" | "embedding"
      ];
    case "groq":
      return c.groqTextModel;
    case "xai":
      return c.xaiTextModel;
    case "deepseek":
      return c.deepseekTextModel;
    case "bedrock":
      return { text: c.bedrockTextModel, embedding: c.bedrockEmbeddingModel }[
        c.resource as "text" | "embedding"
      ];
    case "vertex":
      return { text: c.vertexTextModel, embedding: c.vertexEmbeddingModel }[
        c.resource as "text" | "embedding"
      ];
    case "compatible":
    case "openrouter":
    case "ollama":
    case "azure":
      return CUSTOM_MODEL;
  }
}

/** The model id of the operation. "Custom" (and a compatible service) reads the Custom Model field. */
export function modelOf(c: AIConfig): string {
  const op = `${c.resource}.${c.operation}`;
  const chosen = chosenModel(c);
  if (!chosen) throw new Error(`${op} has no model`);
  if (chosen !== CUSTOM_MODEL) return chosen;
  return need(c.customModel, "customModel", op).trim();
}

/** A Gemini model goes in a path. It can start with "models/". */
function geminiModelPath(c: AIConfig): string {
  const id = modelOf(c).replace(/^models\//, "");
  if (!/^[A-Za-z0-9._-]{1,128}$/.test(id)) {
    throw new Error(`${c.resource}.${c.operation}: "customModel" is not a model id`);
  }
  return id;
}

/** Base64 text: no spaces, no `data:` prefix, a valid length and valid characters. */
export function base64Of(value: string, name: string): string {
  const text = value.replace(/\s+/g, "");
  if (text.startsWith("data:"))
    throw new Error(`"${name}" must be Base64 without the data: prefix`);
  if (text === "" || text.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(text)) {
    throw new Error(`"${name}" is not valid Base64`);
  }
  return text;
}

/** A media item of the prompt: a URL, or bytes. */
type Media = { url: string } | { mimeType: string; data: string };

/** The URLs, the data URLs, and the binary field of the input as media items. */
export function imagesOf(c: AIConfig, input: unknown): Media[] {
  const media: Media[] = lines(c.imageUrls).map((url): Media => {
    const found = /^data:([^;,]+);base64,(.*)$/s.exec(url);
    if (!found) return { url };
    return { mimeType: found[1] ?? "", data: base64Of(found[2] ?? "", "imageUrls") };
  });
  const property = c.imageProperty?.trim();
  if (property) {
    const file: BinaryData = readBinary(input, property);
    media.push({ mimeType: file.mimeType, data: file.data });
  }
  return media;
}

const dataUrlOf = (media: { mimeType: string; data: string }): string =>
  `data:${media.mimeType};base64,${media.data}`;

/** A JSON object from text. */
function objectOf(text: string | undefined, name: string, op: string): JsonObject {
  let value: unknown;
  try {
    value = JSON.parse(need(text, name, op));
  } catch {
    throw new Error(`"${name}" must be JSON`);
  }
  if (!isRecord(value) || Array.isArray(value)) throw new Error(`"${name}" must be a JSON object`);
  return value;
}

/** A JSON array of objects. */
export function arrayOf(text: string | undefined, name: string): JsonObject[] | undefined {
  if (!text?.trim()) return undefined;
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error(`"${name}" must be JSON`);
  }
  if (!Array.isArray(value) || !value.every((item) => isRecord(item) && !Array.isArray(item))) {
    throw new Error(`"${name}" must be a JSON array of objects`);
  }
  return value as JsonObject[];
}

const TOOL_NAME = /^[a-zA-Z0-9_-]{1,128}$/;

/** The tools. Each tool has a name and a JSON Schema object for the input. */
export function toolsOf(text: string | undefined): JsonObject[] | undefined {
  const tools = arrayOf(text, "tools");
  if (!tools) return undefined;
  if (tools.length === 0) throw new Error('"tools" has no tool');
  return tools.map((tool, index) => {
    const { name, description, input_schema: schema } = tool;
    if (typeof name !== "string" || !TOOL_NAME.test(name)) {
      throw new Error(`Tool ${index + 1}: "name" must have 1 to 128 letters, digits, "_" or "-"`);
    }
    if (description !== undefined && typeof description !== "string") {
      throw new Error(`Tool "${name}": "description" must be text`);
    }
    if (!isRecord(schema) || schema.type !== "object") {
      throw new Error(`Tool "${name}": "input_schema" must be a JSON Schema with type "object"`);
    }
    return tool;
  });
}

/** The tool name of "One Tool". */
export const toolNameOf = (c: AIConfig, op: string): string =>
  need(c.toolChoiceName, "toolChoiceName", op).trim();

/** A tool choice other than Auto needs tools. The node never drops it without a message. */
export function checkToolChoice(c: AIConfig, tools: JsonObject[] | undefined, op: string) {
  if (!tools && c.toolChoice !== "auto") {
    throw new Error(`${op}: "toolChoice" is "${c.toolChoice}" but there are no "tools"`);
  }
}

/** A JSON Schema as an object. */
export const schemaOf = (c: AIConfig, op: string): JsonObject =>
  objectOf(c.jsonSchema, "jsonSchema", op);

/** The system text, or undefined when empty. */
export const systemOf = (c: AIConfig): string | undefined => c.systemPrompt?.trim() || undefined;

/** The prompt, or undefined when empty. */
export const promptOf = (c: AIConfig): string | undefined =>
  c.prompt?.trim() ? c.prompt : undefined;

// Anthropic

/** The content of the user message: the images, then the documents, then the text. */
function anthropicContent(c: AIConfig, input: unknown, op: string): string | JsonObject[] {
  const blocks: JsonObject[] = [];
  for (const item of imagesOf(c, input)) {
    blocks.push({
      type: "image",
      source:
        "url" in item
          ? { type: "url", url: item.url }
          : { type: "base64", media_type: item.mimeType, data: item.data },
    });
  }
  for (const id of lines(c.imageFileIds)) {
    blocks.push({ type: "image", source: { type: "file", file_id: id } });
  }
  for (const url of lines(c.documentUrls)) {
    blocks.push({ type: "document", source: { type: "url", url } });
  }
  for (const id of lines(c.documentFileIds)) {
    blocks.push({ type: "document", source: { type: "file", file_id: id } });
  }
  const property = c.documentProperty?.trim();
  if (property) {
    blocks.push({
      type: "document",
      source: {
        type: "base64",
        media_type: "application/pdf",
        data: readBinary(input, property).data,
      },
    });
  }
  const prompt = promptOf(c);
  if (!prompt && blocks.length === 0) {
    throw new Error(`${op} needs "prompt", an image, or a document`);
  }
  if (blocks.length === 0) return prompt ?? "";
  if (prompt) blocks.push({ type: "text", text: prompt });
  return blocks;
}

// Gemini

/** The parts of the user turn: the media, then the text. */
function geminiParts(c: AIConfig, input: unknown, op: string): JsonObject[] {
  const parts: JsonObject[] = imagesOf(c, input).map((item) =>
    "url" in item
      ? { fileData: { fileUri: item.url } }
      : { inlineData: { mimeType: item.mimeType, data: item.data } },
  );
  for (const uri of lines(c.fileUris)) parts.push({ fileData: { fileUri: uri } });
  const prompt = promptOf(c);
  if (!prompt && parts.length === 0) throw new Error(`${op} needs "prompt" or an image`);
  if (prompt) parts.push({ text: prompt });
  return parts;
}

const geminiSystem = (c: AIConfig) => {
  const system = systemOf(c);
  return system ? { parts: [{ text: system }] } : undefined;
};

const geminiTools = (tools: JsonObject[] | undefined) =>
  tools
    ? [
        {
          functionDeclarations: tools.map((tool) => ({
            name: tool.name,
            description: tool.description,
            parametersJsonSchema: tool.input_schema,
          })),
        },
      ]
    : undefined;

// Files

/** A file ID goes in a path, so it must be an ID: letters, digits, dashes, and underscores. */
const pathIdOf = (value: string | undefined, name: string, operation: string): string => {
  const text = need(value, name, operation).trim();
  if (!/^[A-Za-z0-9_-]{4,128}$/.test(text)) {
    throw new Error(`${operation}: "${name}" is not ${name === "fileId" ? "a file ID" : "an ID"}`);
  }
  return text;
};

/** A Gemini file name is `files/<id>`. The user can give the id or the whole name. */
const geminiFileId = (value: string | undefined, operation: string): string =>
  pathIdOf(
    need(value, "fileId", operation)
      .trim()
      .replace(/^files\//, ""),
    "fileId",
    operation,
  );

/** The file of a binary field of the input, as a Blob and a name. */
function fileOf(c: AIConfig, input: unknown) {
  const file = readBinary(input, c.property);
  return {
    bytes: new Uint8Array(Buffer.from(file.data, "base64")),
    mimeType: file.mimeType,
    name: file.fileName ?? "file",
  };
}

const blobOf = (c: AIConfig, input: unknown): { blob: Blob; name: string } => {
  const file = fileOf(c, input);
  return { blob: new Blob([file.bytes], { type: file.mimeType }), name: file.name };
};

/** A JSON value from text. */
function jsonOf(text: string | undefined, name: string): unknown {
  try {
    return JSON.parse(need(text, name, "conversation"));
  } catch {
    throw new Error(`"${name}" must be JSON`);
  }
}

/** A JSON object of text values, or undefined when the field is empty. */
function metadataOf(text: string | undefined): Record<string, string> | undefined {
  if (!text?.trim()) return undefined;
  const value = jsonOf(text, "metadata");
  if (!isRecord(value) || Array.isArray(value)) throw new Error('"metadata" must be a JSON object');
  for (const entry of Object.values(value)) {
    if (typeof entry !== "string") throw new Error('The values of "metadata" must be text');
  }
  return value as Record<string, string>;
}

/** A JSON array of at most 20 items, or undefined when the field is empty. */
function itemsOf(text: string | undefined): unknown[] | undefined {
  if (!text?.trim()) return undefined;
  const value = jsonOf(text, "conversationItems");
  if (!Array.isArray(value)) throw new Error('"conversationItems" must be a JSON array');
  if (value.length > 20) throw new Error('"conversationItems" can have at most 20 items');
  return value;
}

/** How many items a list gives. A list of OpenAI files has no pages, so it gives all. */
const limitOf = (c: AIConfig): number | null =>
  (c.resource === "file" && c.provider === "openai") || c.returnAll ? null : c.limit;

/** The call for one operation, without the network. */
export function buildRequest(c: AIConfig, input: unknown): Request {
  const op = `${c.resource}.${c.operation}`;
  const { provider } = c;

  switch (op) {
    case "text.countTokens": {
      const tools = toolsOf(c.tools);
      if (provider === "anthropic") {
        return {
          call: {
            method: "POST",
            path: "/v1/messages/count_tokens",
            json: {
              model: modelOf(c),
              system: systemOf(c),
              messages: [{ role: "user", content: anthropicContent(c, input, op) }],
              tools,
            },
          },
        };
      }
      const id = geminiModelPath(c);
      return {
        call: {
          method: "POST",
          path: `/models/${id}:countTokens`,
          json: {
            generateContentRequest: {
              model: `models/${id}`,
              systemInstruction: geminiSystem(c),
              contents: [{ role: "user", parts: geminiParts(c, input, op) }],
              tools: geminiTools(tools),
            },
          },
        },
      };
    }
    case "image.edit":
    case "image.generate": {
      if (provider === "gemini") {
        const parts: JsonObject[] = [{ text: need(c.prompt, "prompt", op) }];
        if (c.operation === "edit") {
          const file = readBinary(input, c.property);
          parts.unshift({ inlineData: { mimeType: file.mimeType, data: file.data } });
        }
        const imageConfig = {
          ...(c.aspectRatio === "auto" ? {} : { aspectRatio: c.aspectRatio }),
          ...(c.imageSize === "auto" ? {} : { imageSize: c.imageSize }),
        };
        return {
          call: {
            method: "POST",
            path: `/models/${geminiModelPath(c)}:generateContent`,
            json: {
              contents: [{ role: "user", parts }],
              generationConfig: {
                responseModalities: ["IMAGE"],
                ...(Object.keys(imageConfig).length > 0 ? { imageConfig } : {}),
              },
            },
          },
        };
      }
      if (c.operation === "edit") {
        const file = blobOf(c, input);
        const form = new FormData();
        form.append("image", file.blob, file.name);
        form.append("model", modelOf(c));
        form.append("prompt", need(c.prompt, "prompt", op));
        form.append("n", String(c.count));
        form.append("output_format", c.outputFormat);
        if (c.size !== "auto") form.append("size", c.size);
        if (c.quality !== "auto") form.append("quality", c.quality);
        if (c.background !== "auto") form.append("background", c.background);
        return { call: { method: "POST", path: "/images/edits", form } };
      }
      return {
        call: {
          method: "POST",
          path: "/images/generations",
          json: {
            model: modelOf(c),
            prompt: need(c.prompt, "prompt", op),
            n: c.count,
            size: c.size === "auto" ? undefined : c.size,
            quality: c.quality === "auto" ? undefined : c.quality,
            background: c.background === "auto" ? undefined : c.background,
            output_format: c.outputFormat,
          },
        },
      };
    }
    case "moderation.check": {
      const text = c.input?.trim();
      const images = imagesOf(c, input);
      if (!text && images.length === 0) throw new Error(`${op} needs "input" or an image`);
      return {
        call: {
          method: "POST",
          path: "/moderations",
          json: {
            model: modelOf(c),
            // Images need the list form. Plain text can stay a string.
            input:
              images.length === 0
                ? text
                : [
                    ...(text ? [{ type: "text", text }] : []),
                    ...images.map((item) => ({
                      type: "image_url",
                      image_url: { url: "url" in item ? item.url : dataUrlOf(item) },
                    })),
                  ],
          },
        },
      };
    }
    case "audio.transcribe":
    case "audio.translate": {
      const file = blobOf(c, input);
      const form = new FormData();
      form.append("file", file.blob, file.name);
      form.append("model", modelOf(c));
      // Only a transcription takes a language. A translation always gives English.
      if (c.operation === "transcribe" && c.language?.trim()) {
        form.append("language", c.language.trim());
      }
      if (c.transcriptionPrompt?.trim()) form.append("prompt", c.transcriptionPrompt.trim());
      const path = c.operation === "transcribe" ? "/audio/transcriptions" : "/audio/translations";
      return { call: { method: "POST", path, form } };
    }
    case "audio.speak":
      return {
        call: {
          method: "POST",
          path: "/audio/speech",
          json: {
            model: modelOf(c),
            input: need(c.input, "input", op),
            voice: c.voice,
            response_format: c.speechFormat,
            speed: c.speed,
            instructions: c.instructions?.trim() || undefined,
          },
          binary: true,
        },
      };
    case "file.upload": {
      if (provider === "gemini") {
        const file = fileOf(c, input);
        if (file.bytes.length === 0) throw new Error(`${op}: the file is empty`);
        return {
          call: {
            method: "POST",
            path: "/files",
            upload: { data: file.bytes, mimeType: file.mimeType, displayName: file.name },
          },
        };
      }
      const file = blobOf(c, input);
      const form = new FormData();
      form.append("file", file.blob, file.name);
      if (provider === "openai") form.append("purpose", c.purpose);
      if (provider === "anthropic" && c.expiresInSeconds !== undefined) {
        form.append("expires_in_seconds", String(c.expiresInSeconds));
      }
      return {
        call: { method: "POST", path: provider === "anthropic" ? "/v1/files" : "/files", form },
      };
    }
    case "file.get":
      return {
        call: {
          method: "GET",
          path:
            provider === "gemini"
              ? `/files/${geminiFileId(c.fileId, op)}`
              : `/v1/files/${pathIdOf(c.fileId, "fileId", op)}`,
        },
      };
    case "file.delete": {
      const path =
        provider === "gemini"
          ? `/files/${geminiFileId(c.fileId, op)}`
          : `${provider === "anthropic" ? "/v1" : ""}/files/${pathIdOf(c.fileId, "fileId", op)}`;
      return { call: { method: "DELETE", path } };
    }
    case "file.list": {
      const path = provider === "anthropic" ? "/v1/files" : "/files";
      const itemsKey = provider === "gemini" ? "files" : "data";
      return { call: { method: "GET", path }, list: { itemsKey, limit: limitOf(c) } };
    }
    case "model.list": {
      const path = provider === "anthropic" ? "/v1/models" : "/models";
      const itemsKey = provider === "gemini" ? "models" : "data";
      // A filter works on the whole list, so the node reads all pages first.
      return {
        call: { method: "GET", path },
        list: { itemsKey, limit: c.nameFilter?.trim() ? null : limitOf(c) },
      };
    }
    case "conversation.create":
      return {
        call: {
          method: "POST",
          path: "/conversations",
          json: { metadata: metadataOf(c.metadata), items: itemsOf(c.conversationItems) },
        },
      };
    case "conversation.get":
      return {
        call: {
          method: "GET",
          path: `/conversations/${pathIdOf(c.conversationId, "conversationId", op)}`,
        },
      };
    case "conversation.update":
      return {
        call: {
          method: "POST",
          path: `/conversations/${pathIdOf(c.conversationId, "conversationId", op)}`,
          json: { metadata: need(metadataOf(c.metadata), "metadata", op) },
        },
      };
    case "conversation.delete":
      return {
        call: {
          method: "DELETE",
          path: `/conversations/${pathIdOf(c.conversationId, "conversationId", op)}`,
        },
      };
    case "conversationItem.add":
      return {
        call: {
          method: "POST",
          path: `/conversations/${pathIdOf(c.conversationId, "conversationId", op)}/items`,
          json: { items: need(itemsOf(c.conversationItems), "conversationItems", op) },
        },
      };
    case "conversationItem.list": {
      const query = new URLSearchParams({ limit: String(c.itemLimit), order: c.itemOrder });
      if (c.itemAfter?.trim()) query.set("after", c.itemAfter.trim());
      return {
        call: {
          method: "GET",
          path: `/conversations/${pathIdOf(c.conversationId, "conversationId", op)}/items?${query}`,
        },
      };
    }
    case "conversationItem.get":
    case "conversationItem.delete":
      return {
        call: {
          method: c.operation === "get" ? "GET" : "DELETE",
          path: `/conversations/${pathIdOf(c.conversationId, "conversationId", op)}/items/${pathIdOf(c.itemId, "itemId", op)}`,
        },
      };
  }
  throw new Error(`${PROVIDER_LABEL[provider]} has no operation "${op}"`);
}

// Results

const num = (value: unknown): number | undefined => (typeof value === "number" ? value : undefined);
const str = (value: unknown): string | undefined => (typeof value === "string" ? value : undefined);
const rec = (value: unknown): JsonObject => (isRecord(value) && !Array.isArray(value) ? value : {});
const arr = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

/** A JSON value from text, or undefined when it is not JSON. */
export const parseJson = (text: string): unknown => {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
};

const EXTENSION: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

/** The images of a Gemini answer as binary fields. */
function geminiImages(c: AIConfig, answer: JsonObject): unknown {
  const candidate = rec(arr(answer.candidates)[0]);
  const images = arr(rec(candidate.content).parts)
    .map((part) => rec(rec(part).inlineData))
    .filter((data) => typeof data.data === "string");
  const binary: Record<string, BinaryData> = {};
  images.forEach((data, index) => {
    const mimeType = str(data.mimeType) ?? "image/png";
    const name = images.length === 1 ? c.outputProperty : `${c.outputProperty}_${index + 1}`;
    binary[name] = toBinary(
      Buffer.from(String(data.data), "base64"),
      `image-${index + 1}.${EXTENSION[mimeType] ?? mimeType.split("/")[1] ?? "bin"}`,
      mimeType,
    );
  });
  if (images.length === 0) {
    const reason = str(candidate.finishReason);
    throw new Error(`Gemini gave no image${reason ? `. Finish reason ${reason}` : ""}`);
  }
  return { binary, count: images.length, usage: answer.usageMetadata };
}

/** The output of the node for the answer of the provider, without the network. */
export function resultOf(c: AIConfig, answer: JsonObject): unknown {
  const op = `${c.resource}.${c.operation}`;

  switch (op) {
    case "text.countTokens":
      return {
        inputTokens:
          c.provider === "anthropic" ? num(answer.input_tokens) : num(answer.totalTokens),
        ...(c.includeRaw ? { raw: answer } : {}),
      };
    case "image.edit":
    case "image.generate": {
      if (c.provider === "gemini") return geminiImages(c, answer);
      const data = arr(answer.data);
      const binary: Record<string, BinaryData> = {};
      const revisedPrompts: string[] = [];
      data.forEach((entry, index) => {
        if (!isRecord(entry) || typeof entry.b64_json !== "string") return;
        const name = data.length === 1 ? c.outputProperty : `${c.outputProperty}_${index + 1}`;
        binary[name] = toBinary(
          Buffer.from(entry.b64_json, "base64"),
          `image-${index + 1}.${c.outputFormat === "jpeg" ? "jpg" : c.outputFormat}`,
          `image/${c.outputFormat}`,
        );
        if (typeof entry.revised_prompt === "string") revisedPrompts.push(entry.revised_prompt);
      });
      if (Object.keys(binary).length === 0) throw new Error("OpenAI gave no image");
      return { binary, count: Object.keys(binary).length, revisedPrompts, usage: answer.usage };
    }
    case "moderation.check": {
      const first = rec(arr(answer.results)[0]);
      const categories = rec(first.categories);
      return {
        flagged: first.flagged === true,
        flaggedCategories: Object.keys(categories).filter((key) => categories[key] === true),
        categories: first.categories,
        categoryScores: first.category_scores,
        model: answer.model,
        id: answer.id,
      };
    }
    case "audio.speak": {
      const mimeType = String(answer.mimeType).split(";")[0] ?? "audio/mpeg";
      return {
        binary: {
          [c.outputProperty]: {
            data: String(answer.data),
            mimeType,
            fileName: `speech.${c.speechFormat}`,
          },
        },
      };
    }
    case "file.upload":
      // The upload of Gemini wraps the file.
      return c.provider === "gemini" ? (answer.file ?? answer) : answer;
    case "file.delete":
      return c.provider === "gemini"
        ? { deleted: true, name: `files/${geminiFileId(c.fileId, op)}` }
        : answer;
    case "file.list":
    case "model.list": {
      const filter = c.nameFilter?.trim().toLowerCase();
      const items = arr(answer.data).filter((entry) => {
        if (c.resource !== "model" || !filter) return true;
        const item = rec(entry);
        return `${String(item.id ?? "")} ${String(item.name ?? "")}`.toLowerCase().includes(filter);
      });
      const limit = limitOf(c);
      return limit === null ? items : items.slice(0, limit);
    }
    case "conversationItem.list":
      return {
        items: arr(answer.data),
        hasMore: answer.has_more === true,
        lastId: str(answer.last_id),
      };
    case "audio.transcribe":
    case "audio.translate":
    case "file.get":
    case "conversation.create":
    case "conversation.get":
    case "conversation.update":
    case "conversation.delete":
    case "conversationItem.add":
    case "conversationItem.get":
    case "conversationItem.delete":
      return answer;
  }
  throw new Error(`${PROVIDER_LABEL[c.provider]} has no operation "${op}"`);
}
