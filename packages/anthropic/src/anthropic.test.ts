// SPDX-License-Identifier: AGPL-3.0-only
import assert from "node:assert/strict";
import { afterEach, describe, it, mock } from "node:test";
import type { NodeDefinition } from "@zerodot/node-sdk";
import {
  ANTHROPIC_VERSION,
  AnthropicError,
  anthropicAccess,
  callAnthropic,
  callAnthropicList,
  textOf,
} from "./api";
import { anthropicConfig, MODELS } from "./config";
import { credentialTypes, nodes } from "./index";
import { buildRequest } from "./request";

const signal = new AbortController().signal;
const options = { signal, timeoutMs: 5_000 };
const access = { apiKey: "sk-ant-secret", baseUrl: "https://api.anthropic.com" };
type Cred = { type: string; data: Record<string, unknown> };
const credential: Cred = { type: "anthropic.apiKey", data: { apiKey: "sk-ant-secret" } };

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

const run = async (config: Record<string, unknown>) => {
  const definition = def("anthropic.api");
  return await definition.run({
    config: definition.config.parse(config),
    input: null,
    credential,
    signal,
    scope: {},
    tables: null,
    sandbox: null,
  } as never);
};

const build = (config: Record<string, unknown>) => buildRequest(anthropicConfig.parse(config));

afterEach(() => mock.restoreAll());

describe("anthropic config", () => {
  it("checks that the operation belongs to the resource", () => {
    assert.equal(
      anthropicConfig.safeParse({ resource: "model", operation: "create" }).success,
      false,
    );
    assert.equal(anthropicConfig.safeParse({ resource: "model", operation: "list" }).success, true);
  });

  it("has a label and a hint for each option of each select", () => {
    const options: Record<string, readonly string[]> = {
      resource: ["message", "file", "model"],
      operation: ["create", "countTokens", "upload", "get", "list", "delete"],
      model: [...MODELS, "custom"],
    };
    for (const [key, values] of Object.entries(options)) {
      const meta = (anthropicConfig.shape as Record<string, { meta(): unknown }>)[key]?.meta() as {
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

describe("anthropic request", () => {
  it("builds a message with a system prompt and no temperature", () => {
    const { call, json } = build({ system: "Be brief", prompt: "Hi" });
    assert.equal(call.method, "POST");
    assert.equal(call.path, "/v1/messages");
    assert.equal(json, false);
    assert.deepEqual(call.body, {
      model: "claude-sonnet-5-5",
      max_tokens: 1024,
      system: "Be brief",
      messages: [{ role: "user", content: "Hi" }],
      output_config: undefined,
    });
  });

  it("uses a custom model", () => {
    const { call } = build({ model: "custom", customModel: " claude-opus-4-8 ", prompt: "Hi" });
    assert.equal(call.body?.model, "claude-opus-4-8");
    assert.throws(() => build({ model: "custom", prompt: "Hi" }), /customModel/);
  });

  it("puts images before the text", () => {
    const { call } = build({
      prompt: "What is this?",
      imageUrls: "https://a.test/1.png, https://a.test/2.png",
      imageBase64: "QUJD",
      imageMediaType: "image/webp",
    });
    const messages = call.body?.messages as { content: unknown }[];
    assert.deepEqual(messages[0]?.content, [
      { type: "image", source: { type: "url", url: "https://a.test/1.png" } },
      { type: "image", source: { type: "url", url: "https://a.test/2.png" } },
      { type: "image", source: { type: "base64", media_type: "image/webp", data: "QUJD" } },
      { type: "text", text: "What is this?" },
    ]);
  });

  it("adds files and PDF documents", () => {
    const { call } = build({
      prompt: "Summarize",
      imageFileIds: "file_img1",
      documentUrls: "https://a.test/a.pdf",
      documentFileIds: "file_doc1, file_doc2",
      documentBase64: "QUJD",
    });
    const messages = call.body?.messages as { content: unknown }[];
    assert.deepEqual(messages[0]?.content, [
      { type: "image", source: { type: "file", file_id: "file_img1" } },
      { type: "document", source: { type: "url", url: "https://a.test/a.pdf" } },
      { type: "document", source: { type: "file", file_id: "file_doc1" } },
      { type: "document", source: { type: "file", file_id: "file_doc2" } },
      { type: "document", source: { type: "base64", media_type: "application/pdf", data: "QUJD" } },
      { type: "text", text: "Summarize" },
    ]);
  });

  it("sets the effort only when it is not the default", () => {
    assert.equal(build({ prompt: "Hi" }).call.body?.output_config, undefined);
    assert.deepEqual(build({ prompt: "Hi", effort: "low" }).call.body?.output_config, {
      effort: "low",
    });
    assert.deepEqual(
      build({ prompt: "Hi", effort: "high", jsonSchema: '{"type":"object"}' }).call.body
        ?.output_config,
      { effort: "high", format: { type: "json_schema", schema: { type: "object" } } },
    );
  });

  it("builds the file calls", () => {
    const upload = build({
      resource: "file",
      operation: "upload",
      fileBase64: "QUJD",
      fileName: "a.txt",
      fileMimeType: "text/plain",
      expiresInSeconds: 3600,
    });
    assert.equal(upload.call.path, "/v1/files");
    const file = upload.call.form?.get("file");
    assert.ok(file instanceof File);
    assert.equal(file.name, "a.txt");
    assert.equal(file.type, "text/plain");
    assert.equal(upload.call.form?.get("expires_in_seconds"), "3600");
    assert.throws(
      () => build({ resource: "file", operation: "upload", fileName: "a" }),
      /fileBase64/,
    );
    const get = build({ resource: "file", operation: "get", fileId: "file_011CNha8" });
    assert.deepEqual(get.call, { method: "GET", path: "/v1/files/file_011CNha8" });
    const del = build({ resource: "file", operation: "delete", fileId: "file_011CNha8" });
    assert.equal(del.call.method, "DELETE");
    assert.throws(
      () => build({ resource: "file", operation: "get", fileId: "../v1/models" }),
      /not a file ID/,
    );
    assert.equal(build({ resource: "file", operation: "list" }).list, true);
  });

  it("needs a prompt or an image", () => {
    assert.throws(() => build({}), /needs "prompt"/);
    assert.doesNotThrow(() => build({ imageUrls: "https://a.test/1.png" }));
  });

  it("sets a JSON schema as the output format", () => {
    const { call, json } = build({
      prompt: "Hi",
      jsonSchema: '{"type":"object","properties":{"a":{"type":"string"}}}',
    });
    assert.equal(json, true);
    assert.deepEqual(call.body?.output_config, {
      format: {
        type: "json_schema",
        schema: { type: "object", properties: { a: { type: "string" } } },
      },
    });
    assert.throws(() => build({ prompt: "Hi", jsonSchema: "nope" }), /must be JSON/);
    assert.throws(() => build({ prompt: "Hi", jsonSchema: "[]" }), /JSON object/);
  });

  it("builds a token count without max_tokens", () => {
    const { call } = build({ operation: "countTokens", prompt: "Hi" });
    assert.equal(call.path, "/v1/messages/count_tokens");
    assert.equal("max_tokens" in (call.body ?? {}), false);
  });

  it("builds a model list", () => {
    const request = build({ resource: "model", operation: "list" });
    assert.equal(request.call.path, "/v1/models");
    assert.equal(request.list, true);
  });
});

describe("anthropic api", () => {
  it("sends the key, the version, and a JSON body", async () => {
    const calls = mockFetch([{ body: { id: "msg_1" } }]);
    const answer = await callAnthropic(
      access,
      { method: "POST", path: "/v1/messages", body: { a: 1 } },
      options,
    );
    assert.deepEqual(answer, { id: "msg_1" });
    const headers = calls[0]?.init.headers as Record<string, string>;
    assert.equal(headers["x-api-key"], "sk-ant-secret");
    assert.equal(headers["anthropic-version"], ANTHROPIC_VERSION);
    assert.equal(headers["content-type"], "application/json");
    assert.deepEqual(bodyOf(calls[0]), { a: 1 });
  });

  it("puts the query of a GET in the address", async () => {
    const calls = mockFetch([{ body: {} }]);
    await callAnthropic(
      access,
      { method: "GET", path: "/v1/models", query: { limit: 1, after_id: undefined } },
      options,
    );
    assert.equal(calls[0]?.url, "https://api.anthropic.com/v1/models?limit=1");
    assert.equal(calls[0]?.init.body, undefined);
  });

  it("reads the base address of the credential", () => {
    assert.equal(
      anthropicAccess({
        type: "anthropic.apiKey",
        data: { apiKey: "k", baseUrl: "https://gw.test/" },
      }).baseUrl,
      "https://gw.test",
    );
    assert.equal(anthropicAccess(credential).baseUrl, "https://api.anthropic.com");
    assert.throws(
      () =>
        anthropicAccess({ type: "anthropic.apiKey", data: { apiKey: "k", baseUrl: "ftp://x" } }),
      /baseUrl/,
    );
  });

  it("explains an error and never shows the key", async () => {
    mockFetch([
      {
        status: 401,
        body: {
          type: "error",
          error: { type: "authentication_error", message: "invalid x-api-key" },
        },
        headers: { "request-id": "req_1" },
      },
    ]);
    await assert.rejects(
      callAnthropic(access, { method: "GET", path: "/v1/models" }, options),
      (error: unknown) => {
        assert.ok(error instanceof AnthropicError);
        assert.equal(error.status, 401);
        assert.equal(error.type, "authentication_error");
        assert.equal(error.requestId, "req_1");
        assert.match(error.message, /did not accept the API key/);
        assert.doesNotMatch(error.message, /sk-ant-secret/);
        return true;
      },
    );
  });

  it("reads Retry-After of a rate limit", async () => {
    mockFetch([{ status: 429, body: {}, headers: { "retry-after": "12" } }]);
    await assert.rejects(
      callAnthropic(access, { method: "GET", path: "/v1/models" }, options),
      (error: unknown) => error instanceof AnthropicError && error.retryAfter === 12,
    );
  });

  it("follows the pages of a list until the limit", async () => {
    const calls = mockFetch([
      { body: { data: [{ id: "a" }, { id: "b" }], has_more: true, last_id: "b" } },
      { body: { data: [{ id: "c" }], has_more: false, last_id: "c" } },
    ]);
    const items = await callAnthropicList(access, "/v1/models", null, options);
    assert.deepEqual(items, [{ id: "a" }, { id: "b" }, { id: "c" }]);
    assert.match(calls[1]?.url ?? "", /after_id=b/);
    mockFetch([{ body: { data: [{ id: "a" }, { id: "b" }], has_more: true, last_id: "b" } }]);
    assert.deepEqual(await callAnthropicList(access, "/v1/models", 1, options), [{ id: "a" }]);
  });

  it("sends a form for an upload and follows next_page", async () => {
    const form = new FormData();
    form.set("file", new Blob(["x"]), "a.txt");
    const calls = mockFetch([{ body: { id: "file_1" } }]);
    await callAnthropic(access, { method: "POST", path: "/v1/files", form }, options);
    const headers = calls[0]?.init.headers as Record<string, string>;
    assert.equal(headers["content-type"], undefined);
    assert.ok(calls[0]?.init.body instanceof FormData);
    const pages = mockFetch([
      { body: { data: [{ id: "file_a" }], next_page: "cursor1" } },
      { body: { data: [{ id: "file_b" }], next_page: null } },
    ]);
    const items = await callAnthropicList(access, "/v1/files", null, options);
    assert.deepEqual(items, [{ id: "file_a" }, { id: "file_b" }]);
    assert.match(pages[1]?.url ?? "", /page=cursor1/);
  });

  it("joins the text blocks", () => {
    assert.equal(
      textOf({
        content: [
          { type: "text", text: "Hello " },
          { type: "thinking" },
          { type: "text", text: "Ada" },
        ],
      }),
      "Hello Ada",
    );
  });
});

describe("anthropic node", () => {
  it("returns the text and the answer", async () => {
    mockFetch([
      {
        body: {
          id: "msg_1",
          content: [{ type: "text", text: "Hi" }],
          stop_reason: "end_turn",
          usage: { input_tokens: 3, output_tokens: 1 },
        },
      },
    ]);
    const result = await run({ prompt: "Hello" });
    assert.equal(result.port, "out");
    assert.deepEqual(result.data, {
      text: "Hi",
      id: "msg_1",
      content: [{ type: "text", text: "Hi" }],
      stop_reason: "end_turn",
      usage: { input_tokens: 3, output_tokens: 1 },
    });
  });

  it("parses the JSON of a structured answer", async () => {
    mockFetch([{ body: { content: [{ type: "text", text: '{"a":"x"}' }] } }]);
    const result = await run({ prompt: "Hello", jsonSchema: '{"type":"object"}' });
    assert.deepEqual((result.data as { json: unknown }).json, { a: "x" });
    mockFetch([{ body: { content: [{ type: "text", text: "not json" }] } }]);
    await assert.rejects(
      run({ prompt: "Hello", jsonSchema: '{"type":"object"}' }),
      /not valid JSON/,
    );
  });

  it("counts tokens", async () => {
    mockFetch([{ body: { input_tokens: 14 } }]);
    const result = await run({ operation: "countTokens", prompt: "Hello" });
    assert.deepEqual(result.data, { input_tokens: 14 });
  });

  it("lists models", async () => {
    mockFetch([{ body: { data: [{ id: "claude-opus-5-5" }], has_more: false, last_id: "x" } }]);
    const result = await run({ resource: "model", operation: "list" });
    assert.deepEqual(result.data, [{ id: "claude-opus-5-5" }]);
  });

  it("manages files", async () => {
    const calls = mockFetch([
      { body: { id: "file_011CNha8", filename: "a.txt" } },
      { body: { id: "file_011CNha8", type: "file_deleted" } },
    ]);
    const uploaded = await run({
      resource: "file",
      operation: "upload",
      fileBase64: "QUJD",
      fileName: "a.txt",
    });
    assert.deepEqual(uploaded.data, { id: "file_011CNha8", filename: "a.txt" });
    const deleted = await run({ resource: "file", operation: "delete", fileId: "file_011CNha8" });
    assert.deepEqual(deleted.data, { id: "file_011CNha8", type: "file_deleted" });
    assert.equal(calls[1]?.init.method, "DELETE");
    assert.equal(calls[1]?.url, "https://api.anthropic.com/v1/files/file_011CNha8");
  });

  it("needs an Anthropic credential", async () => {
    const definition = def("anthropic.api");
    await assert.rejects(
      async () =>
        await definition.run({
          config: definition.config.parse({ prompt: "Hi" }),
          input: null,
          credential: null,
          signal,
          scope: {},
          tables: null,
          sandbox: null,
        } as never),
      /Anthropic credential/,
    );
  });
});

describe("anthropic credential", () => {
  it("reads one model to test the key", async () => {
    const calls = mockFetch([{ body: { data: [] } }]);
    await credentialTypes[0]?.test?.(credential as never);
    assert.equal(calls[0]?.url, "https://api.anthropic.com/v1/models?limit=1");
  });

  it("fails on a wrong key", async () => {
    mockFetch([{ status: 401, body: { error: { type: "authentication_error", message: "bad" } } }]);
    await assert.rejects(
      credentialTypes[0]?.test?.(credential as never) ?? Promise.resolve(),
      /401/,
    );
  });
});
