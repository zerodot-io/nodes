// SPDX-License-Identifier: AGPL-3.0-only
import { type BinaryData, isRecord, readBinary, toBinary } from "@zerodot/node-sdk";
import type { Call } from "./api";
import type { OpenAIConfig } from "./config";
import { CUSTOM_MODEL } from "./models";

const list = (text: string | undefined): string[] =>
  (text ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

const need = <T>(value: T | undefined, name: string, operation: string): T => {
  if (value === undefined || (typeof value === "string" && value.trim() === "")) {
    throw new Error(`OpenAI ${operation} needs "${name}"`);
  }
  return value;
};

/** The model id of the operation. "Custom" reads the Custom Model field. */
export function modelOf(c: OpenAIConfig): string | undefined {
  const chosen = {
    text: c.textModel,
    embedding: c.embeddingModel,
    image: c.imageModel,
    moderation: c.moderationModel,
    audio: { transcribe: c.audioModel, translate: c.translationModel, speak: c.speechModel }[
      c.operation
    ],
    file: undefined,
    model: undefined,
  }[c.resource];
  if (chosen !== CUSTOM_MODEL) return chosen;
  return need(c.customModel, "customModel", `${c.resource}.${c.operation}`).trim();
}

/** The image of a binary field as a data URL. */
const dataUrlOf = (file: BinaryData): string => `data:${file.mimeType};base64,${file.data}`;

/** All images of the node: the URLs, and the binary field of the input when it is set. */
function imagesOf(c: OpenAIConfig, input: unknown): string[] {
  const urls = list(c.imageUrls);
  const property = c.imageProperty?.trim();
  if (property) urls.push(dataUrlOf(readBinary(input, property)));
  return urls;
}

/** A file ID goes in a path, so it must be an ID: letters, digits, dashes, and underscores. */
const fileIdOf = (value: string | undefined, operation: string): string => {
  const text = need(value, "fileId", operation).trim();
  if (!/^[A-Za-z0-9_-]{4,128}$/.test(text)) {
    throw new Error(`OpenAI ${operation}: "fileId" is not a file ID`);
  }
  return text;
};

/** A multipart field for a binary field of the input. */
function fileOf(c: OpenAIConfig, input: unknown): { blob: Blob; name: string } {
  const file = readBinary(input, c.property);
  return {
    blob: new Blob([new Uint8Array(Buffer.from(file.data, "base64"))], { type: file.mimeType }),
    name: file.fileName ?? "file",
  };
}

/** A JSON object from text. */
function schemaOf(text: string | undefined): Record<string, unknown> {
  let value: unknown;
  try {
    value = JSON.parse(need(text, "jsonSchema", "text.generate"));
  } catch {
    throw new Error('"jsonSchema" must be JSON');
  }
  if (!isRecord(value)) throw new Error('"jsonSchema" must be a JSON object');
  return value;
}

const responseFormatOf = (c: OpenAIConfig): Record<string, unknown> | undefined => {
  if (c.responseFormat === "json_object") return { type: "json_object" };
  if (c.responseFormat !== "json_schema") return undefined;
  return {
    type: "json_schema",
    json_schema: { name: "output", strict: true, schema: schemaOf(c.jsonSchema) },
  };
};

/** The OpenAI call for one operation, without the network. */
export function buildRequest(c: OpenAIConfig, input: unknown): Call {
  const op = `${c.resource}.${c.operation}`;

  switch (op) {
    case "text.generate": {
      const prompt = need(c.prompt, "prompt", op);
      const images = imagesOf(c, input);
      const system = c.systemPrompt?.trim();
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
                      { type: "text", text: prompt },
                      ...images.map((url) => ({ type: "image_url", image_url: { url } })),
                    ],
            },
          ],
          temperature: c.temperature,
          max_completion_tokens: c.maxTokens,
          response_format: responseFormatOf(c),
        },
      };
    }
    case "embedding.create":
      return {
        method: "POST",
        path: "/embeddings",
        json: {
          model: modelOf(c),
          input: need(c.input, "input", op),
          dimensions: c.dimensions,
        },
      };
    case "image.edit": {
      const file = fileOf(c, input);
      const form = new FormData();
      form.append("image", file.blob, file.name);
      form.append("model", need(modelOf(c), "model", op));
      form.append("prompt", need(c.prompt, "prompt", op));
      form.append("n", String(c.count));
      form.append("output_format", c.outputFormat);
      if (c.size !== "auto") form.append("size", c.size);
      if (c.quality !== "auto") form.append("quality", c.quality);
      if (c.background !== "auto") form.append("background", c.background);
      return { method: "POST", path: "/images/edits", form };
    }
    case "image.generate":
      return {
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
      };
    case "moderation.check": {
      const text = c.input?.trim();
      const images = imagesOf(c, input);
      if (!text && images.length === 0) {
        throw new Error(`OpenAI ${op} needs "input" or an image`);
      }
      return {
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
                  ...images.map((url) => ({ type: "image_url", image_url: { url } })),
                ],
        },
      };
    }
    case "audio.transcribe":
    case "audio.translate": {
      const file = fileOf(c, input);
      const form = new FormData();
      form.append("file", file.blob, file.name);
      form.append("model", need(modelOf(c), "model", op));
      // Only a transcription takes a language. A translation always gives English.
      if (c.operation === "transcribe" && c.language?.trim()) {
        form.append("language", c.language.trim());
      }
      if (c.transcriptionPrompt?.trim()) form.append("prompt", c.transcriptionPrompt.trim());
      const path = c.operation === "transcribe" ? "/audio/transcriptions" : "/audio/translations";
      return { method: "POST", path, form };
    }
    case "audio.speak":
      return {
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
      };
    case "file.upload": {
      const file = fileOf(c, input);
      const form = new FormData();
      form.append("file", file.blob, file.name);
      form.append("purpose", c.purpose);
      return { method: "POST", path: "/files", form };
    }
    case "file.list":
      return { method: "GET", path: "/files" };
    case "file.delete":
      return { method: "DELETE", path: `/files/${fileIdOf(c.fileId, op)}` };
    case "model.list":
      return { method: "GET", path: "/models" };
  }
  throw new Error(`Unknown OpenAI operation "${op}"`);
}

/** Text of a JSON answer, or undefined when it is not JSON. */
const parseJson = (text: string): unknown => {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
};

/** The output of the node for the answer of OpenAI, without the network. */
export function resultOf(c: OpenAIConfig, answer: Record<string, unknown>): unknown {
  const op = `${c.resource}.${c.operation}`;

  switch (op) {
    case "text.generate": {
      const choice = Array.isArray(answer.choices) ? answer.choices[0] : undefined;
      const message = isRecord(choice) && isRecord(choice.message) ? choice.message : {};
      const text = typeof message.content === "string" ? message.content : "";
      return {
        text,
        // JSON mode gives text that is JSON. The node gives the parsed value too.
        json: c.responseFormat === "text" ? undefined : parseJson(text),
        refusal: typeof message.refusal === "string" ? message.refusal : undefined,
        finishReason: isRecord(choice) ? choice.finish_reason : undefined,
        model: answer.model,
        usage: answer.usage,
        id: answer.id,
      };
    }
    case "embedding.create": {
      const data = Array.isArray(answer.data) ? answer.data : [];
      const first = data[0];
      return {
        embedding: isRecord(first) ? first.embedding : undefined,
        dimensions: isRecord(first) && Array.isArray(first.embedding) ? first.embedding.length : 0,
        model: answer.model,
        usage: answer.usage,
      };
    }
    case "image.edit":
    case "image.generate": {
      const data = Array.isArray(answer.data) ? answer.data : [];
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
      const results = Array.isArray(answer.results) ? answer.results : [];
      const first = isRecord(results[0]) ? results[0] : {};
      const categories = isRecord(first.categories) ? first.categories : {};
      return {
        flagged: first.flagged === true,
        flaggedCategories: Object.keys(categories).filter((key) => categories[key] === true),
        categories: first.categories,
        categoryScores: first.category_scores,
        model: answer.model,
        id: answer.id,
      };
    }
    case "audio.transcribe":
    case "audio.translate":
    case "file.upload":
    case "file.delete":
      return answer;
    case "audio.speak": {
      const mimeType = String(answer.mimeType).split(";")[0] ?? "audio/mpeg";
      const extension = c.speechFormat === "pcm" ? "pcm" : c.speechFormat;
      return {
        binary: {
          [c.outputProperty]: {
            data: String(answer.data),
            mimeType,
            fileName: `speech.${extension}`,
          },
        },
      };
    }
    case "file.list": {
      return Array.isArray(answer.data) ? answer.data : [];
    }
    case "model.list": {
      const data = Array.isArray(answer.data) ? answer.data : [];
      const filter = c.nameFilter?.trim().toLowerCase();
      return data.filter(
        (entry) => !filter || (isRecord(entry) && String(entry.id).toLowerCase().includes(filter)),
      );
    }
  }
  throw new Error(`Unknown OpenAI operation "${op}"`);
}
