// SPDX-License-Identifier: AGPL-3.0-only
import assert from "node:assert/strict";
import { afterEach, describe, it, mock } from "node:test";
import type { NodeRunContext } from "@zerodot/node-sdk";
import { z } from "zod";
import { credentialTypes as aiCredentialTypes } from "../../ai/src/index";
import * as aiModels from "../../ai/src/models";
import { resultText, runAgent } from "./agent";
import { credentialTypes, nodes } from "./index";
import { readMessages, tableMemory } from "./memory";
import { type ChatModel, chatModelOf, type Message, type ModelTurn } from "./model";
import * as models from "./models";
import { readToolRows, type Tool } from "./tools";

const signal = new AbortController().signal;
// Built at run time, so secret scanners do not flag a fake key.
const KEY = `sk-${"test".repeat(8)}`;
const def = nodes[0];
if (!def) throw new Error("no node");

afterEach(() => mock.restoreAll());

type Call = { url: string; body: Record<string, unknown> };

/** Answers the model calls in order, and keeps the bodies. */
function mockFetch(answers: unknown[], calls: Call[] = []) {
  mock.method(globalThis, "fetch", async (url: URL | string, init: RequestInit) => {
    calls.push({ url: String(url), body: JSON.parse(String(init.body ?? "{}")) });
    return new Response(JSON.stringify(answers[calls.length - 1] ?? {}), { status: 200 });
  });
  return calls;
}

const turn = (text: string, toolCalls: ModelTurn["toolCalls"] = []): ModelTurn => ({
  text,
  toolCalls,
  finishReason: toolCalls.length > 0 ? "tool_calls" : "stop",
  usage: { inputTokens: 10, outputTokens: 5 },
});

/** A model that gives the turns in order, and keeps the messages of each call. */
function fakeModel(turns: ModelTurn[]) {
  const seen: Message[][] = [];
  const model: ChatModel = {
    async chat(request) {
      seen.push(request.messages);
      return turns[seen.length - 1] ?? turn("done");
    },
  };
  return { model, seen };
}

const echo: Tool = {
  spec: { name: "echo", description: "Echo", inputSchema: { type: "object" } },
  call: async (input) => ({ echoed: input }),
};

const agentOptions = {
  system: undefined,
  prompt: "hi",
  previous: [],
  maxIterations: 5,
  maxResultChars: 1000,
  maxTokens: undefined,
  temperature: undefined,
  signal,
};

describe("credentials and models", () => {
  it("are the same as the ones of @zerodot/ai", () => {
    const shape = (list: typeof credentialTypes) =>
      list.map((type) => ({
        type: type.type,
        label: type.label,
        secretFields: type.secretFields,
        icon: type.icon,
        iconUrl: type.iconUrl,
        fields: z.toJSONSchema(type.fields),
      }));
    assert.deepEqual(shape(credentialTypes), shape(aiCredentialTypes));
  });

  it("has the chat models of @zerodot/ai", () => {
    assert.deepEqual(models.OPENAI_TEXT_MODELS, aiModels.OPENAI_TEXT_MODELS);
    assert.deepEqual(models.ANTHROPIC_MODELS, aiModels.ANTHROPIC_MODELS);
    assert.deepEqual(models.GEMINI_TEXT_MODELS, aiModels.GEMINI_TEXT_MODELS);
  });
});

describe("runAgent", () => {
  it("calls a tool, gives the result to the model, and returns the answer", async () => {
    const { model, seen } = fakeModel([
      turn("", [{ id: "c1", name: "echo", input: { a: 1 } }]),
      turn("The answer"),
    ]);
    const result = await runAgent({ ...agentOptions, model, tools: [echo] });
    assert.equal(result.output, "The answer");
    assert.equal(result.finishReason, "stop");
    assert.deepEqual(result.steps, [
      { tool: "echo", input: { a: 1 }, result: '{"echoed":{"a":1}}', error: false },
    ]);
    assert.deepEqual(result.usage, { inputTokens: 20, outputTokens: 10 });
    assert.deepEqual(seen[1]?.at(-1), {
      role: "tool",
      toolCallId: "c1",
      name: "echo",
      content: '{"echoed":{"a":1}}',
    });
    assert.equal(result.history.length, 4);
  });

  it("gives a tool error and an unknown tool to the model", async () => {
    const failing: Tool = {
      spec: { name: "bad", description: "Fails", inputSchema: { type: "object" } },
      call: async () => {
        throw new Error("no such user");
      },
    };
    const { model } = fakeModel([
      turn("", [
        { id: "c1", name: "bad", input: {} },
        { id: "c2", name: "missing", input: {} },
      ]),
      turn("Sorry"),
    ]);
    const result = await runAgent({ ...agentOptions, model, tools: [failing] });
    assert.deepEqual(
      result.steps.map((step) => [step.tool, step.result, step.error]),
      [
        ["bad", "Error: no such user", true],
        ["missing", 'Error: There is no tool "missing"', true],
      ],
    );
    assert.equal(result.output, "Sorry");
  });

  it("stops at the limit of model calls", async () => {
    const call = { id: "c", name: "echo", input: {} };
    const { model, seen } = fakeModel([turn("a", [call]), turn("b", [call]), turn("c", [call])]);
    const result = await runAgent({ ...agentOptions, model, tools: [echo], maxIterations: 2 });
    assert.equal(seen.length, 2);
    assert.equal(result.finishReason, "max_iterations");
    assert.equal(result.output, "b");
  });

  it("runs at most 3 tools at the same time, and keeps their order", async () => {
    let running = 0;
    let most = 0;
    const slow: Tool = {
      spec: { name: "slow", description: "Slow", inputSchema: { type: "object" } },
      call: async (input) => {
        running++;
        most = Math.max(most, running);
        await new Promise((resolve) => setTimeout(resolve, 5));
        running--;
        return input;
      },
    };
    const calls = [1, 2, 3, 4, 5].map((n) => ({ id: `c${n}`, name: "slow", input: n }));
    const { model, seen } = fakeModel([turn("", calls), turn("ok")]);
    await runAgent({ ...agentOptions, model, tools: [slow] });
    assert.equal(most, 3);
    const results = (seen[1] ?? []).filter((message) => message.role === "tool");
    assert.deepEqual(
      results.map((message) => message.content),
      ["1", "2", "3", "4", "5"],
    );
  });

  it("stops when the run stops", async () => {
    const controller = new AbortController();
    const stopper: Tool = {
      ...echo,
      call: async () => {
        controller.abort(new Error("The run stopped"));
        throw new Error("aborted");
      },
    };
    const { model } = fakeModel([turn("", [{ id: "c", name: "echo", input: {} }])]);
    await assert.rejects(
      runAgent({ ...agentOptions, model, tools: [stopper], signal: controller.signal }),
      /The run stopped/,
    );
  });

  it("cuts a long result", () => {
    const text = resultText("x".repeat(150), 100);
    assert.ok(text.startsWith("x".repeat(100)));
    assert.match(text, /It had 150 characters/);
  });
});

describe("chat models", () => {
  const history: Message[] = [
    { role: "user", content: "hi" },
    { role: "assistant", content: "", toolCalls: [{ id: "c1", name: "echo", input: { a: 1 } }] },
    { role: "tool", toolCallId: "c1", name: "echo", content: "1" },
    { role: "tool", toolCallId: "c2", name: "echo", content: "boom", isError: true },
  ];
  const request = {
    system: "Be brief",
    messages: history,
    tools: [echo.spec],
    maxTokens: undefined,
    temperature: 0.2,
  };

  it("OpenAI: sends tool calls and results, and reads an answer", async () => {
    const calls = mockFetch([
      {
        choices: [
          {
            finish_reason: "tool_calls",
            message: {
              content: null,
              tool_calls: [{ id: "c3", function: { name: "echo", arguments: '{"b":2}' } }],
            },
          },
        ],
        usage: { prompt_tokens: 7, completion_tokens: 3 },
      },
    ]);
    const access = {
      provider: "openai" as const,
      apiKey: KEY,
      baseUrl: "https://api.openai.com/v1",
    };
    const answer = await chatModelOf(access, "gpt-6.1-terra", 5000).chat(request, signal);
    assert.deepEqual(answer.toolCalls, [{ id: "c3", name: "echo", input: { b: 2 } }]);
    assert.deepEqual(answer.usage, { inputTokens: 7, outputTokens: 3 });
    const body = calls[0]?.body ?? {};
    assert.equal(calls[0]?.url, "https://api.openai.com/v1/chat/completions");
    assert.deepEqual(body.messages, [
      { role: "system", content: "Be brief" },
      { role: "user", content: "hi" },
      {
        role: "assistant",
        content: null,
        tool_calls: [
          { id: "c1", type: "function", function: { name: "echo", arguments: '{"a":1}' } },
        ],
      },
      { role: "tool", tool_call_id: "c1", content: "1" },
      { role: "tool", tool_call_id: "c2", content: "boom" },
    ]);
    assert.deepEqual(body.tools, [
      {
        type: "function",
        function: { name: "echo", description: "Echo", parameters: { type: "object" } },
      },
    ]);
  });

  it("Anthropic: puts tool results in one user turn, and sends raw content back", async () => {
    const raw = [
      { type: "thinking", thinking: "…", signature: "sig" },
      { type: "tool_use", id: "c1", name: "echo", input: { a: 1 } },
    ];
    const calls = mockFetch([
      { content: [{ type: "text", text: "Done" }], stop_reason: "end_turn", usage: {} },
    ]);
    const access = {
      provider: "anthropic" as const,
      apiKey: KEY,
      baseUrl: "https://api.anthropic.com",
    };
    const messages: Message[] = [
      history[0] as Message,
      {
        role: "assistant",
        content: "",
        toolCalls: [{ id: "c1", name: "echo", input: { a: 1 } }],
        raw: { provider: "anthropic", content: raw },
      },
      ...history.slice(2),
    ];
    const answer = await chatModelOf(access, "claude-sonnet-5-5", 5000).chat(
      { ...request, messages, temperature: undefined },
      signal,
    );
    assert.equal(answer.text, "Done");
    assert.equal(answer.finishReason, "stop");
    const body = calls[0]?.body ?? {};
    assert.equal(body.max_tokens, 4096);
    assert.equal(body.system, "Be brief");
    assert.deepEqual(body.messages, [
      { role: "user", content: [{ type: "text", text: "hi" }] },
      { role: "assistant", content: raw },
      {
        role: "user",
        content: [
          { type: "tool_result", tool_use_id: "c1", content: "1" },
          { type: "tool_result", tool_use_id: "c2", content: "boom", is_error: true },
        ],
      },
    ]);
  });

  it("Gemini: sends function responses, and reads function calls", async () => {
    const calls = mockFetch([
      {
        candidates: [
          {
            finishReason: "STOP",
            content: {
              parts: [{ functionCall: { name: "echo", args: { c: 3 } }, thoughtSignature: "s" }],
            },
          },
        ],
        usageMetadata: { promptTokenCount: 4, candidatesTokenCount: 2, thoughtsTokenCount: 1 },
      },
    ]);
    const access = {
      provider: "gemini" as const,
      apiKey: KEY,
      baseUrl: "https://generativelanguage.googleapis.com/v1beta",
    };
    const answer = await chatModelOf(access, "gemini-3.8-flash", 5000).chat(request, signal);
    assert.deepEqual(answer.toolCalls, [{ id: "zerodot_call_1", name: "echo", input: { c: 3 } }]);
    assert.equal(answer.finishReason, "tool_calls");
    assert.deepEqual(answer.usage, { inputTokens: 4, outputTokens: 3 });
    assert.deepEqual(answer.raw?.content, [
      { functionCall: { name: "echo", args: { c: 3 } }, thoughtSignature: "s" },
    ]);
    const body = calls[0]?.body ?? {};
    assert.match(calls[0]?.url ?? "", /models\/gemini-3\.8-flash:generateContent$/);
    assert.deepEqual(body.contents, [
      { role: "user", parts: [{ text: "hi" }] },
      { role: "model", parts: [{ functionCall: { id: "c1", name: "echo", args: { a: 1 } } }] },
      {
        role: "user",
        parts: [
          { functionResponse: { id: "c1", name: "echo", response: { output: "1" } } },
          { functionResponse: { id: "c2", name: "echo", response: { error: "boom" } } },
        ],
      },
    ]);
  });
});

describe("tool rows and messages", () => {
  it("reads the rows of the Tools field", () => {
    const rows = readToolRows({
      workflow: [{ name: "find", description: "Find a customer", workflowId: "wf1" }],
    });
    assert.equal(rows.workflow.length, 1);
    assert.deepEqual(rows.mcp, []);
    assert.deepEqual(readToolRows(undefined), { workflow: [], mcp: [] });
  });

  it("names the row of a bad tool", () => {
    assert.throws(
      () => readToolRows({ workflow: [{ name: "bad name", description: "x", workflowId: "w" }] }),
      /Workflow tool 1: "name" must have/,
    );
    assert.throws(
      () => readToolRows({ mcp: [{ name: "docs", url: "not a url" }] }),
      /MCP server 1: "url"/,
    );
  });

  it("reads messages from JSON or a list, and rejects bad items", () => {
    assert.deepEqual(readMessages('[{"role":"user","content":"hi"}]', "history"), [
      { role: "user", content: "hi" },
    ]);
    assert.deepEqual(readMessages(undefined, "history"), []);
    assert.throws(() => readMessages([{ role: "system", content: "x" }], "history"), /"role"/);
    assert.throws(() => readMessages([{ role: "tool", content: "x" }], "history"), /toolCallId/);
  });
});

type TableStore = NonNullable<NodeRunContext<unknown>["tables"]>;

/** A table store in memory. Each row gets a later createdAt. */
function fakeTables() {
  const rows: Record<string, unknown>[] = [];
  let clock = 0;
  const matches = (row: Record<string, unknown>, filter: unknown): boolean => {
    const f = filter as { and?: unknown[]; field?: string; op?: string; value?: unknown };
    if (f.and) return f.and.every((part) => matches(row, part));
    const value = row[f.field ?? ""];
    if (f.op === "eq") return value === f.value;
    if (f.op === "lt") return String(value) < String(f.value);
    throw new Error(`no op ${f.op}`);
  };
  const store = {
    async insert(_table: string, added: Record<string, unknown>[]) {
      const made = added.map((row) => ({
        id: String(rows.length + 1),
        createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, clock++)).toISOString(),
        updatedAt: "",
        ...row,
      }));
      rows.push(...made);
      return made;
    },
    async query(_table: string, query: { filter?: unknown; limit?: number }) {
      const found = rows
        .filter((row) => matches(row, query.filter))
        .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
        .slice(0, query.limit);
      return { rows: found, nextCursor: null };
    },
    async delete(_table: string, input: { filter?: unknown }) {
      const before = rows.length;
      for (let index = rows.length - 1; index >= 0; index--) {
        if (matches(rows[index] ?? {}, input.filter)) rows.splice(index, 1);
      }
      return { count: before - rows.length };
    },
  } as unknown as TableStore;
  return { store, rows };
}

describe("table memory", () => {
  it("loads the last turns, oldest first, and deletes older turns", async () => {
    const { store, rows } = fakeTables();
    const memory = tableMemory(store, "chat", "s1", 2, true);
    for (const text of ["one", "two", "three"]) {
      await memory.save([{ role: "user", content: text }]);
    }
    await tableMemory(store, "chat", "s2", 2, true).save([{ role: "user", content: "other" }]);
    assert.deepEqual(await memory.load(), [
      { role: "user", content: "two" },
      { role: "user", content: "three" },
    ]);
    assert.equal(rows.length, 3);
  });
});

describe("agent.run", () => {
  const openaiAnswer = (message: Record<string, unknown>) => ({
    choices: [{ finish_reason: message.tool_calls ? "tool_calls" : "stop", message }],
    usage: { prompt_tokens: 1, completion_tokens: 1 },
  });

  const run = async (
    config: Record<string, unknown>,
    extra: Partial<NodeRunContext<unknown>> = {},
  ) =>
    def.run({
      config: def.config.parse({ ...(def.defaultConfig as Record<string, unknown>), ...config }),
      input: {},
      credential: { type: "ai.openai", data: { apiKey: KEY } },
      signal,
      scope: {},
      sandbox: null,
      tables: null,
      ...extra,
    });

  it("runs a workflow tool and keeps the turn in memory", async () => {
    const calls = mockFetch([
      openaiAnswer({
        content: null,
        tool_calls: [{ id: "c1", function: { name: "find", arguments: '{"email":"a@b.c"}' } }],
      }),
      openaiAnswer({ content: "Ada" }),
    ]);
    const runs: unknown[] = [];
    const runWorkflow: NonNullable<NodeRunContext<unknown>["runWorkflow"]> = async (
      source,
      input,
    ) => {
      runs.push({ source, input });
      return { name: "Ada" };
    };
    const { store, rows } = fakeTables();
    const result = await run(
      {
        prompt: "Who is a@b.c?",
        tools: { workflow: [{ name: "find", description: "Find a customer", workflowId: "wf1" }] },
        memory: "table",
        memoryTable: "chat",
        sessionId: "s1",
      },
      { runWorkflow, tables: store },
    );
    assert.deepEqual(runs, [
      { source: { kind: "database", workflowId: "wf1" }, input: { email: "a@b.c" } },
    ]);
    const data = result.data as { output: string; history: Message[] };
    assert.equal(data.output, "Ada");
    assert.equal(rows.length, 1);
    assert.equal(readMessages(rows[0]?.messages, "messages").length, 4);
    // The function schema of a tool without one accepts any object.
    const tools = calls[0]?.body.tools as { function: { parameters: unknown } }[];
    assert.deepEqual(tools[0]?.function.parameters, {
      type: "object",
      properties: {},
      additionalProperties: true,
    });
  });

  it("uses the previous messages before the prompt", async () => {
    const calls = mockFetch([openaiAnswer({ content: "Again" })]);
    await run({ prompt: "and now?", history: [{ role: "user", content: "before" }] });
    assert.deepEqual(calls[0]?.body.messages, [
      { role: "user", content: "before" },
      { role: "user", content: "and now?" },
    ]);
  });

  it("needs a prompt, the credential of the provider, and runWorkflow for workflow tools", async () => {
    await assert.rejects(run({ prompt: " " }), /needs "prompt"/);
    await assert.rejects(run({ prompt: "x", provider: "gemini" }), /credential for Gemini/);
    await assert.rejects(
      run({
        prompt: "x",
        tools: { workflow: [{ name: "find", description: "d", workflowId: "w" }] },
      }),
      /cannot run workflows/,
    );
  });

  it("calls the tools of an MCP server", async () => {
    const { McpServer } = await import("@modelcontextprotocol/sdk/server/mcp.js");
    const { WebStandardStreamableHTTPServerTransport } = await import(
      "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js"
    );
    const bodies: Call[] = [];
    let modelCalls = 0;
    const model = [
      openaiAnswer({
        content: null,
        tool_calls: [{ id: "c1", function: { name: "docs__shout", arguments: '{"text":"hi"}' } }],
      }),
      openaiAnswer({ content: "HI" }),
    ];
    const headers: string[] = [];
    mock.method(globalThis, "fetch", async (input: string | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.startsWith("https://api.openai.com")) {
        bodies.push({ url, body: JSON.parse(String(init?.body)) });
        return new Response(JSON.stringify(model[modelCalls++]), { status: 200 });
      }
      // A new MCP server for each request, without a session.
      const server = new McpServer({ name: "fake", version: "1" });
      server.registerTool(
        "shout",
        { description: "Shout", inputSchema: { text: z.string() } },
        async (args) => ({ content: [{ type: "text", text: args.text.toUpperCase() }] }),
      );
      server.registerTool("hidden", { description: "Not listed" }, async () => ({ content: [] }));
      const transport = new WebStandardStreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
        enableJsonResponse: true,
      });
      await server.connect(transport);
      const request = new Request(url, init);
      headers.push(request.headers.get("authorization") ?? "");
      return transport.handleRequest(request);
    });
    const result = await run({
      prompt: "shout hi",
      tools: {
        mcp: [
          {
            name: "docs",
            url: "https://mcp.test/mcp",
            headerName: "Authorization",
            headerValue: "Bearer tok",
            only: "shout",
          },
        ],
      },
    });
    const sent = bodies[0]?.body.tools as { function: { name: string } }[];
    assert.deepEqual(
      sent.map((tool) => tool.function.name),
      ["docs__shout"],
    );
    const data = result.data as { output: string; steps: { result: string }[] };
    assert.equal(data.steps[0]?.result, "HI");
    assert.equal(data.output, "HI");
    assert.ok(headers.every((header) => header === "Bearer tok"));
  });
});
