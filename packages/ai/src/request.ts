// SPDX-License-Identifier: AGPL-3.0-only
import { type BinaryData, isRecord, readBinary, toBinary } from "@zerodot/node-sdk";
import { type Call, PROVIDER_LABEL } from "./api";
import type { AIConfig } from "./config";
import { CUSTOM_MODEL } from "./models";

type JsonObject = Record<string, unknown>;

export type Request = {
  call: Call;
  /** A list: the node follows the pages until it has `limit` items. `null` means all. */
  list?: { itemsKey: string; limit: number | null };
};

/** Lines of a field. One value on each line, because a signed URL can have commas. */
const lines = (text: string | undefined): string[] =>
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
    case "compatible":
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
function imagesOf(c: AIConfig, input: unknown): Media[] {
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
function arrayOf(text: string | undefined, name: string): JsonObject[] | undefined {
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
function toolsOf(text: string | undefined): JsonObject[] | undefined {
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
const toolNameOf = (c: AIConfig, op: string): string =>
  need(c.toolChoiceName, "toolChoiceName", op).trim();

/** A tool choice other than Auto needs tools. The node never drops it without a message. */
function checkToolChoice(c: AIConfig, tools: JsonObject[] | undefined, op: string) {
  if (!tools && c.toolChoice !== "auto") {
    throw new Error(`${op}: "toolChoice" is "${c.toolChoice}" but there are no "tools"`);
  }
}

/** The tool choice of Anthropic. */
function anthropicToolChoice(c: AIConfig, tools: JsonObject[] | undefined, op: string) {
  if (!tools) return undefined;
  const parallel = c.disableParallelToolUse ? { disable_parallel_tool_use: true } : {};
  if (c.toolChoice === "tool") return { type: "tool", name: toolNameOf(c, op), ...parallel };
  if (c.toolChoice === "none") return { type: "none" };
  if (c.toolChoice === "auto" && Object.keys(parallel).length === 0) return undefined;
  return { type: c.toolChoice, ...parallel };
}

/** A JSON Schema as an object. */
const schemaOf = (c: AIConfig, op: string): JsonObject => objectOf(c.jsonSchema, "jsonSchema", op);

/** The system text, or undefined when empty. */
const systemOf = (c: AIConfig): string | undefined => c.systemPrompt?.trim() || undefined;

/** The prompt, or undefined when empty. */
const promptOf = (c: AIConfig): string | undefined => (c.prompt?.trim() ? c.prompt : undefined);

// OpenAI and compatible services

function openaiText(c: AIConfig, input: unknown, op: string): Call {
  const images = imagesOf(c, input);
  const prompt = promptOf(c);
  if (!prompt && images.length === 0) throw new Error(`${op} needs "prompt" or an image`);
  const system = systemOf(c);
  const tools = toolsOf(c.tools);
  checkToolChoice(c, tools, op);
  const toolChoice =
    c.toolChoice === "any"
      ? "required"
      : c.toolChoice === "tool"
        ? { type: "function", function: { name: toolNameOf(c, op) } }
        : c.toolChoice === "none"
          ? "none"
          : undefined;
  let responseFormat: JsonObject | undefined;
  if (c.responseFormat === "json_object") responseFormat = { type: "json_object" };
  if (c.responseFormat === "json_schema") {
    responseFormat = {
      type: "json_schema",
      json_schema: { name: "output", strict: true, schema: schemaOf(c, op) },
    };
  }
  const textPart = prompt ? [{ type: "text", text: prompt }] : [];
  return {
    method: "POST",
    path: "/chat/completions",
    json: {
      model: modelOf(c),
      messages: [
        ...(system ? [{ role: "system", content: system }] : []),
        {
          role: "user",
          // A message with images has a list of parts. A message without images is text.
          content:
            images.length === 0
              ? prompt
              : [
                  ...textPart,
                  ...images.map((item) => ({
                    type: "image_url",
                    image_url: { url: "url" in item ? item.url : dataUrlOf(item) },
                  })),
                ],
        },
      ],
      temperature: c.temperature,
      // Most compatible services know only the older name.
      [c.provider === "compatible" ? "max_tokens" : "max_completion_tokens"]: c.maxTokens,
      response_format: responseFormat,
      tools: tools?.map((tool) => ({
        type: "function",
        function: {
          name: tool.name,
          description: tool.description,
          parameters: tool.input_schema,
        },
      })),
      tool_choice: tools ? toolChoice : undefined,
      parallel_tool_calls: tools && c.disableParallelToolUse ? false : undefined,
    },
  };
}

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

/** The messages. After a tool call: the user turn, the answer of Claude, and the tool results. */
function anthropicMessages(c: AIConfig, input: unknown, op: string): JsonObject[] {
  const messages: JsonObject[] = [{ role: "user", content: anthropicContent(c, input, op) }];
  const results = arrayOf(c.toolResults, "toolResults");
  if (!results) return messages;
  const assistant = arrayOf(c.assistantContent, "assistantContent");
  if (!assistant) throw new Error(`${op} needs "assistantContent" with "toolResults"`);
  const blocks = results.map((result, index) => {
    const id = result.tool_use_id;
    if (typeof id !== "string" || id === "") {
      throw new Error(`Tool result ${index + 1}: "tool_use_id" is missing`);
    }
    const content = result.content ?? "";
    return {
      type: "tool_result",
      tool_use_id: id,
      content:
        typeof content === "string" || Array.isArray(content) ? content : JSON.stringify(content),
      ...(result.is_error === true ? { is_error: true } : {}),
    };
  });
  if (blocks.length === 0) throw new Error('"toolResults" has no item');
  messages.push({ role: "assistant", content: assistant }, { role: "user", content: blocks });
  return messages;
}

/** The output settings: the effort, and the format when there is a schema. */
function anthropicOutputConfig(c: AIConfig, op: string): JsonObject | undefined {
  if (c.responseFormat === "json_object") {
    throw new Error(`${op}: Anthropic has no JSON mode. Use JSON Schema`);
  }
  const config = {
    ...(c.effort === "default" ? {} : { effort: c.effort }),
    ...(c.responseFormat === "json_schema"
      ? { format: { type: "json_schema", schema: schemaOf(c, op) } }
      : {}),
  };
  return Object.keys(config).length > 0 ? config : undefined;
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

function geminiToolConfig(c: AIConfig, tools: JsonObject[] | undefined, op: string) {
  if (!tools || c.toolChoice === "auto") return undefined;
  if (c.toolChoice === "none") return { functionCallingConfig: { mode: "NONE" } };
  if (c.toolChoice === "tool") {
    return {
      functionCallingConfig: { mode: "ANY", allowedFunctionNames: [toolNameOf(c, op)] },
    };
  }
  return { functionCallingConfig: { mode: "ANY" } };
}

function geminiGenerationConfig(c: AIConfig, op: string): JsonObject | undefined {
  const config: JsonObject = {};
  if (c.maxTokens !== undefined) config.maxOutputTokens = c.maxTokens;
  if (c.temperature !== undefined) config.temperature = c.temperature;
  if (c.responseFormat !== "text") config.responseMimeType = "application/json";
  if (c.responseFormat === "json_schema") config.responseJsonSchema = schemaOf(c, op);
  return Object.keys(config).length > 0 ? config : undefined;
}

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
    case "text.generate": {
      if (provider === "openai" || provider === "compatible") {
        return { call: openaiText(c, input, op) };
      }
      const tools = toolsOf(c.tools);
      checkToolChoice(c, tools, op);
      if (provider === "anthropic") {
        return {
          call: {
            method: "POST",
            path: "/v1/messages",
            json: {
              model: modelOf(c),
              max_tokens: c.maxTokens ?? 1024,
              system: systemOf(c),
              messages: anthropicMessages(c, input, op),
              tools,
              tool_choice: anthropicToolChoice(c, tools, op),
              output_config: anthropicOutputConfig(c, op),
            },
          },
        };
      }
      return {
        call: {
          method: "POST",
          path: `/models/${geminiModelPath(c)}:generateContent`,
          json: {
            systemInstruction: geminiSystem(c),
            contents: [{ role: "user", parts: geminiParts(c, input, op) }],
            tools: geminiTools(tools),
            toolConfig: geminiToolConfig(c, tools, op),
            generationConfig: geminiGenerationConfig(c, op),
          },
        },
      };
    }
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
    case "embedding.create": {
      const text = need(c.input, "input", op);
      if (provider === "gemini") {
        return {
          call: {
            method: "POST",
            path: `/models/${geminiModelPath(c)}:embedContent`,
            json: {
              content: { parts: [{ text }] },
              embedContentConfig:
                c.dimensions === undefined ? undefined : { outputDimensionality: c.dimensions },
            },
          },
        };
      }
      return {
        call: {
          method: "POST",
          path: "/embeddings",
          json: { model: modelOf(c), input: text, dimensions: c.dimensions },
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
const parseJson = (text: string): unknown => {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
};

export type FinishReason = "stop" | "length" | "tool_calls" | "content_filter" | "other";
export type ToolCall = { id: string; name: string; input: unknown };
export type Usage = {
  inputTokens: number | undefined;
  outputTokens: number | undefined;
  totalTokens: number | undefined;
};

/** The same answer shape for each provider. */
type Normalized = {
  text: string;
  toolCalls: ToolCall[];
  finishReason: FinishReason;
  /** The finish reason as the provider wrote it. */
  stopReason: string | undefined;
  usage: Usage;
  model: string | undefined;
  id: string | undefined;
  refusal?: string;
  /** Anthropic only: the `content` of the answer, to continue after a tool call. */
  assistantContent?: unknown[];
};

const sumTokens = (input: number | undefined, output: number | undefined) =>
  input === undefined && output === undefined ? undefined : (input ?? 0) + (output ?? 0);

function normalizeOpenAI(answer: JsonObject): Normalized {
  const choice = rec(arr(answer.choices)[0]);
  const message = rec(choice.message);
  const stopReason = str(choice.finish_reason);
  const usage = rec(answer.usage);
  const reasons: Record<string, FinishReason> = {
    stop: "stop",
    length: "length",
    tool_calls: "tool_calls",
    function_call: "tool_calls",
    content_filter: "content_filter",
  };
  return {
    text: str(message.content) ?? "",
    toolCalls: arr(message.tool_calls).map((entry) => {
      const call = rec(entry);
      const fn = rec(call.function);
      const args = str(fn.arguments) ?? "";
      return {
        id: str(call.id) ?? "",
        name: str(fn.name) ?? "",
        input: args === "" ? {} : (parseJson(args) ?? args),
      };
    }),
    finishReason: (stopReason && reasons[stopReason]) || "other",
    stopReason,
    usage: {
      inputTokens: num(usage.prompt_tokens),
      outputTokens: num(usage.completion_tokens),
      totalTokens: num(usage.total_tokens),
    },
    model: str(answer.model),
    id: str(answer.id),
    refusal: str(message.refusal),
  };
}

function normalizeAnthropic(answer: JsonObject): Normalized {
  const content = arr(answer.content);
  const blocks = content.map(rec);
  const stopReason = str(answer.stop_reason);
  const usage = rec(answer.usage);
  const reasons: Record<string, FinishReason> = {
    end_turn: "stop",
    stop_sequence: "stop",
    max_tokens: "length",
    tool_use: "tool_calls",
    refusal: "content_filter",
  };
  const inputTokens = num(usage.input_tokens);
  const outputTokens = num(usage.output_tokens);
  return {
    text: blocks.map((block) => (block.type === "text" ? (str(block.text) ?? "") : "")).join(""),
    toolCalls: blocks
      .filter((block) => block.type === "tool_use")
      .map((block) => ({
        id: str(block.id) ?? "",
        name: str(block.name) ?? "",
        input: block.input ?? {},
      })),
    finishReason: (stopReason && reasons[stopReason]) || "other",
    stopReason,
    usage: { inputTokens, outputTokens, totalTokens: sumTokens(inputTokens, outputTokens) },
    model: str(answer.model),
    id: str(answer.id),
    assistantContent: content,
  };
}

const GEMINI_FILTERED = new Set([
  "SAFETY",
  "RECITATION",
  "BLOCKLIST",
  "PROHIBITED_CONTENT",
  "SPII",
  "IMAGE_SAFETY",
  "IMAGE_PROHIBITED_CONTENT",
  "IMAGE_RECITATION",
]);

function normalizeGemini(answer: JsonObject): Normalized {
  const candidate = rec(arr(answer.candidates)[0]);
  const parts = arr(rec(candidate.content).parts).map(rec);
  const blocked = str(rec(answer.promptFeedback).blockReason);
  const stopReason = str(candidate.finishReason) ?? blocked;
  const toolCalls = parts
    .filter((part) => isRecord(part.functionCall))
    .map((part, index) => {
      const call = rec(part.functionCall);
      return {
        id: str(call.id) ?? `call_${index + 1}`,
        name: str(call.name) ?? "",
        input: call.args ?? {},
      };
    });
  const usage = rec(answer.usageMetadata);
  const inputTokens = num(usage.promptTokenCount);
  // Thinking tokens are output tokens that the answer does not show.
  const outputTokens = sumTokens(num(usage.candidatesTokenCount), num(usage.thoughtsTokenCount));
  let finishReason: FinishReason = "other";
  if (toolCalls.length > 0) finishReason = "tool_calls";
  else if (stopReason === "STOP") finishReason = "stop";
  else if (stopReason === "MAX_TOKENS") finishReason = "length";
  else if (stopReason && (GEMINI_FILTERED.has(stopReason) || blocked))
    finishReason = "content_filter";
  return {
    text: parts
      .filter((part) => part.thought !== true)
      .map((part) => str(part.text) ?? "")
      .join(""),
    toolCalls,
    finishReason,
    stopReason,
    usage: { inputTokens, outputTokens, totalTokens: num(usage.totalTokenCount) },
    model: str(answer.modelVersion),
    id: str(answer.responseId),
  };
}

/** The output of text.generate. The tool calls come before the JSON, because a tool call has no JSON text. */
function textResult(c: AIConfig, answer: JsonObject): unknown {
  const normalized =
    c.provider === "anthropic"
      ? normalizeAnthropic(answer)
      : c.provider === "gemini"
        ? normalizeGemini(answer)
        : normalizeOpenAI(answer);
  let json: unknown;
  if (c.responseFormat !== "text" && normalized.toolCalls.length === 0 && normalized.text.trim()) {
    json = parseJson(normalized.text);
    // A cut answer is not complete JSON. Every other answer must be.
    if (json === undefined && normalized.finishReason !== "length") {
      throw new Error(`${PROVIDER_LABEL[c.provider]} text.generate: the answer is not valid JSON`);
    }
  }
  return {
    text: normalized.text,
    ...(json === undefined ? {} : { json }),
    toolCalls: normalized.toolCalls,
    finishReason: normalized.finishReason,
    stopReason: normalized.stopReason,
    usage: normalized.usage,
    model: normalized.model,
    id: normalized.id,
    ...(normalized.refusal ? { refusal: normalized.refusal } : {}),
    ...(normalized.assistantContent ? { assistantContent: normalized.assistantContent } : {}),
    ...(c.includeRaw ? { raw: answer } : {}),
  };
}

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
    case "text.generate":
      return textResult(c, answer);
    case "text.countTokens":
      return {
        inputTokens:
          c.provider === "anthropic" ? num(answer.input_tokens) : num(answer.totalTokens),
        ...(c.includeRaw ? { raw: answer } : {}),
      };
    case "embedding.create": {
      if (c.provider === "gemini") {
        const values = rec(answer.embedding).values;
        return {
          embedding: values,
          dimensions: arr(values).length,
          model: modelOf(c).replace(/^models\//, ""),
          usage: answer.usageMetadata,
        };
      }
      const first = rec(arr(answer.data)[0]);
      return {
        embedding: first.embedding,
        dimensions: arr(first.embedding).length,
        model: answer.model,
        usage: answer.usage,
      };
    }
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
