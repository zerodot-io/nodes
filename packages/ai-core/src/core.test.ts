// SPDX-License-Identifier: AGPL-3.0-only
import assert from "node:assert/strict";
import { afterEach, describe, it, mock } from "node:test";
import { type Access, AIError, chatModelOf, embedTexts, type Message, withRetry } from "./index";

const signal = new AbortController().signal;
// Built at run time, so secret scanners do not flag a fake key.
const KEY = `sk-${"test".repeat(8)}`;
const settings = { model: "m", maxTokens: undefined, temperature: undefined, timeoutMs: 5000 };

afterEach(() => mock.restoreAll());

type Call = { url: string; body: Record<string, unknown> };

function mockFetch(answers: { body: unknown; status?: number }[], calls: Call[] = []) {
  mock.method(globalThis, "fetch", async (url: URL | string, init: RequestInit) => {
    calls.push({ url: String(url), body: JSON.parse(String(init.body ?? "{}")) });
    const answer = answers[calls.length - 1] ?? { body: {} };
    return new Response(JSON.stringify(answer.body), { status: answer.status ?? 200 });
  });
  return calls;
}

const anthropic: Access = {
  provider: "anthropic",
  apiKey: KEY,
  baseUrl: "https://api.anthropic.com",
};
const gemini: Access = {
  provider: "gemini",
  apiKey: KEY,
  baseUrl: "https://generativelanguage.googleapis.com/v1beta",
};

const anthropicAnswer = (content: unknown[], stop = "end_turn") => ({
  id: "msg_1",
  type: "message",
  role: "assistant",
  model: "m",
  content,
  stop_reason: stop,
  usage: { input_tokens: 1, output_tokens: 1 },
});

describe("chat model", () => {
  it("sends the thinking of an answer back with its signature", async () => {
    const thinking = { type: "thinking", thinking: "Let me look", signature: "sig" };
    const use = { type: "tool_use", id: "c1", name: "echo", input: {} };
    const calls = mockFetch([
      { body: anthropicAnswer([thinking, use], "tool_use") },
      { body: anthropicAnswer([{ type: "text", text: "Done" }]) },
    ]);
    const model = chatModelOf(anthropic, settings);
    const tools = [{ name: "echo", description: "Echo", inputSchema: { type: "object" } }];
    const first = await model.chat(
      { system: undefined, messages: [{ role: "user", content: "hi" }], tools },
      signal,
    );
    assert.equal(first.raw?.provider, "ai-sdk:anthropic");
    const messages: Message[] = [
      { role: "user", content: "hi" },
      { role: "assistant", content: first.text, toolCalls: first.toolCalls, raw: first.raw },
      { role: "tool", toolCallId: "c1", name: "echo", content: "{}" },
    ];
    await model.chat({ system: undefined, messages, tools }, signal);
    const sent = calls[1]?.body.messages as { role: string; content: unknown }[];
    assert.deepEqual(sent[1], { role: "assistant", content: [thinking, use] });
  });

  it("reads the raw parts of an older Gemini answer, with the thought signatures", async () => {
    const calls = mockFetch([
      { body: { candidates: [{ content: { parts: [{ text: "ok" }] }, finishReason: "STOP" }] } },
    ]);
    const messages: Message[] = [
      { role: "user", content: "hi" },
      {
        role: "assistant",
        content: "",
        toolCalls: [{ id: "zerodot_call_1", name: "echo", input: { a: 1 } }],
        raw: {
          provider: "gemini",
          content: [{ functionCall: { name: "echo", args: { a: 1 } }, thoughtSignature: "s" }],
        },
      },
      { role: "tool", toolCallId: "zerodot_call_1", name: "echo", content: "1" },
    ];
    const answer = await chatModelOf(gemini, settings).chat(
      { system: undefined, messages, tools: [] },
      signal,
    );
    assert.equal(answer.text, "ok");
    const contents = calls[0]?.body.contents as { parts: unknown[] }[];
    assert.deepEqual(contents[1]?.parts, [
      {
        functionCall: { id: "zerodot_call_1", name: "echo", args: { a: 1 } },
        thoughtSignature: "s",
      },
    ]);
  });

  it("gives the error of the provider, and a rate limit can run again", async () => {
    mockFetch([
      {
        status: 429,
        body: { type: "error", error: { type: "rate_limit_error", message: "Slow" } },
      },
      { body: anthropicAnswer([{ type: "text", text: "Done" }]) },
    ]);
    const model = chatModelOf(anthropic, settings);
    const request = {
      system: undefined,
      messages: [{ role: "user" as const, content: "hi" }],
      tools: [],
    };
    await assert.rejects(model.chat(request, signal), (error: unknown) => {
      assert.ok(error instanceof AIError);
      assert.equal(error.status, 429);
      assert.match(error.message, /^Anthropic chat failed \(429\)\. Slow\. Anthropic limits/);
      return true;
    });
    mockFetch([
      { status: 529, body: { type: "error", error: { type: "overloaded_error" } } },
      { body: anthropicAnswer([{ type: "text", text: "Done" }]) },
    ]);
    const answer = await withRetry(() => model.chat(request, signal), signal, {
      attempts: 2,
      baseMs: 1,
    });
    assert.equal(answer.text, "Done");
  });
});

describe("embeddings", () => {
  it("Anthropic has none", async () => {
    await assert.rejects(
      embedTexts(anthropic, { model: "m", timeoutMs: 5000 }, ["a"], "query", signal),
      /no embedding models/,
    );
  });
});
