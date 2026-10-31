// SPDX-License-Identifier: AGPL-3.0-only
import {
  type Access,
  type CallOptions,
  callApi,
  embedTexts,
  finishReasonOf,
  languageModelOf,
  OPENAI_STYLE,
  PROVIDER_LABEL,
  type Provider,
  partsOfAnthropic,
  sdkCall,
  signalOf,
  type ToolSpec,
  toolSetOf,
} from "@zerodot/ai-core";
import { isRecord, readBinary } from "@zerodot/node-sdk";
import type { JSONSchema7, JSONValue, ModelMessage, ToolChoice, ToolSet, UserContent } from "ai";
import type { AIConfig } from "./config";
import {
  arrayOf,
  checkToolChoice,
  imagesOf,
  lines,
  modelOf,
  parseJson,
  promptOf,
  schemaOf,
  systemOf,
  toolNameOf,
  toolsOf,
} from "./request";

// text.generate and embedding.create, with the AI SDK. The other operations call the APIs.
// The AI SDK loads on the first call, so loading the node package stays fast.

type JsonObject = Record<string, unknown>;
type Sdk = typeof import("ai");

const rec = (value: unknown): JsonObject => (isRecord(value) && !Array.isArray(value) ? value : {});
const arr = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
const str = (value: unknown): string | undefined => (typeof value === "string" ? value : undefined);

/** A Gemini file URI is `<base>/files/<id>`. Its type is in the file metadata. */
async function geminiFileType(access: Access, uri: string, options: CallOptions) {
  const id = /\/files\/([A-Za-z0-9_-]{1,128})$/.exec(uri)?.[1];
  if (!id) throw new Error(`"${uri}" is not a Gemini file URI. Upload the file first`);
  const file = await callApi(access, { method: "GET", path: `/files/${id}` }, options);
  return str(file.mimeType) ?? "application/octet-stream";
}

const IMAGE_TYPES: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
  heic: "image/heic",
  heif: "image/heif",
};

/**
 * The type of an image URL, from its extension. Gemini needs the full type of a URL. The other
 * providers read the type themselves, so "image" is enough for them.
 */
function imageTypeOf(c: AIConfig, url: string): string {
  let path = url;
  try {
    path = new URL(url).pathname;
  } catch {
    // The provider checks the URL.
  }
  const found = IMAGE_TYPES[path.split(".").pop()?.toLowerCase() ?? ""];
  return found ?? (c.provider === "gemini" ? "image/jpeg" : "image");
}

/** The providers with the API of OpenAI get the text before the images, as OpenAI shows. */
const TEXT_FIRST = new Set<Provider>([...OPENAI_STYLE, "azure"]);

/** The user message: the media, then the text. OpenAI gets the text first. */
async function userContent(
  c: AIConfig,
  input: unknown,
  access: Access,
  options: CallOptions,
): Promise<UserContent> {
  const op = "text.generate";
  const parts: Exclude<UserContent, string> = imagesOf(c, input).map((item) =>
    "url" in item
      ? { type: "file", data: new URL(item.url), mediaType: imageTypeOf(c, item.url) }
      : { type: "file", data: item.data, mediaType: item.mimeType },
  );
  if (c.provider === "anthropic") {
    for (const id of lines(c.imageFileIds)) {
      parts.push({ type: "file", data: { anthropic: id }, mediaType: "image" });
    }
    for (const url of lines(c.documentUrls)) {
      parts.push({ type: "file", data: new URL(url), mediaType: "application/pdf" });
    }
    for (const id of lines(c.documentFileIds)) {
      parts.push({ type: "file", data: { anthropic: id }, mediaType: "application/pdf" });
    }
    const property = c.documentProperty?.trim();
    if (property) {
      const data = readBinary(input, property).data;
      parts.push({ type: "file", data, mediaType: "application/pdf" });
    }
  }
  if (c.provider === "gemini") {
    for (const uri of lines(c.fileUris)) {
      const mediaType = await geminiFileType(access, uri, options);
      parts.push({ type: "file", data: new URL(uri), mediaType });
    }
  }
  const prompt = promptOf(c);
  if (!prompt && parts.length === 0) {
    const media =
      c.provider === "anthropic" ? '"prompt", an image, or a document' : '"prompt" or an image';
    throw new Error(`${op} needs ${media}`);
  }
  if (!prompt) return parts;
  if (parts.length === 0) return prompt;
  const text = { type: "text" as const, text: prompt };
  return TEXT_FIRST.has(c.provider) ? [text, ...parts] : [...parts, text];
}

/** After a tool call: the user turn, the answer of Claude, and the tool results. */
function anthropicTurns(c: AIConfig, op: string): ModelMessage[] {
  const results = arrayOf(c.toolResults, "toolResults");
  if (!results) return [];
  const assistant = arrayOf(c.assistantContent, "assistantContent");
  if (!assistant) throw new Error(`${op} needs "assistantContent" with "toolResults"`);
  const names = new Map(
    assistant
      .filter((block) => block.type === "tool_use")
      .map((block) => [str(block.id) ?? "", str(block.name) ?? ""]),
  );
  if (results.length === 0) throw new Error('"toolResults" has no item');
  const content = results.map((result, index) => {
    const id = result.tool_use_id;
    if (typeof id !== "string" || id === "") {
      throw new Error(`Tool result ${index + 1}: "tool_use_id" is missing`);
    }
    const value = result.content ?? "";
    const text = typeof value === "string" ? value : JSON.stringify(value);
    return {
      type: "tool-result" as const,
      toolCallId: id,
      toolName: names.get(id) ?? "",
      output:
        result.is_error === true
          ? { type: "error-text" as const, value: text }
          : { type: "text" as const, value: text },
    };
  });
  return [
    { role: "assistant", content: partsOfAnthropic(assistant) },
    { role: "tool", content },
  ];
}

function toolChoiceOf(c: AIConfig, op: string): ToolChoice<ToolSet> | undefined {
  if (c.toolChoice === "any") return "required";
  if (c.toolChoice === "none") return "none";
  if (c.toolChoice === "tool") return { type: "tool", toolName: toolNameOf(c, op) };
  return undefined;
}

/**
 * The output format. The node reads the JSON from the text itself, so a cut answer still gives
 * its text. Only the format of the request comes from the AI SDK.
 */
function outputOf({ Output, jsonSchema }: Sdk, c: AIConfig, op: string) {
  if (c.responseFormat === "text") return undefined;
  if (c.provider === "anthropic" && c.responseFormat === "json_object") {
    throw new Error(`${op}: Anthropic has no JSON mode. Use JSON Schema`);
  }
  const format =
    c.responseFormat === "json_schema"
      ? Output.object({ schema: jsonSchema(schemaOf(c, op) as JSONSchema7), name: "output" })
      : Output.json();
  return { ...Output.text(), responseFormat: format.responseFormat };
}

/** The settings that only one provider has. */
function providerOptionsOf(c: AIConfig): Record<string, Record<string, JSONValue>> | undefined {
  const parallel = c.tools?.trim() && c.disableParallelToolUse;
  switch (c.provider) {
    case "openai":
      return {
        openai: { strictJsonSchema: true, ...(parallel ? { parallelToolCalls: false } : {}) },
      };
    case "anthropic":
      return {
        anthropic: {
          ...(c.effort === "default" ? {} : { effort: c.effort }),
          ...(parallel ? { disableParallelToolUse: true } : {}),
        },
      };
    case "azure": {
      // The Azure package reads the options of OpenAI.
      const options = { strictJsonSchema: true, ...(parallel ? { parallelToolCalls: false } : {}) };
      return { openai: options, azure: options };
    }
    case "compatible":
      return { compatible: { strictJsonSchema: true } };
    default:
      return undefined;
  }
}

/** The output of text.generate. The tool calls come before the JSON, because a tool call has no JSON text. */
export async function generate(c: AIConfig, input: unknown, access: Access, options: CallOptions) {
  const op = "text.generate";
  const label = PROVIDER_LABEL[c.provider];
  const tools = toolsOf(c.tools);
  checkToolChoice(c, tools, op);
  const specs: ToolSpec[] = (tools ?? []).map((entry) => ({
    name: String(entry.name),
    description: str(entry.description) ?? "",
    inputSchema: rec(entry.input_schema),
  }));
  // The AI SDK has no setting for this field of a compatible service.
  const parallel = tools && c.disableParallelToolUse ? { parallel_tool_calls: false } : undefined;
  const sdk = await import("ai");
  const output = outputOf(sdk, c, op);
  const model = await languageModelOf(access, modelOf(c), parallel);
  const toolSet = await toolSetOf(specs);
  const messages: ModelMessage[] = [
    { role: "user", content: await userContent(c, input, access, options) },
    ...(c.provider === "anthropic" ? anthropicTurns(c, op) : []),
  ];
  const result = await sdkCall(c.provider, "text.generate", () =>
    sdk.generateText({
      model,
      system: systemOf(c),
      messages,
      tools: toolSet,
      toolChoice: tools ? toolChoiceOf(c, op) : undefined,
      output,
      maxOutputTokens: c.provider === "anthropic" ? (c.maxTokens ?? 1024) : c.maxTokens,
      temperature: c.provider === "anthropic" ? undefined : c.temperature,
      providerOptions: providerOptionsOf(c),
      // The provider reads the URLs of the prompt itself, as before. The node never downloads them.
      experimental_download: async (requests) => requests.map(() => null),
      // The node gives fields of the answer that the AI SDK does not keep.
      include: { responseBody: true },
      maxRetries: 0,
      abortSignal: signalOf(options),
    }),
  );
  const body = rec(result.response.body);
  const toolCalls = result.toolCalls.map((call) => ({
    id: call.toolCallId,
    name: call.toolName,
    input: call.input,
  }));
  const finishReason = finishReasonOf(result.finishReason, toolCalls.length);
  let json: unknown;
  if (c.responseFormat !== "text" && toolCalls.length === 0 && result.text.trim()) {
    json = parseJson(result.text);
    // A cut answer is not complete JSON. Every other answer must be.
    if (json === undefined && finishReason !== "length") {
      throw new Error(`${label} text.generate: the answer is not valid JSON`);
    }
  }
  const { inputTokens, outputTokens, totalTokens } = result.usage;
  const refusal = str(rec(rec(arr(body.choices)[0]).message).refusal);
  return {
    text: result.text,
    ...(json === undefined ? {} : { json }),
    toolCalls,
    finishReason,
    stopReason: result.rawFinishReason,
    usage: { inputTokens, outputTokens, totalTokens },
    model: str(body.model) ?? str(body.modelVersion) ?? result.response.modelId,
    id: str(body.id) ?? str(body.responseId) ?? result.response.id,
    ...(refusal ? { refusal } : {}),
    ...(c.provider === "anthropic" ? { assistantContent: arr(body.content) } : {}),
    ...(c.includeRaw ? { raw: result.response.body } : {}),
  };
}

/** The output of embedding.create. */
export async function embedding(c: AIConfig, access: Access, options: CallOptions) {
  const text = c.input;
  if (text === undefined || text.trim() === "") throw new Error('embedding.create needs "input"');
  const model = modelOf(c);
  const found = await embedTexts(
    access,
    { model, dimensions: c.dimensions, timeoutMs: options.timeoutMs },
    [text],
    undefined,
    options.signal,
  );
  const vector = found.vectors[0] ?? [];
  const body = rec(found.bodies[0]);
  return {
    embedding: vector,
    dimensions: vector.length,
    model: c.provider === "gemini" ? model.replace(/^models\//, "") : (body.model ?? model),
    usage: body.usage ?? body.usageMetadata ?? found.usage,
  };
}
