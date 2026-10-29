// SPDX-License-Identifier: AGPL-3.0-only
import assert from "node:assert/strict";
import { afterEach, describe, it, mock } from "node:test";
import { type NodeDefinition, toBinary } from "@zerodot/node-sdk";
import { callOpenAI, OpenAIError, openaiAccess } from "./api";
import { openaiConfig } from "./config";
import { credentialTypes, nodes } from "./index";
import { TEXT_MODELS } from "./models";
import { buildRequest, resultOf } from "./request";

const signal = new AbortController().signal;
const options = { signal, timeoutMs: 5_000 };
// Built at run time, so secret scanners do not flag a fake key.
const KEY = `sk-${"test".repeat(8)}`;
const access = { apiKey: KEY, baseUrl: "https://api.openai.com/v1" };
type Cred = { type: string; data: Record<string, unknown> };
const credential: Cred = { type: "openai.api", data: { apiKey: KEY } };

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

const run = async (config: Record<string, unknown>, input: unknown = null, cred = credential) => {
  const definition = def("openai.api");
  return await definition.run({
    config: definition.config.parse(config),
    input,
    credential: cred,
    signal,
    scope: {},
    tables: null,
    sandbox: null,
  } as never);
};

const build = (config: Record<string, unknown>, input: unknown = null) =>
  buildRequest(openaiConfig.parse(config), input);
const result = (config: Record<string, unknown>, answer: Record<string, unknown>) =>
  resultOf(openaiConfig.parse(config), answer);

afterEach(() => mock.restoreAll());

describe("openai config", () => {
  it("checks that the operation belongs to the resource", () => {
    assert.equal(
      openaiConfig.safeParse({ resource: "model", operation: "generate" }).success,
      false,
    );
    assert.equal(openaiConfig.safeParse({ resource: "model", operation: "list" }).success, true);
  });

  it("has a label and a hint for each option of each select", () => {
    const shape = openaiConfig.shape as Record<string, { meta(): unknown }>;
    const options: Record<string, readonly string[]> = {
      resource: ["text", "embedding", "image", "moderation", "audio", "file", "model"],
      operation: [
        "generate",
        "create",
        "edit",
        "check",
        "transcribe",
        "translate",
        "speak",
        "upload",
        "list",
        "delete",
      ],
      translationModel: ["whisper-1", "custom"],
      speechModel: ["gpt-4o-mini-tts", "custom"],
      speechFormat: ["mp3", "opus", "aac", "flac", "wav", "pcm"],
      textModel: [...TEXT_MODELS.map((model) => model.id), "custom"],
      embeddingModel: ["text-embedding-3-small", "text-embedding-3-large", "custom"],
      imageModel: ["gpt-image-2.5-sunburst", "gpt-image-2.5-flare", "gpt-image-2", "custom"],
      moderationModel: ["omni-moderation-latest", "custom"],
      audioModel: ["gpt-transcribe", "custom"],
      responseFormat: ["text", "json_object", "json_schema"],
      size: ["auto", "1024x1024", "1536x1024", "1024x1536"],
      quality: ["auto", "low", "medium", "high"],
      outputFormat: ["png", "jpeg", "webp"],
      background: ["auto", "opaque", "transparent"],
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
});

describe("openai request", () => {
  it("builds a chat call with a system prompt and options", () => {
    const call = build({
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
    });
  });

  it("needs a prompt", () => {
    assert.throws(() => build({}), /prompt/);
  });

  it("uses a custom model id", () => {
    const call = build({ prompt: "Hi", textModel: "custom", customModel: " my-model " });
    assert.equal(call.json?.model, "my-model");
    assert.throws(() => build({ prompt: "Hi", textModel: "custom" }), /customModel/);
  });

  it("sends images from URLs and from a binary field", () => {
    const input = { binary: { data: toBinary(new Uint8Array([1, 2]), "a.png", "image/png") } };
    const call = build(
      {
        prompt: "What is it?",
        imageUrls: "https://a.test/1.png, https://a.test/2.png",
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
    assert.match(JSON.stringify(parts[3]), /data:image\/png;base64,AQI=/);
  });

  it("sets JSON mode and a JSON schema", () => {
    assert.deepEqual(build({ prompt: "Hi", responseFormat: "json_object" }).json?.response_format, {
      type: "json_object",
    });
    const call = build({
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

  it("builds an embedding call", () => {
    const call = build({
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
    const call = build({
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
    const text = build({ resource: "moderation", operation: "check", input: "Hello" });
    assert.equal(text.path, "/moderations");
    assert.deepEqual(text.json, { model: "omni-moderation-latest", input: "Hello" });
    const image = build({
      resource: "moderation",
      operation: "check",
      input: "Hello",
      imageUrls: "https://a.test/1.png",
    });
    assert.deepEqual(image.json?.input, [
      { type: "text", text: "Hello" },
      { type: "image_url", image_url: { url: "https://a.test/1.png" } },
    ]);
    assert.throws(() => build({ resource: "moderation", operation: "check" }), /input/);
  });

  it("builds a transcription upload from a binary field", () => {
    const input = { binary: { data: toBinary(new Uint8Array([1, 2, 3]), "a.mp3", "audio/mpeg") } };
    const call = build({ resource: "audio", operation: "transcribe", language: "en" }, input);
    assert.equal(call.path, "/audio/transcriptions");
    assert.equal(call.json, undefined);
    const file = call.form?.get("file");
    assert.ok(file instanceof File);
    assert.equal(file.name, "a.mp3");
    assert.equal(file.size, 3);
    assert.equal(call.form?.get("model"), "gpt-transcribe");
    assert.equal(call.form?.get("language"), "en");
    assert.throws(() => build({ resource: "audio", operation: "transcribe" }, {}));
  });

  it("builds a translation upload and leaves out the language", () => {
    const input = { binary: { data: toBinary(new Uint8Array([1]), "a.mp3", "audio/mpeg") } };
    const call = build(
      { resource: "audio", operation: "translate", language: "fr", transcriptionPrompt: "Ada" },
      input,
    );
    assert.equal(call.path, "/audio/translations");
    assert.equal(call.form?.get("model"), "whisper-1");
    assert.equal(call.form?.get("language"), null);
    assert.equal(call.form?.get("prompt"), "Ada");
  });

  it("builds a speech call that wants a file", () => {
    const call = build({
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
    const input = { binary: { data: toBinary(new Uint8Array([1]), "a.png", "image/png") } };
    const call = build(
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
    assert.throws(() => build({ resource: "image", operation: "edit", prompt: "x" }, {}));
  });

  it("builds file calls and checks the file ID", () => {
    const input = {
      binary: { data: toBinary(new Uint8Array([1]), "d.jsonl", "application/jsonl") },
    };
    const upload = build({ resource: "file", operation: "upload", purpose: "batch" }, input);
    assert.equal(upload.path, "/files");
    assert.equal(upload.form?.get("purpose"), "batch");
    assert.deepEqual(build({ resource: "file", operation: "list" }), {
      method: "GET",
      path: "/files",
    });
    assert.deepEqual(build({ resource: "file", operation: "delete", fileId: "file-abc123" }), {
      method: "DELETE",
      path: "/files/file-abc123",
    });
    assert.throws(() => build({ resource: "file", operation: "delete" }), /fileId/);
    assert.throws(
      () => build({ resource: "file", operation: "delete", fileId: "../models" }),
      /not a file ID/,
    );
  });

  it("builds a list call", () => {
    assert.deepEqual(build({ resource: "model", operation: "list" }), {
      method: "GET",
      path: "/models",
    });
  });
});

describe("openai result", () => {
  it("reads the text, the JSON, and the usage of a chat answer", () => {
    const answer = {
      id: "c1",
      model: "gpt-6.1-terra",
      choices: [{ message: { content: '{"a":1}' }, finish_reason: "stop" }],
      usage: { total_tokens: 5 },
    };
    const out = result({ prompt: "Hi", responseFormat: "json_object" }, answer) as Record<
      string,
      unknown
    >;
    assert.equal(out.text, '{"a":1}');
    assert.deepEqual(out.json, { a: 1 });
    assert.equal(out.finishReason, "stop");
    assert.deepEqual(out.usage, { total_tokens: 5 });
    const plain = result({ prompt: "Hi" }, answer) as Record<string, unknown>;
    assert.equal(plain.json, undefined);
  });

  it("reads an embedding", () => {
    const out = result(
      { resource: "embedding", operation: "create", input: "x" },
      { data: [{ embedding: [0.1, 0.2] }], model: "m" },
    ) as Record<string, unknown>;
    assert.deepEqual(out.embedding, [0.1, 0.2]);
    assert.equal(out.dimensions, 2);
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

  it("filters the models by name", () => {
    const answer = { data: [{ id: "gpt-6-astra" }, { id: "text-embedding-3-small" }] };
    assert.deepEqual(
      result({ resource: "model", operation: "list", nameFilter: "EMBED" }, answer),
      [{ id: "text-embedding-3-small" }],
    );
  });
});

describe("openai api", () => {
  it("sends the key, the organization, and the project", async () => {
    const calls = mockFetch([{ body: { ok: true } }]);
    const full = { ...access, organization: "org-1", project: "proj_1" };
    await callOpenAI(full, { method: "POST", path: "/x", json: { a: 1 } }, options);
    const headers = calls[0]?.init.headers as Record<string, string>;
    assert.equal(headers.authorization, `Bearer ${KEY}`);
    assert.equal(headers["openai-organization"], "org-1");
    assert.equal(headers["openai-project"], "proj_1");
    assert.equal(headers["content-type"], "application/json");
    assert.equal(calls[0]?.url, "https://api.openai.com/v1/x");
    assert.equal(calls[0]?.init.body, '{"a":1}');
  });

  it("uses a custom base URL and sends a form without a content type", async () => {
    const calls = mockFetch([{ body: {} }]);
    const form = new FormData();
    form.append("model", "m");
    await callOpenAI(
      { ...access, baseUrl: "http://localhost:11434/v1" },
      { method: "POST", path: "/audio/transcriptions", form },
      options,
    );
    assert.equal(calls[0]?.url, "http://localhost:11434/v1/audio/transcriptions");
    const headers = calls[0]?.init.headers as Record<string, string>;
    assert.equal(headers["content-type"], undefined);
    assert.equal(calls[0]?.init.body, form);
  });

  it("reads a file answer as base64", async () => {
    mock.method(
      globalThis,
      "fetch",
      async () =>
        new Response(new Uint8Array([1, 2]), { headers: { "content-type": "audio/mpeg" } }),
    );
    const answer = await callOpenAI(
      access,
      { method: "POST", path: "/audio/speech", json: {}, binary: true },
      options,
    );
    assert.deepEqual(answer, { data: "AQI=", mimeType: "audio/mpeg" });
  });

  it("sends a DELETE", async () => {
    const calls = mockFetch([{ body: { deleted: true } }]);
    await callOpenAI(access, { method: "DELETE", path: "/files/file-1" }, options);
    assert.equal(calls[0]?.init.method, "DELETE");
    assert.equal(calls[0]?.init.body, undefined);
  });

  it("reads the credential", () => {
    assert.throws(() => openaiAccess(null), /needs an OpenAI credential/);
    assert.throws(() => openaiAccess({ type: "x", data: {} }), /needs an OpenAI credential/);
    assert.throws(() => openaiAccess({ type: "openai.api", data: {} }), /apiKey/);
    assert.throws(
      () => openaiAccess({ type: "openai.api", data: { apiKey: KEY, baseUrl: "ftp://a" } }),
      /https/,
    );
    assert.throws(
      () => openaiAccess({ type: "openai.api", data: { apiKey: KEY, baseUrl: "nope" } }),
      /valid address/,
    );
    const custom = openaiAccess({
      type: "openai.api",
      data: { apiKey: KEY, baseUrl: "https://llm.test/v1/", organization: " " },
    });
    assert.equal(custom.baseUrl, "https://llm.test/v1");
    assert.equal(custom.organization, undefined);
    assert.equal(openaiAccess(credential).baseUrl, "https://api.openai.com/v1");
  });

  it("gives an error with the code, a hint, and no key", async () => {
    mockFetch([
      {
        status: 404,
        body: { error: { message: "No such model", code: "model_not_found" } },
      },
    ]);
    await assert.rejects(
      callOpenAI(access, { method: "POST", path: "/chat/completions", json: {} }, options),
      (error: unknown) => {
        assert.ok(error instanceof OpenAIError);
        assert.equal(error.status, 404);
        assert.equal(error.code, "model_not_found");
        assert.match(error.message, /No such model/);
        assert.match(error.message, /does not exist/);
        assert.doesNotMatch(error.message, new RegExp(KEY));
        return true;
      },
    );
  });

  it("gives a status hint when there is no code", async () => {
    mockFetch([{ status: 401, body: { error: { message: "Bad key" } } }]);
    await assert.rejects(
      callOpenAI(access, { method: "GET", path: "/models" }, options),
      /API key/,
    );
  });

  it("gives the wait time of a rate limit", async () => {
    mockFetch([{ status: 429, body: {}, headers: { "retry-after": "7" } }]);
    await assert.rejects(
      callOpenAI(access, { method: "GET", path: "/models" }, options),
      (error: unknown) => {
        assert.ok(error instanceof OpenAIError);
        assert.equal(error.status, 429);
        assert.equal(error.retryAfter, 7);
        assert.match(error.message, /Try again in 7 seconds/);
        return true;
      },
    );
  });
});

describe("openai node", () => {
  it("has one node and one credential type", () => {
    assert.deepEqual(
      nodes.map((node) => node.type),
      ["openai.api"],
    );
    assert.deepEqual(
      credentialTypes.map((type) => type.type),
      ["openai.api"],
    );
  });

  it("generates text", async () => {
    const calls = mockFetch([
      { body: { model: "m", choices: [{ message: { content: "Hello" }, finish_reason: "stop" }] } },
    ]);
    const out = await run({ prompt: "Hi" });
    assert.equal(out.port, "out");
    assert.equal((out.data as { text: string }).text, "Hello");
    assert.equal(calls[0]?.url, "https://api.openai.com/v1/chat/completions");
  });

  it("fails without a credential", async () => {
    await assert.rejects(run({ prompt: "Hi" }, null, null as never), /needs an OpenAI credential/);
  });

  it("tests the credential with the model list", async () => {
    const calls = mockFetch([{ body: { data: [] } }]);
    const type = credentialTypes[0];
    await type?.test?.(credential);
    assert.equal(calls[0]?.url, "https://api.openai.com/v1/models");
    mockFetch([{ status: 401, body: { error: { message: "Bad key" } } }]);
    await assert.rejects(type?.test?.(credential) ?? Promise.resolve(), /401/);
  });
});
