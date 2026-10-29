// SPDX-License-Identifier: AGPL-3.0-only
import assert from "node:assert/strict";
import { afterEach, describe, it, mock } from "node:test";
import { type NodeDefinition, toBinary } from "@zerodot/node-sdk";
import {
  type Access,
  AIError,
  ANTHROPIC_VERSION,
  accessOf,
  CREDENTIAL_OF,
  callApi,
  callList,
} from "./api";
import { aiConfig, PROVIDER_OPTIONS } from "./config";
import { credentialTypes, nodes } from "./index";
import { ANTHROPIC_MODELS, GEMINI_TEXT_MODELS, OPENAI_TEXT_MODELS } from "./models";
import { base64Of, buildRequest, resultOf } from "./request";

const signal = new AbortController().signal;
const options = { signal, timeoutMs: 5_000 };
// Built at run time, so secret scanners do not flag a fake key.
const KEY = `sk-${"test".repeat(8)}`;
type Cred = { type: string; data: Record<string, unknown> };
const credentials: Record<string, Cred> = {
  openai: { type: "ai.openai", data: { apiKey: KEY } },
  anthropic: { type: "ai.anthropic", data: { apiKey: KEY } },
  gemini: { type: "ai.gemini", data: { apiKey: KEY } },
  compatible: { type: "ai.compatible", data: { baseUrl: "https://llm.test/v1" } },
};
const accesses: Record<string, Access> = {
  openai: { provider: "openai", apiKey: KEY, baseUrl: "https://api.openai.com/v1" },
  anthropic: { provider: "anthropic", apiKey: KEY, baseUrl: "https://api.anthropic.com" },
  gemini: {
    provider: "gemini",
    apiKey: KEY,
    baseUrl: "https://generativelanguage.googleapis.com/v1beta",
  },
};
const openai = accesses.openai as Access;
const anthropic = accesses.anthropic as Access;
const gemini = accesses.gemini as Access;

const def = (type: string): NodeDefinition => {
  const found = nodes.find((entry) => entry.type === type);
  if (!found) throw new Error(`no node ${type}`);
  return found;
};

type Call = { url: string; init: RequestInit };
type Answer = { body?: unknown; status?: number; headers?: Record<string, string> };

/** Answers the calls in order. */
function mockFetch(answers: Answer[], calls: Call[] = []) {
  mock.method(globalThis, "fetch", async (url: URL | string, init: RequestInit) => {
    calls.push({ url: String(url), init });
    const answer = answers[calls.length - 1] ?? { body: {} };
    return new Response(JSON.stringify(answer.body ?? {}), {
      status: answer.status ?? 200,
      headers: answer.headers,
    });
  });
  return calls;
}

const bodyOf = (call: Call | undefined): Record<string, unknown> =>
  JSON.parse(String(call?.init.body));

const run = async (
  config: Record<string, unknown>,
  input: unknown = null,
  credential: Cred | null = credentials[String(config.provider ?? "openai")] ?? null,
) => {
  const definition = def("ai.api");
  return await definition.run({
    config: definition.config.parse(config),
    input,
    credential,
    signal,
    scope: {},
    tables: null,
    sandbox: null,
  } as never);
};

const build = (config: Record<string, unknown>, input: unknown = null) =>
  buildRequest(aiConfig.parse(config), input);
const result = (config: Record<string, unknown>, answer: Record<string, unknown>) =>
  resultOf(aiConfig.parse(config), answer);
const binaryInput = (name: string, mime: string, bytes = [1, 2]) => ({
  binary: { data: toBinary(new Uint8Array(bytes), name, mime) },
});

afterEach(() => mock.restoreAll());

describe("ai config", () => {
  it("checks that the operation belongs to the resource and the provider", () => {
    assert.equal(aiConfig.safeParse({ resource: "model", operation: "generate" }).success, false);
    assert.equal(aiConfig.safeParse({ resource: "model", operation: "list" }).success, true);
    assert.equal(aiConfig.safeParse({ provider: "anthropic", resource: "image" }).success, false);
    assert.equal(
      aiConfig.safeParse({ provider: "anthropic", operation: "countTokens" }).success,
      true,
    );
    assert.equal(
      aiConfig.safeParse({ provider: "openai", operation: "countTokens" }).success,
      false,
    );
    assert.equal(
      aiConfig.safeParse({ provider: "anthropic", resource: "embedding", operation: "create" })
        .success,
      false,
    );
    assert.equal(
      aiConfig.safeParse({ provider: "compatible", resource: "audio", operation: "speak" }).success,
      false,
    );
    assert.equal(
      aiConfig.safeParse({ provider: "gemini", resource: "image", operation: "edit" }).success,
      true,
    );
  });

  it("has a label and a hint for each option of each select", () => {
    const shape = aiConfig.shape as Record<string, { meta(): unknown }>;
    const options: Record<string, readonly string[]> = {
      provider: PROVIDER_OPTIONS.map((option) => option.id),
      resource: [
        "text",
        "embedding",
        "image",
        "moderation",
        "audio",
        "file",
        "model",
        "conversation",
        "conversationItem",
      ],
      operation: [
        "generate",
        "countTokens",
        "create",
        "edit",
        "check",
        "transcribe",
        "translate",
        "speak",
        "upload",
        "list",
        "delete",
        "get",
        "update",
        "add",
      ],
      openaiTextModel: [...OPENAI_TEXT_MODELS.map((model) => model.id), "custom"],
      anthropicModel: [...ANTHROPIC_MODELS.map((model) => model.id), "custom"],
      geminiTextModel: [...GEMINI_TEXT_MODELS.map((model) => model.id), "custom"],
      geminiEmbeddingModel: ["gemini-embedding-2", "gemini-embedding-001", "custom"],
      geminiImageModel: ["gemini-nano-banana-2.1", "gemini-3.1-flash-image", "custom"],
      openaiEmbeddingModel: ["text-embedding-3-small", "text-embedding-3-large", "custom"],
      openaiImageModel: ["gpt-image-2.5-sunburst", "gpt-image-2.5-flare", "gpt-image-2", "custom"],
      moderationModel: ["omni-moderation-latest", "custom"],
      audioModel: ["gpt-transcribe", "custom"],
      translationModel: ["whisper-1", "custom"],
      speechModel: ["gpt-4o-mini-tts", "custom"],
      responseFormat: ["text", "json_object", "json_schema"],
      toolChoice: ["auto", "any", "tool", "none"],
      speechFormat: ["mp3", "opus", "aac", "flac", "wav", "pcm"],
      aspectRatio: ["auto", "1:1", "16:9"],
      imageSize: ["auto", "1K", "2K", "4K"],
      size: ["auto", "1024x1024", "1536x1024", "1024x1536"],
      quality: ["auto", "low", "medium", "high"],
      outputFormat: ["png", "jpeg", "webp"],
      background: ["auto", "opaque", "transparent"],
      itemOrder: ["asc", "desc"],
    };
    for (const [key, values] of Object.entries(options)) {
      const meta = shape[key]?.meta() as {
        labels?: Record<string, string>;
        hints?: Record<string, string>;
      };
      for (const value of values) {
        assert.ok(meta.labels?.[value], `${key}.${value} label`);
        assert.ok(meta.hints?.[value], `${key}.${value} hint`);
      }
    }
  });

  it("shows a model select only for its provider", () => {
    const shape = aiConfig.shape as Record<string, { meta(): unknown }>;
    const providersOf = (key: string) =>
      (
        (shape[key]?.meta() as { showWhen: { provider: string[] }[] } | undefined)?.showWhen ?? []
      ).flatMap((rule) => rule.provider);
    assert.deepEqual([...new Set(providersOf("openaiTextModel"))], ["openai"]);
    assert.deepEqual([...new Set(providersOf("anthropicModel"))], ["anthropic"]);
    assert.deepEqual([...new Set(providersOf("geminiTextModel"))], ["gemini"]);
  });
});

describe("openai request", () => {
  it("builds a chat call with a system prompt and options", () => {
    const { call } = build({
      prompt: "Hi",
      systemPrompt: " Be brief ",
      temperature: 0.2,
      maxTokens: 100,
    });
    assert.equal(call.method, "POST");
    assert.equal(call.path, "/chat/completions");
    assert.deepEqual(call.json, {
      model: "gpt-6.1-terra",
      messages: [
        { role: "system", content: "Be brief" },
        { role: "user", content: "Hi" },
      ],
      temperature: 0.2,
      max_completion_tokens: 100,
      response_format: undefined,
      tools: undefined,
      tool_choice: undefined,
      parallel_tool_calls: undefined,
    });
  });

  it("needs a prompt", () => {
    assert.throws(() => build({}), /prompt/);
  });

  it("uses a custom model id", () => {
    const { call } = build({
      prompt: "Hi",
      openaiTextModel: "custom",
      customModel: " my-model ",
    });
    assert.equal(call.json?.model, "my-model");
    assert.throws(() => build({ prompt: "Hi", openaiTextModel: "custom" }), /customModel/);
  });

  it("sends images from URLs, data URLs, and a binary field", () => {
    const input = binaryInput("a.png", "image/png");
    const { call } = build(
      {
        prompt: "What is it?",
        imageUrls: "https://a.test/1.png?x=1,2\nhttps://a.test/2.png",
        imageProperty: "data",
      },
      input,
    );
    const messages = call.json?.messages as { content: { type: string }[] }[];
    const parts = messages[0]?.content ?? [];
    assert.deepEqual(
      parts.map((part) => part.type),
      ["text", "image_url", "image_url", "image_url"],
    );
    assert.match(JSON.stringify(parts[1]), /1\.png\?x=1,2/);
    assert.match(JSON.stringify(parts[3]), /data:image\/png;base64,AQI=/);
  });

  it("sets JSON mode and a JSON schema", () => {
    assert.deepEqual(
      build({ prompt: "Hi", responseFormat: "json_object" }).call.json?.response_format,
      {
        type: "json_object",
      },
    );
    const { call } = build({
      prompt: "Hi",
      responseFormat: "json_schema",
      jsonSchema: '{"type":"object"}',
    });
    assert.deepEqual(call.json?.response_format, {
      type: "json_schema",
      json_schema: { name: "output", strict: true, schema: { type: "object" } },
    });
    assert.throws(
      () => build({ prompt: "Hi", responseFormat: "json_schema", jsonSchema: "[1]" }),
      /JSON object/,
    );
    assert.throws(
      () => build({ prompt: "Hi", responseFormat: "json_schema", jsonSchema: "{" }),
      /must be JSON/,
    );
  });

  it("builds tools and a tool choice", () => {
    const tools = '[{"name":"get_weather","description":"d","input_schema":{"type":"object"}}]';
    const { call } = build({
      prompt: "Hi",
      tools,
      toolChoice: "any",
      disableParallelToolUse: true,
    });
    assert.deepEqual(call.json?.tools, [
      {
        type: "function",
        function: { name: "get_weather", description: "d", parameters: { type: "object" } },
      },
    ]);
    assert.equal(call.json?.tool_choice, "required");
    assert.equal(call.json?.parallel_tool_calls, false);
    assert.deepEqual(
      build({ prompt: "Hi", tools, toolChoice: "tool", toolChoiceName: "get_weather" }).call.json
        ?.tool_choice,
      { type: "function", function: { name: "get_weather" } },
    );
    assert.equal(build({ prompt: "Hi", tools, toolChoice: "none" }).call.json?.tool_choice, "none");
  });

  it("builds an embedding call", () => {
    const { call } = build({
      resource: "embedding",
      operation: "create",
      input: "Hello",
      dimensions: 256,
    });
    assert.equal(call.path, "/embeddings");
    assert.deepEqual(call.json, {
      model: "text-embedding-3-small",
      input: "Hello",
      dimensions: 256,
    });
    assert.throws(() => build({ resource: "embedding", operation: "create" }), /input/);
  });

  it("builds an image call and leaves out the auto values", () => {
    const { call } = build({
      resource: "image",
      operation: "generate",
      prompt: "A fox",
      size: "1024x1024",
      count: 2,
      outputFormat: "webp",
    });
    assert.equal(call.path, "/images/generations");
    assert.deepEqual(call.json, {
      model: "gpt-image-2.5-flare",
      prompt: "A fox",
      n: 2,
      size: "1024x1024",
      quality: undefined,
      background: undefined,
      output_format: "webp",
    });
  });

  it("builds a moderation call for text and for images", () => {
    const text = build({ resource: "moderation", operation: "check", input: "Hello" }).call;
    assert.equal(text.path, "/moderations");
    assert.deepEqual(text.json, { model: "omni-moderation-latest", input: "Hello" });
    const image = build({
      resource: "moderation",
      operation: "check",
      input: "Hello",
      imageUrls: "https://a.test/1.png",
    }).call;
    assert.deepEqual(image.json?.input, [
      { type: "text", text: "Hello" },
      { type: "image_url", image_url: { url: "https://a.test/1.png" } },
    ]);
    assert.throws(() => build({ resource: "moderation", operation: "check" }), /input/);
  });

  it("builds a transcription and a translation upload", () => {
    const input = binaryInput("a.mp3", "audio/mpeg", [1, 2, 3]);
    const { call } = build({ resource: "audio", operation: "transcribe", language: "en" }, input);
    assert.equal(call.path, "/audio/transcriptions");
    const file = call.form?.get("file");
    assert.ok(file instanceof File);
    assert.equal(file.name, "a.mp3");
    assert.equal(file.size, 3);
    assert.equal(call.form?.get("model"), "gpt-transcribe");
    assert.equal(call.form?.get("language"), "en");
    assert.throws(() => build({ resource: "audio", operation: "transcribe" }, {}));
    const translation = build(
      { resource: "audio", operation: "translate", language: "fr", transcriptionPrompt: "Ada" },
      input,
    ).call;
    assert.equal(translation.path, "/audio/translations");
    assert.equal(translation.form?.get("model"), "whisper-1");
    assert.equal(translation.form?.get("language"), null);
    assert.equal(translation.form?.get("prompt"), "Ada");
  });

  it("builds a speech call that wants a file", () => {
    const { call } = build({
      resource: "audio",
      operation: "speak",
      input: "Hello",
      speed: 1.5,
      instructions: " ",
    });
    assert.equal(call.path, "/audio/speech");
    assert.equal(call.binary, true);
    assert.deepEqual(call.json, {
      model: "gpt-4o-mini-tts",
      input: "Hello",
      voice: "alloy",
      response_format: "mp3",
      speed: 1.5,
      instructions: undefined,
    });
    assert.throws(() => build({ resource: "audio", operation: "speak" }), /input/);
  });

  it("builds an image edit upload", () => {
    const input = binaryInput("a.png", "image/png");
    const { call } = build(
      { resource: "image", operation: "edit", prompt: "Add a hat", size: "1024x1024" },
      input,
    );
    assert.equal(call.path, "/images/edits");
    assert.equal(call.form?.get("prompt"), "Add a hat");
    assert.equal(call.form?.get("model"), "gpt-image-2.5-flare");
    assert.equal(call.form?.get("size"), "1024x1024");
    assert.equal(call.form?.get("quality"), null);
    assert.ok(call.form?.get("image") instanceof File);
    assert.throws(() => build({ resource: "image", operation: "edit" }, input), /prompt/);
  });

  it("builds file calls and checks the file ID", () => {
    const input = binaryInput("d.jsonl", "application/jsonl", [1]);
    const upload = build({ resource: "file", operation: "upload", purpose: "batch" }, input).call;
    assert.equal(upload.path, "/files");
    assert.equal(upload.form?.get("purpose"), "batch");
    assert.deepEqual(build({ resource: "file", operation: "list" }).call, {
      method: "GET",
      path: "/files",
    });
    assert.deepEqual(build({ resource: "file", operation: "delete", fileId: "file-abc123" }).call, {
      method: "DELETE",
      path: "/files/file-abc123",
    });
    assert.throws(() => build({ resource: "file", operation: "delete" }), /fileId/);
    assert.throws(
      () => build({ resource: "file", operation: "delete", fileId: "../models" }),
      /not a file ID/,
    );
  });

  it("builds conversation calls", () => {
    assert.deepEqual(
      build({
        resource: "conversation",
        operation: "create",
        metadata: '{"topic":"demo"}',
        conversationItems: '[{"type":"message","role":"user","content":"Hi"}]',
      }).call,
      {
        method: "POST",
        path: "/conversations",
        json: {
          metadata: { topic: "demo" },
          items: [{ type: "message", role: "user", content: "Hi" }],
        },
      },
    );
    assert.deepEqual(
      build({ resource: "conversation", operation: "get", conversationId: "conv_1a2b" }).call,
      { method: "GET", path: "/conversations/conv_1a2b" },
    );
    const update = build({
      resource: "conversation",
      operation: "update",
      conversationId: "conv_1a2b",
      metadata: '{"a":"b"}',
    }).call;
    assert.equal(update.method, "POST");
    assert.deepEqual(update.json, { metadata: { a: "b" } });
    assert.equal(
      build({ resource: "conversation", operation: "delete", conversationId: "conv_1a2b" }).call
        .method,
      "DELETE",
    );
  });

  it("checks the input of conversation calls", () => {
    const base = { resource: "conversation", conversationId: "conv_1a2b" };
    assert.throws(() => build({ ...base, operation: "get", conversationId: "../x" }), /not an ID/);
    assert.throws(() => build({ resource: "conversation", operation: "get" }), /conversationId/);
    assert.throws(() => build({ ...base, operation: "update" }), /metadata/);
    assert.throws(() => build({ ...base, operation: "update", metadata: "{" }), /must be JSON/);
    assert.throws(() => build({ ...base, operation: "update", metadata: '{"a":1}' }), /text/);
    assert.throws(
      () => build({ resource: "conversation", operation: "create", conversationItems: "{}" }),
      /array/,
    );
    assert.throws(
      () =>
        build({
          resource: "conversation",
          operation: "create",
          conversationItems: JSON.stringify(Array.from({ length: 21 }, () => ({}))),
        }),
      /at most 20/,
    );
  });

  it("builds conversation item calls", () => {
    const base = { resource: "conversationItem", conversationId: "conv_1a2b" };
    assert.deepEqual(
      build({ ...base, operation: "add", conversationItems: '[{"type":"message"}]' }).call,
      {
        method: "POST",
        path: "/conversations/conv_1a2b/items",
        json: { items: [{ type: "message" }] },
      },
    );
    assert.throws(() => build({ ...base, operation: "add" }), /conversationItems/);
    assert.deepEqual(build({ ...base, operation: "list", itemLimit: 5, itemOrder: "desc" }).call, {
      method: "GET",
      path: "/conversations/conv_1a2b/items?limit=5&order=desc",
    });
    assert.equal(
      build({ ...base, operation: "list", itemAfter: " msg_9 " }).call.path,
      "/conversations/conv_1a2b/items?limit=20&order=asc&after=msg_9",
    );
    assert.deepEqual(build({ ...base, operation: "get", itemId: "msg_abc" }).call, {
      method: "GET",
      path: "/conversations/conv_1a2b/items/msg_abc",
    });
    assert.equal(build({ ...base, operation: "delete", itemId: "msg_abc" }).call.method, "DELETE");
    assert.throws(() => build({ ...base, operation: "get" }), /itemId/);
  });

  it("builds a list call", () => {
    const request = build({ resource: "model", operation: "list" });
    assert.equal(request.call.path, "/models");
    assert.deepEqual(request.list, { itemsKey: "data", limit: 20 });
    assert.equal(
      build({ resource: "model", operation: "list", returnAll: true }).list?.limit,
      null,
    );
    assert.equal(build({ resource: "file", operation: "list" }).list?.limit, null);
  });
});

describe("compatible request", () => {
  it("needs the model id and uses the older token name", () => {
    assert.throws(() => build({ provider: "compatible", prompt: "Hi" }), /customModel/);
    const { call } = build({
      provider: "compatible",
      prompt: "Hi",
      customModel: "llama3",
      maxTokens: 50,
    });
    assert.equal(call.path, "/chat/completions");
    assert.equal(call.json?.model, "llama3");
    assert.equal(call.json?.max_tokens, 50);
    assert.equal("max_completion_tokens" in (call.json ?? {}), false);
    assert.equal(
      build({
        provider: "compatible",
        resource: "embedding",
        operation: "create",
        input: "x",
        customModel: "e",
      }).call.path,
      "/embeddings",
    );
  });
});

describe("anthropic request", () => {
  const a = { provider: "anthropic" };

  it("builds a message with a system prompt and no temperature", () => {
    const { call } = build({ ...a, systemPrompt: "Be brief", prompt: "Hi" });
    assert.equal(call.method, "POST");
    assert.equal(call.path, "/v1/messages");
    assert.deepEqual(call.json, {
      model: "claude-sonnet-5-5",
      max_tokens: 1024,
      system: "Be brief",
      messages: [{ role: "user", content: "Hi" }],
      tools: undefined,
      tool_choice: undefined,
      output_config: undefined,
    });
  });

  it("uses a custom model", () => {
    const { call } = build({
      ...a,
      anthropicModel: "custom",
      customModel: " claude-opus-4-8 ",
      prompt: "Hi",
    });
    assert.equal(call.json?.model, "claude-opus-4-8");
    assert.throws(() => build({ ...a, anthropicModel: "custom", prompt: "Hi" }), /customModel/);
  });

  it("puts images before the text", () => {
    const input = binaryInput("a.webp", "image/webp");
    const { call } = build(
      {
        ...a,
        prompt: "What is this?",
        imageUrls: "https://a.test/1.png\nhttps://a.test/2.png",
        imageProperty: "data",
      },
      input,
    );
    const messages = call.json?.messages as { content: unknown }[];
    assert.deepEqual(messages[0]?.content, [
      { type: "image", source: { type: "url", url: "https://a.test/1.png" } },
      { type: "image", source: { type: "url", url: "https://a.test/2.png" } },
      { type: "image", source: { type: "base64", media_type: "image/webp", data: "AQI=" } },
      { type: "text", text: "What is this?" },
    ]);
  });

  it("adds files and PDF documents", () => {
    const { call } = build(
      {
        ...a,
        prompt: "Summarize",
        imageFileIds: "file_img1",
        documentUrls: "https://a.test/a.pdf",
        documentFileIds: "file_doc1\nfile_doc2",
        documentProperty: "data",
      },
      binaryInput("a.pdf", "application/pdf"),
    );
    const messages = call.json?.messages as { content: unknown }[];
    assert.deepEqual(messages[0]?.content, [
      { type: "image", source: { type: "file", file_id: "file_img1" } },
      { type: "document", source: { type: "url", url: "https://a.test/a.pdf" } },
      { type: "document", source: { type: "file", file_id: "file_doc1" } },
      { type: "document", source: { type: "file", file_id: "file_doc2" } },
      { type: "document", source: { type: "base64", media_type: "application/pdf", data: "AQI=" } },
      { type: "text", text: "Summarize" },
    ]);
  });

  it("sets the effort only when it is not the default", () => {
    assert.equal(build({ ...a, prompt: "Hi" }).call.json?.output_config, undefined);
    assert.deepEqual(build({ ...a, prompt: "Hi", effort: "low" }).call.json?.output_config, {
      effort: "low",
    });
    assert.deepEqual(
      build({
        ...a,
        prompt: "Hi",
        effort: "high",
        responseFormat: "json_schema",
        jsonSchema: '{"type":"object"}',
      }).call.json?.output_config,
      { effort: "high", format: { type: "json_schema", schema: { type: "object" } } },
    );
    assert.throws(
      () => build({ ...a, prompt: "Hi", responseFormat: "json_object" }),
      /no JSON mode/,
    );
  });

  it("builds the file calls", () => {
    const input = binaryInput("a.txt", "text/plain", [65, 66, 67]);
    const upload = build(
      { ...a, resource: "file", operation: "upload", expiresInSeconds: 3600 },
      input,
    ).call;
    assert.equal(upload.path, "/v1/files");
    const file = upload.form?.get("file");
    assert.ok(file instanceof File);
    assert.equal(file.name, "a.txt");
    assert.equal(file.type, "text/plain");
    assert.equal(upload.form?.get("expires_in_seconds"), "3600");
    assert.equal(upload.form?.get("purpose"), null);
    const get = build({ ...a, resource: "file", operation: "get", fileId: "file_011CNha8" });
    assert.deepEqual(get.call, { method: "GET", path: "/v1/files/file_011CNha8" });
    const del = build({ ...a, resource: "file", operation: "delete", fileId: "file_011CNha8" });
    assert.deepEqual(del.call, { method: "DELETE", path: "/v1/files/file_011CNha8" });
    assert.throws(
      () => build({ ...a, resource: "file", operation: "get", fileId: "../v1/models" }),
      /not a file ID/,
    );
    assert.equal(build({ ...a, resource: "file", operation: "list" }).list?.limit, 20);
  });

  it("needs a prompt or an image", () => {
    assert.throws(() => build(a), /needs "prompt"/);
    assert.doesNotThrow(() => build({ ...a, imageUrls: "https://a.test/1.png" }));
  });

  it("builds tools and a tool choice", () => {
    const tool = {
      name: "get_weather",
      description: "Get the weather",
      input_schema: { type: "object", properties: { city: { type: "string" } } },
    };
    const tools = JSON.stringify([tool]);
    const plain = build({ ...a, prompt: "Hi", tools }).call.json;
    assert.deepEqual(plain?.tools, [tool]);
    assert.equal(plain?.tool_choice, undefined);
    assert.deepEqual(
      build({ ...a, prompt: "Hi", tools, toolChoice: "tool", toolChoiceName: "get_weather" }).call
        .json?.tool_choice,
      { type: "tool", name: "get_weather" },
    );
    assert.deepEqual(
      build({ ...a, prompt: "Hi", tools, toolChoice: "any", disableParallelToolUse: true }).call
        .json?.tool_choice,
      { type: "any", disable_parallel_tool_use: true },
    );
    assert.deepEqual(
      build({ ...a, prompt: "Hi", tools, toolChoice: "none" }).call.json?.tool_choice,
      { type: "none" },
    );
    assert.throws(() => build({ ...a, prompt: "Hi", tools, toolChoice: "tool" }), /toolChoiceName/);
    assert.deepEqual(
      build({ ...a, operation: "countTokens", prompt: "Hi", tools }).call.json?.tools,
      [tool],
    );
  });

  it("does not drop a tool choice that has no tools", () => {
    for (const provider of ["openai", "anthropic", "gemini"]) {
      assert.throws(
        () => build({ provider, prompt: "Hi", toolChoice: "any" }),
        /no "tools"/,
        provider,
      );
    }
    assert.doesNotThrow(() => build({ ...a, prompt: "Hi", toolChoice: "auto" }));
  });

  it("checks the tools", () => {
    assert.throws(() => build({ ...a, prompt: "Hi", tools: "nope" }), /must be JSON/);
    assert.throws(() => build({ ...a, prompt: "Hi", tools: "{}" }), /array of objects/);
    assert.throws(() => build({ ...a, prompt: "Hi", tools: "[]" }), /no tool/);
    assert.throws(
      () =>
        build({ ...a, prompt: "Hi", tools: '[{"name":"a b","input_schema":{"type":"object"}}]' }),
      /"name"/,
    );
    assert.throws(
      () =>
        build({
          ...a,
          prompt: "Hi",
          tools: `[{"name":"${"a".repeat(129)}","input_schema":{"type":"object"}}]`,
        }),
      /"name"/,
    );
    assert.doesNotThrow(() =>
      build({
        ...a,
        prompt: "Hi",
        tools: `[{"name":"${"a".repeat(128)}","input_schema":{"type":"object"}}]`,
      }),
    );
    assert.throws(() => build({ ...a, prompt: "Hi", tools: '[{"name":"a"}]' }), /input_schema/);
    assert.throws(
      () => build({ ...a, prompt: "Hi", tools: '[{"name":"a","input_schema":{"type":"array"}}]' }),
      /type "object"/,
    );
  });

  it("continues after a tool call", () => {
    const assistant = [
      { type: "text", text: "I check." },
      { type: "tool_use", id: "toolu_1", name: "get_weather", input: { city: "Oslo" } },
    ];
    const tools = '[{"name":"get_weather","input_schema":{"type":"object"}}]';
    const { call } = build({
      ...a,
      prompt: "Weather in Oslo?",
      tools,
      assistantContent: JSON.stringify(assistant),
      toolResults: JSON.stringify([
        { tool_use_id: "toolu_1", content: { temp: 3 } },
        { tool_use_id: "toolu_2", content: "failed", is_error: true },
      ]),
    });
    assert.deepEqual(call.json?.messages, [
      { role: "user", content: "Weather in Oslo?" },
      { role: "assistant", content: assistant },
      {
        role: "user",
        content: [
          { type: "tool_result", tool_use_id: "toolu_1", content: '{"temp":3}' },
          { type: "tool_result", tool_use_id: "toolu_2", content: "failed", is_error: true },
        ],
      },
    ]);
    assert.throws(
      () => build({ ...a, prompt: "Hi", tools, toolResults: '[{"tool_use_id":"t"}]' }),
      /assistantContent/,
    );
    assert.throws(
      () =>
        build({
          ...a,
          prompt: "Hi",
          tools,
          assistantContent: "[]",
          toolResults: '[{"content":"x"}]',
        }),
      /tool_use_id/,
    );
  });

  it("builds a token count without max_tokens", () => {
    const { call } = build({ ...a, operation: "countTokens", prompt: "Hi" });
    assert.equal(call.path, "/v1/messages/count_tokens");
    assert.equal("max_tokens" in (call.json ?? {}), false);
  });

  it("builds a model list", () => {
    const request = build({ ...a, resource: "model", operation: "list" });
    assert.equal(request.call.path, "/v1/models");
    assert.equal(request.list?.itemsKey, "data");
  });
});

describe("gemini request", () => {
  const g = { provider: "gemini" };

  it("builds a generateContent call", () => {
    const { call } = build({
      ...g,
      systemPrompt: "Be brief",
      prompt: "Hi",
      maxTokens: 50,
      temperature: 0.5,
    });
    assert.equal(call.path, "/models/gemini-3.8-flash:generateContent");
    assert.deepEqual(call.json, {
      systemInstruction: { parts: [{ text: "Be brief" }] },
      contents: [{ role: "user", parts: [{ text: "Hi" }] }],
      tools: undefined,
      toolConfig: undefined,
      generationConfig: { maxOutputTokens: 50, temperature: 0.5 },
    });
    assert.equal(build({ ...g, prompt: "Hi" }).call.json?.generationConfig, undefined);
    assert.throws(() => build(g), /prompt/);
  });

  it("checks the custom model id", () => {
    const custom = { ...g, prompt: "Hi", geminiTextModel: "custom" };
    assert.equal(
      build({ ...custom, customModel: "models/gemini-x" }).call.path,
      "/models/gemini-x:generateContent",
    );
    assert.throws(() => build({ ...custom, customModel: "../x" }), /not a model id/);
    assert.throws(() => build(custom), /customModel/);
  });

  it("sends images, data URLs, and file URIs before the text", () => {
    const { call } = build(
      {
        ...g,
        prompt: "Look",
        imageUrls: "data:image/png;base64,QUJD\nhttps://files.test/f",
        fileUris: "https://generativelanguage.googleapis.com/v1beta/files/abc",
        imageProperty: "data",
      },
      binaryInput("a.png", "image/jpeg"),
    );
    const contents = call.json?.contents as { parts: unknown[] }[];
    assert.deepEqual(contents[0]?.parts, [
      { inlineData: { mimeType: "image/png", data: "QUJD" } },
      { fileData: { fileUri: "https://files.test/f" } },
      { inlineData: { mimeType: "image/jpeg", data: "AQI=" } },
      { fileData: { fileUri: "https://generativelanguage.googleapis.com/v1beta/files/abc" } },
      { text: "Look" },
    ]);
  });

  it("checks Base64", () => {
    assert.equal(base64Of(" QU\nJD ", "x"), "QUJD");
    assert.throws(() => base64Of("data:image/png;base64,QUJD", "x"), /data: prefix/);
    assert.throws(() => base64Of("QUJ", "x"), /not valid Base64/);
    assert.throws(() => base64Of("QU!D", "x"), /not valid Base64/);
    assert.throws(
      () => build({ ...g, prompt: "x", imageUrls: "data:image/png;base64,QU" }),
      /Base64/,
    );
  });

  it("sets JSON output and a JSON schema", () => {
    assert.deepEqual(
      build({ ...g, prompt: "Hi", responseFormat: "json_object" }).call.json?.generationConfig,
      { responseMimeType: "application/json" },
    );
    assert.deepEqual(
      build({ ...g, prompt: "Hi", responseFormat: "json_schema", jsonSchema: '{"type":"object"}' })
        .call.json?.generationConfig,
      { responseMimeType: "application/json", responseJsonSchema: { type: "object" } },
    );
  });

  it("builds tools and a tool config", () => {
    const tools = '[{"name":"get_weather","description":"d","input_schema":{"type":"object"}}]';
    const { call } = build({
      ...g,
      prompt: "Hi",
      tools,
      toolChoice: "tool",
      toolChoiceName: "get_weather",
    });
    assert.deepEqual(call.json?.tools, [
      {
        functionDeclarations: [
          { name: "get_weather", description: "d", parametersJsonSchema: { type: "object" } },
        ],
      },
    ]);
    assert.deepEqual(call.json?.toolConfig, {
      functionCallingConfig: { mode: "ANY", allowedFunctionNames: ["get_weather"] },
    });
    assert.deepEqual(
      build({ ...g, prompt: "Hi", tools, toolChoice: "any" }).call.json?.toolConfig,
      {
        functionCallingConfig: { mode: "ANY" },
      },
    );
    assert.deepEqual(
      build({ ...g, prompt: "Hi", tools, toolChoice: "none" }).call.json?.toolConfig,
      {
        functionCallingConfig: { mode: "NONE" },
      },
    );
    assert.equal(build({ ...g, prompt: "Hi", tools }).call.json?.toolConfig, undefined);
  });

  it("builds a token count", () => {
    const { call } = build({ ...g, operation: "countTokens", prompt: "Hi", systemPrompt: "S" });
    assert.equal(call.path, "/models/gemini-3.8-flash:countTokens");
    assert.deepEqual(call.json, {
      generateContentRequest: {
        model: "models/gemini-3.8-flash",
        systemInstruction: { parts: [{ text: "S" }] },
        contents: [{ role: "user", parts: [{ text: "Hi" }] }],
        tools: undefined,
      },
    });
  });

  it("builds an embedding call", () => {
    const { call } = build({
      ...g,
      resource: "embedding",
      operation: "create",
      input: "Hello",
      dimensions: 256,
    });
    assert.equal(call.path, "/models/gemini-embedding-2:embedContent");
    assert.deepEqual(call.json, {
      content: { parts: [{ text: "Hello" }] },
      embedContentConfig: { outputDimensionality: 256 },
    });
    assert.equal(
      build({ ...g, resource: "embedding", operation: "create", input: "x" }).call.json
        ?.embedContentConfig,
      undefined,
    );
  });

  it("builds image generation and image editing calls", () => {
    const gen = build({
      ...g,
      resource: "image",
      operation: "generate",
      prompt: "A fox",
      aspectRatio: "16:9",
      imageSize: "2K",
    }).call;
    assert.equal(gen.path, "/models/gemini-nano-banana-2.1:generateContent");
    assert.deepEqual(gen.json, {
      contents: [{ role: "user", parts: [{ text: "A fox" }] }],
      generationConfig: {
        responseModalities: ["IMAGE"],
        imageConfig: { aspectRatio: "16:9", imageSize: "2K" },
      },
    });
    const edit = build(
      { ...g, resource: "image", operation: "edit", prompt: "Hat" },
      binaryInput("a.png", "image/png"),
    ).call;
    const contents = edit.json?.contents as { parts: unknown[] }[];
    assert.deepEqual(contents[0]?.parts, [
      { inlineData: { mimeType: "image/png", data: "AQI=" } },
      { text: "Hat" },
    ]);
    assert.equal(
      (edit.json?.generationConfig as Record<string, unknown> | undefined)?.imageConfig,
      undefined,
    );
  });

  it("builds file calls", () => {
    const upload = build(
      { ...g, resource: "file", operation: "upload" },
      binaryInput("a.pdf", "application/pdf"),
    ).call;
    assert.equal(upload.path, "/files");
    assert.deepEqual(upload.upload?.mimeType, "application/pdf");
    assert.equal(upload.upload?.displayName, "a.pdf");
    assert.equal(upload.upload?.data.length, 2);
    assert.deepEqual(
      build({ ...g, resource: "file", operation: "get", fileId: "files/abc-123" }).call,
      {
        method: "GET",
        path: "/files/abc-123",
      },
    );
    assert.equal(
      build({ ...g, resource: "file", operation: "delete", fileId: "abc-123" }).call.method,
      "DELETE",
    );
    assert.throws(
      () => build({ ...g, resource: "file", operation: "get", fileId: "../x" }),
      /file ID/,
    );
    const list = build({ ...g, resource: "file", operation: "list" });
    assert.deepEqual(list.list, { itemsKey: "files", limit: 20 });
    assert.deepEqual(
      build({ ...g, resource: "model", operation: "list" }).list?.itemsKey,
      "models",
    );
  });
});

describe("ai result", () => {
  it("reads an OpenAI chat answer", () => {
    const answer = {
      id: "c1",
      model: "gpt-6.1-terra",
      choices: [{ message: { content: '{"a":1}' }, finish_reason: "stop" }],
      usage: { prompt_tokens: 2, completion_tokens: 3, total_tokens: 5 },
    };
    const out = result({ prompt: "Hi", responseFormat: "json_object" }, answer) as Record<
      string,
      unknown
    >;
    assert.equal(out.text, '{"a":1}');
    assert.deepEqual(out.json, { a: 1 });
    assert.equal(out.finishReason, "stop");
    assert.equal(out.stopReason, "stop");
    assert.deepEqual(out.usage, { inputTokens: 2, outputTokens: 3, totalTokens: 5 });
    assert.equal(out.raw, undefined);
    assert.deepEqual(out.toolCalls, []);
    const plain = result({ prompt: "Hi", includeRaw: true }, answer) as Record<string, unknown>;
    assert.equal("json" in plain, false);
    assert.equal(plain.raw, answer);
  });

  it("reads OpenAI tool calls", () => {
    const out = result(
      { prompt: "Hi" },
      {
        choices: [
          {
            message: {
              content: null,
              tool_calls: [
                { id: "call_1", function: { name: "get_weather", arguments: '{"city":"Oslo"}' } },
              ],
            },
            finish_reason: "tool_calls",
          },
        ],
      },
    ) as { toolCalls: unknown; finishReason: string; text: string };
    assert.equal(out.text, "");
    assert.equal(out.finishReason, "tool_calls");
    assert.deepEqual(out.toolCalls, [
      { id: "call_1", name: "get_weather", input: { city: "Oslo" } },
    ]);
  });

  it("reads an Anthropic answer and keeps the content to continue", () => {
    const use = { type: "tool_use", id: "toolu_1", name: "get_weather", input: { city: "Oslo" } };
    const content = [{ type: "text", text: "Wait" }, use];
    const out = result(
      { provider: "anthropic", prompt: "Hi" },
      {
        id: "msg_1",
        model: "claude-sonnet-5-5",
        content,
        stop_reason: "tool_use",
        usage: { input_tokens: 3, output_tokens: 1 },
      },
    ) as Record<string, unknown>;
    assert.equal(out.text, "Wait");
    assert.equal(out.finishReason, "tool_calls");
    assert.equal(out.stopReason, "tool_use");
    assert.deepEqual(out.toolCalls, [
      { id: "toolu_1", name: "get_weather", input: { city: "Oslo" } },
    ]);
    assert.deepEqual(out.assistantContent, content);
    assert.deepEqual(out.usage, { inputTokens: 3, outputTokens: 1, totalTokens: 4 });
  });

  it("does not parse JSON when the answer is a tool call", () => {
    const config = {
      provider: "anthropic",
      prompt: "Hi",
      responseFormat: "json_schema",
      jsonSchema: '{"type":"object"}',
    };
    const out = result(config, {
      content: [{ type: "tool_use", id: "t", name: "a", input: {} }],
      stop_reason: "tool_use",
    }) as Record<string, unknown>;
    assert.equal(out.finishReason, "tool_calls");
    assert.equal("json" in out, false);
    assert.throws(
      () => result(config, { content: [{ type: "text", text: "nope" }], stop_reason: "end_turn" }),
      /not valid JSON/,
    );
    const cut = result(config, {
      content: [{ type: "text", text: '{"a"' }],
      stop_reason: "max_tokens",
    }) as Record<string, unknown>;
    assert.equal(cut.finishReason, "length");
    assert.equal("json" in cut, false);
  });

  it("reads a Gemini answer", () => {
    const out = result(
      { provider: "gemini", prompt: "Hi" },
      {
        candidates: [
          {
            content: {
              parts: [
                { text: "thinking", thought: true },
                { text: "Hello" },
                { functionCall: { name: "get_weather", args: { city: "Oslo" } } },
              ],
            },
            finishReason: "STOP",
          },
        ],
        usageMetadata: {
          promptTokenCount: 4,
          candidatesTokenCount: 2,
          thoughtsTokenCount: 1,
          totalTokenCount: 7,
        },
        modelVersion: "gemini-3.8-flash",
        responseId: "r1",
      },
    ) as Record<string, unknown>;
    assert.equal(out.text, "Hello");
    assert.equal(out.finishReason, "tool_calls");
    assert.equal(out.stopReason, "STOP");
    assert.deepEqual(out.toolCalls, [
      { id: "call_1", name: "get_weather", input: { city: "Oslo" } },
    ]);
    assert.deepEqual(out.usage, { inputTokens: 4, outputTokens: 3, totalTokens: 7 });
    assert.equal(out.model, "gemini-3.8-flash");
    const filtered = result(
      { provider: "gemini", prompt: "Hi" },
      { candidates: [{ finishReason: "SAFETY" }] },
    ) as Record<string, unknown>;
    assert.equal(filtered.finishReason, "content_filter");
    const cut = result(
      { provider: "gemini", prompt: "Hi" },
      { candidates: [{ content: { parts: [{ text: "x" }] }, finishReason: "MAX_TOKENS" }] },
    ) as Record<string, unknown>;
    assert.equal(cut.finishReason, "length");
  });

  it("reads token counts and embeddings", () => {
    assert.deepEqual(
      result(
        { provider: "anthropic", operation: "countTokens", prompt: "x" },
        { input_tokens: 14 },
      ),
      { inputTokens: 14 },
    );
    assert.deepEqual(
      result({ provider: "gemini", operation: "countTokens", prompt: "x" }, { totalTokens: 9 }),
      { inputTokens: 9 },
    );
    const open = result(
      { resource: "embedding", operation: "create", input: "x" },
      { data: [{ embedding: [0.1, 0.2] }], model: "m" },
    ) as Record<string, unknown>;
    assert.deepEqual(open.embedding, [0.1, 0.2]);
    assert.equal(open.dimensions, 2);
    const google = result(
      { provider: "gemini", resource: "embedding", operation: "create", input: "x" },
      { embedding: { values: [1, 2, 3] }, usageMetadata: { promptTokenCount: 1 } },
    ) as Record<string, unknown>;
    assert.deepEqual(google.embedding, [1, 2, 3]);
    assert.equal(google.dimensions, 3);
    assert.equal(google.model, "gemini-embedding-2");
  });

  it("puts images in binary fields", () => {
    const config = { resource: "image", operation: "generate", prompt: "x", outputProperty: "img" };
    const one = result(config, { data: [{ b64_json: "AQI=", revised_prompt: "r" }] }) as {
      binary: Record<string, { data: string; mimeType: string }>;
      revisedPrompts: string[];
    };
    assert.equal(one.binary.img?.data, "AQI=");
    assert.equal(one.binary.img?.mimeType, "image/png");
    assert.deepEqual(one.revisedPrompts, ["r"]);
    const two = result(config, { data: [{ b64_json: "AQI=" }, { b64_json: "AQI=" }] }) as {
      binary: Record<string, unknown>;
    };
    assert.deepEqual(Object.keys(two.binary), ["img_1", "img_2"]);
    assert.throws(() => result(config, { data: [] }), /no image/);
    const google = result(
      { ...config, provider: "gemini" },
      {
        candidates: [
          {
            content: {
              parts: [{ text: "ok" }, { inlineData: { mimeType: "image/jpeg", data: "AQI=" } }],
            },
          },
        ],
      },
    ) as { binary: Record<string, { mimeType: string; fileName: string }> };
    assert.equal(google.binary.img?.mimeType, "image/jpeg");
    assert.equal(google.binary.img?.fileName, "image-1.jpg");
    assert.throws(
      () =>
        result({ ...config, provider: "gemini" }, { candidates: [{ finishReason: "NO_IMAGE" }] }),
      /no image.*NO_IMAGE/,
    );
  });

  it("lists the flagged categories of a moderation", () => {
    const out = result(
      { resource: "moderation", operation: "check", input: "x" },
      {
        results: [
          { flagged: true, categories: { hate: true, violence: false }, category_scores: {} },
        ],
      },
    ) as Record<string, unknown>;
    assert.equal(out.flagged, true);
    assert.deepEqual(out.flaggedCategories, ["hate"]);
  });

  it("puts speech in a binary field", () => {
    const out = result(
      { resource: "audio", operation: "speak", input: "x", speechFormat: "wav" },
      { data: "AQI=", mimeType: "audio/wav; charset=x" },
    ) as { binary: Record<string, { data: string; mimeType: string; fileName: string }> };
    assert.deepEqual(out.binary.data, {
      data: "AQI=",
      mimeType: "audio/wav",
      fileName: "speech.wav",
    });
  });

  it("gives the items of a conversation with the paging data", () => {
    assert.deepEqual(
      result(
        { resource: "conversationItem", operation: "list" },
        { data: [{ id: "msg_1" }], has_more: true, last_id: "msg_1" },
      ),
      { items: [{ id: "msg_1" }], hasMore: true, lastId: "msg_1" },
    );
  });

  it("filters the models by id or name", () => {
    const answer = { data: [{ id: "gpt-6-astra" }, { id: "text-embedding-3-small" }] };
    assert.deepEqual(
      result({ resource: "model", operation: "list", nameFilter: "EMBED" }, answer),
      [{ id: "text-embedding-3-small" }],
    );
    assert.deepEqual(
      result(
        { provider: "gemini", resource: "model", operation: "list", nameFilter: "flash" },
        { data: [{ name: "models/gemini-3.8-flash" }, { name: "models/gemini-4-argon" }] },
      ),
      [{ name: "models/gemini-3.8-flash" }],
    );
  });

  it("unwraps a Gemini file", () => {
    const config = { provider: "gemini", resource: "file" };
    assert.deepEqual(result({ ...config, operation: "upload" }, { file: { name: "files/a1b2" } }), {
      name: "files/a1b2",
    });
    assert.deepEqual(result({ ...config, operation: "delete", fileId: "a1b2" }, {}), {
      deleted: true,
      name: "files/a1b2",
    });
  });
});

describe("ai api", () => {
  it("sends the right headers for each provider", async () => {
    const calls = mockFetch([{ body: {} }, { body: {} }, { body: {} }, { body: {} }]);
    const full = { ...openai, organization: "org-1", project: "proj_1" };
    await callApi(full, { method: "POST", path: "/x", json: { a: 1 } }, options);
    let headers = calls[0]?.init.headers as Record<string, string>;
    assert.equal(headers.authorization, `Bearer ${KEY}`);
    assert.equal(headers["openai-organization"], "org-1");
    assert.equal(headers["openai-project"], "proj_1");
    assert.equal(headers["content-type"], "application/json");
    assert.equal(calls[0]?.url, "https://api.openai.com/v1/x");
    assert.equal(calls[0]?.init.body, '{"a":1}');
    await callApi(anthropic, { method: "POST", path: "/v1/messages", json: { a: 1 } }, options);
    headers = calls[1]?.init.headers as Record<string, string>;
    assert.equal(headers["x-api-key"], KEY);
    assert.equal(headers["anthropic-version"], ANTHROPIC_VERSION);
    assert.equal(headers.authorization, undefined);
    await callApi(gemini, { method: "GET", path: "/models" }, options);
    headers = calls[2]?.init.headers as Record<string, string>;
    assert.equal(headers["x-goog-api-key"], KEY);
    assert.equal(calls[2]?.url, "https://generativelanguage.googleapis.com/v1beta/models");
    await callApi(
      { provider: "compatible", apiKey: undefined, baseUrl: "http://localhost:11434/v1" },
      { method: "GET", path: "/models" },
      options,
    );
    headers = calls[3]?.init.headers as Record<string, string>;
    assert.equal(headers.authorization, undefined);
    assert.equal(calls[3]?.url, "http://localhost:11434/v1/models");
  });

  it("sends a form without a content type and puts the query in the address", async () => {
    const calls = mockFetch([{ body: {} }, { body: {} }]);
    const form = new FormData();
    form.append("model", "m");
    await callApi(openai, { method: "POST", path: "/audio/transcriptions", form }, options);
    const headers = calls[0]?.init.headers as Record<string, string>;
    assert.equal(headers["content-type"], undefined);
    assert.equal(calls[0]?.init.body, form);
    await callApi(
      anthropic,
      { method: "GET", path: "/v1/models", query: { limit: 1, after_id: undefined } },
      options,
    );
    assert.equal(calls[1]?.url, "https://api.anthropic.com/v1/models?limit=1");
    assert.equal(calls[1]?.init.body, undefined);
  });

  it("reads a file answer as base64", async () => {
    mock.method(
      globalThis,
      "fetch",
      async () =>
        new Response(new Uint8Array([1, 2]), { headers: { "content-type": "audio/mpeg" } }),
    );
    const answer = await callApi(
      openai,
      { method: "POST", path: "/audio/speech", json: {}, binary: true },
      options,
    );
    assert.deepEqual(answer, { data: "AQI=", mimeType: "audio/mpeg" });
  });

  it("uploads a Gemini file in two steps", async () => {
    const calls: Call[] = [];
    mock.method(globalThis, "fetch", async (url: URL | string, init: RequestInit) => {
      calls.push({ url: String(url), init });
      if (calls.length === 1) {
        return new Response("{}", { headers: { "x-goog-upload-url": "https://up.test/session1" } });
      }
      return new Response(JSON.stringify({ file: { name: "files/a1b2" } }));
    });
    const answer = await callApi(
      gemini,
      {
        method: "POST",
        path: "/files",
        upload: {
          data: new Uint8Array(new ArrayBuffer(3)),
          mimeType: "application/pdf",
          displayName: "a.pdf",
        },
      },
      options,
    );
    assert.deepEqual(answer, { file: { name: "files/a1b2" } });
    assert.equal(calls[0]?.url, "https://generativelanguage.googleapis.com/upload/v1beta/files");
    const start = calls[0]?.init.headers as Record<string, string>;
    assert.equal(start["x-goog-upload-protocol"], "resumable");
    assert.equal(start["x-goog-upload-command"], "start");
    assert.equal(start["x-goog-upload-header-content-length"], "3");
    assert.equal(start["x-goog-upload-header-content-type"], "application/pdf");
    assert.deepEqual(bodyOf(calls[0]), { file: { displayName: "a.pdf" } });
    assert.equal(calls[1]?.url, "https://up.test/session1");
    const finish = calls[1]?.init.headers as Record<string, string>;
    assert.equal(finish["x-goog-upload-command"], "upload, finalize");
    assert.equal(finish["x-goog-upload-offset"], "0");
    assert.equal(finish["x-goog-api-key"], undefined);
  });

  it("reads the credential of the provider", () => {
    const need = (provider: "openai" | "anthropic" | "gemini" | "compatible") =>
      accessOf(provider, null);
    assert.throws(() => need("openai"), /credential for OpenAI/);
    assert.throws(() => need("compatible"), /compatible service/);
    // A credential of another provider does not fit.
    assert.throws(() => accessOf("gemini", credentials.openai ?? null), /credential for Gemini/);
    assert.throws(() => accessOf("openai", { type: CREDENTIAL_OF.openai, data: {} }), /apiKey/);
    const custom = accessOf("openai", {
      type: "ai.openai",
      data: { apiKey: KEY, baseUrl: "https://llm.test/v1/", organization: " " },
    });
    assert.equal(custom.baseUrl, "https://llm.test/v1");
    assert.equal(custom.organization, undefined);
    assert.equal(
      accessOf("openai", credentials.openai ?? null).baseUrl,
      "https://api.openai.com/v1",
    );
    assert.equal(
      accessOf("anthropic", credentials.anthropic ?? null).baseUrl,
      "https://api.anthropic.com",
    );
    assert.equal(
      accessOf("gemini", credentials.gemini ?? null).baseUrl,
      "https://generativelanguage.googleapis.com/v1beta",
    );
    assert.equal(accessOf("compatible", credentials.compatible ?? null).apiKey, undefined);
  });

  it("allows only https, and http for the same machine", () => {
    const base = (provider: "openai" | "compatible", baseUrl: string) =>
      accessOf(provider, { type: CREDENTIAL_OF[provider], data: { apiKey: KEY, baseUrl } });
    assert.throws(() => base("openai", "ftp://a"), /https:\/\//);
    assert.throws(() => base("openai", "http://llm.test/v1"), /localhost/);
    assert.throws(() => base("compatible", "http://10.0.0.5/v1"), /localhost/);
    assert.throws(() => base("compatible", "nope"), /valid address/);
    assert.equal(
      base("compatible", "http://localhost:11434/v1").baseUrl,
      "http://localhost:11434/v1",
    );
    assert.equal(
      base("compatible", "http://127.0.0.1:8000/v1/").baseUrl,
      "http://127.0.0.1:8000/v1",
    );
    assert.throws(
      () => accessOf("compatible", { type: "ai.compatible", data: {} }),
      /no "baseUrl"/,
    );
  });

  it("gives an error with the code, a hint, and no key", async () => {
    mockFetch([
      { status: 404, body: { error: { message: "No such model", code: "model_not_found" } } },
      {
        status: 401,
        body: {
          type: "error",
          error: { type: "authentication_error", message: "invalid x-api-key" },
        },
        headers: { "request-id": "req_1" },
      },
      { status: 400, body: { error: { code: 400, message: "Bad", status: "INVALID_ARGUMENT" } } },
    ]);
    await assert.rejects(
      callApi(openai, { method: "POST", path: "/chat/completions", json: {} }, options),
      (error: unknown) => {
        assert.ok(error instanceof AIError);
        assert.equal(error.status, 404);
        assert.equal(error.code, "model_not_found");
        assert.match(error.message, /OpenAI POST \/chat\/completions failed \(404\)/);
        assert.match(error.message, /No such model/);
        assert.match(error.message, /does not exist/);
        assert.doesNotMatch(error.message, new RegExp(KEY));
        return true;
      },
    );
    await assert.rejects(
      callApi(anthropic, { method: "GET", path: "/v1/models" }, options),
      (error: unknown) => {
        assert.ok(error instanceof AIError);
        assert.equal(error.code, "authentication_error");
        assert.equal(error.requestId, "req_1");
        assert.match(error.message, /Anthropic did not accept the API key/);
        return true;
      },
    );
    await assert.rejects(
      callApi(gemini, { method: "GET", path: "/models" }, options),
      (error: unknown) => error instanceof AIError && error.code === "INVALID_ARGUMENT",
    );
  });

  it("gives the wait time of a rate limit", async () => {
    mockFetch([{ status: 429, body: {}, headers: { "retry-after": "7" } }]);
    await assert.rejects(
      callApi(openai, { method: "GET", path: "/models" }, options),
      (error: unknown) => {
        assert.ok(error instanceof AIError);
        assert.equal(error.status, 429);
        assert.equal(error.retryAfter, 7);
        assert.match(error.message, /Try again in 7 seconds/);
        return true;
      },
    );
  });

  it("follows the pages of each provider until the limit", async () => {
    const claude = mockFetch([
      { body: { data: [{ id: "a" }, { id: "b" }], has_more: true, last_id: "b" } },
      { body: { data: [{ id: "c" }], has_more: false, last_id: "c" } },
    ]);
    assert.deepEqual(await callList(anthropic, "/v1/models", "data", 100, options), [
      { id: "a" },
      { id: "b" },
      { id: "c" },
    ]);
    assert.match(claude[1]?.url ?? "", /after_id=b/);
    mockFetch([{ body: { data: [{ id: "a" }, { id: "b" }], has_more: true, last_id: "b" } }]);
    assert.deepEqual(await callList(anthropic, "/v1/models", "data", 1, options), [{ id: "a" }]);
    const files = mockFetch([
      { body: { data: [{ id: "file_a" }], next_page: "cursor1" } },
      { body: { data: [{ id: "file_b" }], next_page: null } },
    ]);
    assert.deepEqual(await callList(anthropic, "/v1/files", "data", 100, options), [
      { id: "file_a" },
      { id: "file_b" },
    ]);
    assert.match(files[1]?.url ?? "", /page=cursor1/);
    const google = mockFetch([
      { body: { models: [{ name: "models/a" }], nextPageToken: "t1" } },
      { body: { models: [{ name: "models/b" }] } },
    ]);
    assert.deepEqual(await callList(gemini, "/models", "models", 100, options), [
      { name: "models/a" },
      { name: "models/b" },
    ]);
    assert.match(google[0]?.url ?? "", /pageSize=100/);
    assert.match(google[1]?.url ?? "", /pageToken=t1/);
    const once = mockFetch([{ body: { data: [{ id: "x" }], has_more: true } }]);
    assert.deepEqual(await callList(openai, "/models", "data", 100, options), [{ id: "x" }]);
    assert.equal(once.length, 1);
  });
});

describe("ai node", () => {
  it("has one node and four credential types", () => {
    assert.deepEqual(
      nodes.map((node) => node.type),
      ["ai.api"],
    );
    assert.deepEqual(
      credentialTypes.map((type) => type.type),
      ["ai.openai", "ai.anthropic", "ai.gemini", "ai.compatible"],
    );
    const node = def("ai.api");
    assert.deepEqual(node.credentialTypes, Object.values(CREDENTIAL_OF));
    assert.deepEqual(node.credentialRules?.["ai.gemini"], { showWhen: { provider: ["gemini"] } });
  });

  it("generates text with OpenAI", async () => {
    const calls = mockFetch([
      { body: { model: "m", choices: [{ message: { content: "Hello" }, finish_reason: "stop" }] } },
    ]);
    const out = await run({ prompt: "Hi" });
    assert.equal(out.port, "out");
    assert.equal((out.data as { text: string }).text, "Hello");
    assert.equal(calls[0]?.url, "https://api.openai.com/v1/chat/completions");
  });

  it("generates text with Anthropic", async () => {
    const calls = mockFetch([
      { body: { id: "msg_1", content: [{ type: "text", text: "Hi" }], stop_reason: "end_turn" } },
    ]);
    const out = await run({ provider: "anthropic", prompt: "Hello" });
    assert.equal((out.data as { text: string }).text, "Hi");
    assert.equal(calls[0]?.url, "https://api.anthropic.com/v1/messages");
    assert.equal(bodyOf(calls[0]).max_tokens, 1024);
  });

  it("generates text with Gemini and with a compatible service", async () => {
    const calls = mockFetch([
      { body: { candidates: [{ content: { parts: [{ text: "Yo" }] }, finishReason: "STOP" }] } },
      { body: { choices: [{ message: { content: "Hey" }, finish_reason: "stop" }] } },
    ]);
    const google = await run({ provider: "gemini", prompt: "Hi" });
    assert.equal((google.data as { text: string }).text, "Yo");
    assert.equal(
      calls[0]?.url,
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent",
    );
    const other = await run({ provider: "compatible", prompt: "Hi", customModel: "llama3" });
    assert.equal((other.data as { text: string }).text, "Hey");
    assert.equal(calls[1]?.url, "https://llm.test/v1/chat/completions");
  });

  it("counts tokens and lists models and files", async () => {
    mockFetch([{ body: { input_tokens: 14 } }]);
    const count = await run({ provider: "anthropic", operation: "countTokens", prompt: "Hello" });
    assert.deepEqual(count.data, { inputTokens: 14 });
    mockFetch([{ body: { data: [{ id: "claude-opus-5-5" }], has_more: false, last_id: "x" } }]);
    const models = await run({ provider: "anthropic", resource: "model", operation: "list" });
    assert.deepEqual(models.data, [{ id: "claude-opus-5-5" }]);
    mockFetch([{ body: { files: [{ name: "files/a1b2" }] } }]);
    const files = await run({ provider: "gemini", resource: "file", operation: "list" });
    assert.deepEqual(files.data, [{ name: "files/a1b2" }]);
  });

  it("manages Anthropic files", async () => {
    const calls = mockFetch([
      { body: { id: "file_011CNha8", filename: "a.txt" } },
      { body: { id: "file_011CNha8", type: "file_deleted" } },
    ]);
    const uploaded = await run(
      { provider: "anthropic", resource: "file", operation: "upload" },
      binaryInput("a.txt", "text/plain"),
    );
    assert.deepEqual(uploaded.data, { id: "file_011CNha8", filename: "a.txt" });
    const deleted = await run({
      provider: "anthropic",
      resource: "file",
      operation: "delete",
      fileId: "file_011CNha8",
    });
    assert.deepEqual(deleted.data, { id: "file_011CNha8", type: "file_deleted" });
    assert.equal(calls[1]?.init.method, "DELETE");
    assert.equal(calls[1]?.url, "https://api.anthropic.com/v1/files/file_011CNha8");
  });

  it("runs a conversation operation", async () => {
    const calls = mockFetch([{ body: { id: "conv_1a2b", object: "conversation" } }]);
    const out = await run({
      resource: "conversation",
      operation: "get",
      conversationId: "conv_1a2b",
    });
    assert.equal(calls[0]?.url, "https://api.openai.com/v1/conversations/conv_1a2b");
    assert.deepEqual(out, { port: "out", data: { id: "conv_1a2b", object: "conversation" } });
  });

  it("fails without the credential of the provider", async () => {
    await assert.rejects(run({ prompt: "Hi" }, null, null), /credential for OpenAI/);
    await assert.rejects(
      run({ provider: "anthropic", prompt: "Hi" }, null, credentials.openai ?? null),
      /credential for Anthropic/,
    );
  });
});

describe("ai credential", () => {
  const typeOf = (name: string) => credentialTypes.find((type) => type.type === name);

  it("tests each key with a model read", async () => {
    const calls = mockFetch([{ body: {} }, { body: {} }, { body: {} }, { body: {} }]);
    for (const [provider, credential] of Object.entries(credentials)) {
      await typeOf(CREDENTIAL_OF[provider as keyof typeof CREDENTIAL_OF])?.test?.(
        credential as never,
      );
    }
    assert.deepEqual(
      calls.map((call) => call.url),
      [
        "https://api.openai.com/v1/models",
        "https://api.anthropic.com/v1/models?limit=1",
        "https://generativelanguage.googleapis.com/v1beta/models?pageSize=1",
        "https://llm.test/v1/models",
      ],
    );
  });

  it("fails on a wrong key", async () => {
    mockFetch([{ status: 401, body: { error: { message: "bad" } } }]);
    await assert.rejects(
      typeOf("ai.gemini")?.test?.(credentials.gemini as never) ?? Promise.resolve(),
      /401/,
    );
  });
});
