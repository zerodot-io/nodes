// SPDX-License-Identifier: AGPL-3.0-only
import type { Call } from "./api";
import { type AnthropicConfig, CUSTOM_MODEL } from "./config";

export type AnthropicRequest = {
  call: Call;
  /** A list: the node follows the pages. */
  list?: boolean;
  /** The answer has JSON text that fits a schema. */
  json?: boolean;
};

const list = (text: string | undefined): string[] =>
  (text ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

const need = <T>(value: T | undefined, name: string, operation: string): T => {
  if (value === undefined || (typeof value === "string" && value.trim() === "")) {
    throw new Error(`Anthropic ${operation} needs "${name}"`);
  }
  return value;
};

/** The model ID: the choice, or the custom ID. */
export function modelOf(c: AnthropicConfig, operation: string): string {
  return c.model === CUSTOM_MODEL ? need(c.customModel, "customModel", operation).trim() : c.model;
}

/** A JSON Schema as an object. */
function schemaOf(text: string | undefined): Record<string, unknown> | undefined {
  if (!text?.trim()) return undefined;
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error('"jsonSchema" must be JSON');
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error('"jsonSchema" must be a JSON object');
  }
  return value as Record<string, unknown>;
}

/** A file ID goes in a path, so it must be an ID: letters, digits, "_" and "-" only. */
const fileIdOf = (value: string | undefined, operation: string): string => {
  const text = need(value, "fileId", operation).trim();
  if (!/^[A-Za-z0-9_-]{5,128}$/.test(text)) {
    throw new Error(`Anthropic ${operation}: "fileId" is not a file ID`);
  }
  return text;
};

/** The content of the user message: the images, then the documents, then the text. */
function contentOf(c: AnthropicConfig, operation: string): string | Record<string, unknown>[] {
  const blocks: Record<string, unknown>[] = [
    ...list(c.imageUrls).map((url) => ({ type: "image", source: { type: "url", url } })),
    ...list(c.imageFileIds).map((id) => ({
      type: "image",
      source: { type: "file", file_id: id },
    })),
  ];
  const image = c.imageBase64?.trim();
  if (image) {
    blocks.push({
      type: "image",
      source: { type: "base64", media_type: c.imageMediaType, data: image },
    });
  }
  for (const url of list(c.documentUrls)) {
    blocks.push({ type: "document", source: { type: "url", url } });
  }
  for (const id of list(c.documentFileIds)) {
    blocks.push({ type: "document", source: { type: "file", file_id: id } });
  }
  const document = c.documentBase64?.trim();
  if (document) {
    blocks.push({
      type: "document",
      source: { type: "base64", media_type: "application/pdf", data: document },
    });
  }
  const prompt = c.prompt?.trim() ? c.prompt : undefined;
  if (!prompt && blocks.length === 0) {
    throw new Error(`Anthropic ${operation} needs "prompt", an image, or a document`);
  }
  if (blocks.length === 0) return prompt ?? "";
  if (prompt) blocks.push({ type: "text", text: prompt });
  return blocks;
}

/** The form of a file upload. Anthropic wants the file in the "file" part. */
function uploadForm(c: AnthropicConfig, operation: string): FormData {
  const data = Buffer.from(need(c.fileBase64, "fileBase64", operation).trim(), "base64");
  if (data.length === 0) throw new Error(`Anthropic ${operation}: "fileBase64" is not Base64`);
  const name = need(c.fileName, "fileName", operation).trim();
  const type = c.fileMimeType?.trim();
  const form = new FormData();
  form.set("file", new Blob([data], type ? { type } : {}), name);
  if (c.expiresInSeconds !== undefined) {
    form.set("expires_in_seconds", String(c.expiresInSeconds));
  }
  return form;
}

/** The output settings: the effort, and the format when there is a schema. */
function outputConfigOf(
  c: AnthropicConfig,
  schema: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  const config = {
    ...(c.effort === "default" ? {} : { effort: c.effort }),
    ...(schema ? { format: { type: "json_schema", schema } } : {}),
  };
  return Object.keys(config).length > 0 ? config : undefined;
}

/** The Anthropic call for one operation, without the network. */
export function buildRequest(c: AnthropicConfig): AnthropicRequest {
  const op = `${c.resource}.${c.operation}`;

  switch (op) {
    case "message.create": {
      const schema = schemaOf(c.jsonSchema);
      return {
        call: {
          method: "POST",
          path: "/v1/messages",
          body: {
            model: modelOf(c, op),
            max_tokens: c.maxTokens,
            system: c.system?.trim() ? c.system : undefined,
            messages: [{ role: "user", content: contentOf(c, op) }],
            output_config: outputConfigOf(c, schema),
          },
        },
        json: schema !== undefined,
      };
    }
    case "message.countTokens":
      return {
        call: {
          method: "POST",
          path: "/v1/messages/count_tokens",
          body: {
            model: modelOf(c, op),
            system: c.system?.trim() ? c.system : undefined,
            messages: [{ role: "user", content: contentOf(c, op) }],
          },
        },
      };
    case "file.upload":
      return { call: { method: "POST", path: "/v1/files", form: uploadForm(c, op) } };
    case "file.get":
      return { call: { method: "GET", path: `/v1/files/${fileIdOf(c.fileId, op)}` } };
    case "file.delete":
      return { call: { method: "DELETE", path: `/v1/files/${fileIdOf(c.fileId, op)}` } };
    case "file.list":
      return { call: { method: "GET", path: "/v1/files" }, list: true };
    case "model.list":
      return { call: { method: "GET", path: "/v1/models" }, list: true };
  }
  throw new Error(`Unknown Anthropic operation "${op}"`);
}
