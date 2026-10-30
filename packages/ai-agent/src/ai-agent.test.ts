// SPDX-License-Identifier: AGPL-3.0-only
import assert from "node:assert/strict";
import { afterEach, describe, it, mock } from "node:test";
import type { NodeDefinition, NodeRunContext, SupplyContext } from "@zerodot/node-sdk";
import { z } from "zod";
import { credentialTypes as aiCredentialTypes } from "../../ai/src/index";
import * as aiModels from "../../ai/src/models";
import { resultText, runAgent } from "./agent";
import { credentialTypes, nodes } from "./index";
import { readMessages, tableMemory } from "./memory";
import { chatModelOf } from "./model";
import * as models from "./models";
import type { ChatModel, Message, ModelTurn, Tool } from "./types";

const signal = new AbortController().signal;
// Built at run time, so secret scanners do not flag a fake key.
const KEY = `sk-${"test".repeat(8)}`;
const find = (type: string): NodeDefinition => {
  const found = nodes.find((entry) => entry.type === type);
  if (!found) throw new Error(`no node ${type}`);
  return found;
};
const def = find("agent.run");

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
    const answer = await chatModelOf(access, {
      model: "gpt-6.1-terra",
      maxTokens: undefined,
      temperature: 0.2,
      timeoutMs: 5000,
    }).chat(request, signal);
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
    const answer = await chatModelOf(access, {
      model: "claude-sonnet-5-5",
      maxTokens: undefined,
      temperature: undefined,
      timeoutMs: 5000,
    }).chat({ ...request, messages }, signal);
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
    const answer = await chatModelOf(access, {
      model: "gemini-3.8-flash",
      maxTokens: undefined,
      temperature: 0.2,
      timeoutMs: 5000,
    }).chat(request, signal);
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

describe("messages", () => {
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
        id: String(clock + 1),
        createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, clock++)).toISOString(),
        updatedAt: "",
        ...row,
      }));
      rows.push(...made);
      return made;
    },
    // The cursor is the offset, so a small limit reads many pages.
    async query(
      _table: string,
      query: {
        filter?: unknown;
        limit?: number;
        cursor?: string | null;
        sort?: { direction: string }[];
      },
    ) {
      const asc = query.sort?.[0]?.direction === "asc";
      const all = rows
        .filter((row) => matches(row, query.filter))
        .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)) * (asc ? 1 : -1));
      const start = Number(query.cursor ?? 0);
      const end = start + (query.limit ?? all.length);
      return { rows: all.slice(start, end), nextCursor: end < all.length ? String(end) : null };
    },
    async update(_table: string, input: { filter?: unknown; set?: Record<string, unknown> }) {
      const changed = rows.filter((row) => matches(row, input.filter));
      for (const row of changed) Object.assign(row, input.set);
      return { count: changed.length, rows: changed };
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

type Credential = { type: string; data: Record<string, unknown> };

/** Builds the value of a supply node, as the engine does before the parent runs. */
async function supplyOf(
  type: string,
  config: Record<string, unknown>,
  extra: Partial<SupplyContext<unknown>> & { credential?: Credential | null } = {},
): Promise<unknown> {
  const node = find(type);
  if (!node.supply) throw new Error(`${type} is not a supply node`);
  return node.supply({
    config: node.config.parse({ ...(node.defaultConfig as Record<string, unknown>), ...config }),
    credential: null,
    signal,
    scope: {},
    sandbox: null,
    tables: null,
    node: { id: "s1", name: type },
    ...extra,
  });
}

const openaiAnswer = (message: Record<string, unknown>) => ({
  choices: [{ finish_reason: message.tool_calls ? "tool_calls" : "stop", message }],
  usage: { prompt_tokens: 1, completion_tokens: 1 },
});

const openaiModel = () =>
  supplyOf("agent.model.openai", {}, { credential: { type: "ai.openai", data: { apiKey: KEY } } });

const runAgentNode = async (
  config: Record<string, unknown>,
  supplies: Record<string, unknown> | undefined,
) =>
  def.run({
    config: def.config.parse({ ...(def.defaultConfig as Record<string, unknown>), ...config }),
    input: {},
    credential: null,
    signal,
    scope: {},
    sandbox: null,
    tables: null,
    supplies,
  });

describe("supply nodes", () => {
  it("are supply nodes of the agent kinds, and the agent has the three ports", () => {
    const kinds = Object.fromEntries(
      nodes.filter((node) => node.supplies).map((node) => [node.type, node.supplies]),
    );
    assert.deepEqual(kinds, {
      "agent.model.openai": "ai.model",
      "agent.model.anthropic": "ai.model",
      "agent.model.gemini": "ai.model",
      "agent.model.compatible": "ai.model",
      "agent.memory.table": "ai.memory",
      "agent.tool.workflow": "ai.tool",
      "agent.tool.mcp": "ai.tool",
    });
    assert.deepEqual(
      def.supplyPorts?.map((port) => [port.name, port.kind, port.required ?? false]),
      [
        ["model", "ai.model", true],
        ["memory", "ai.memory", false],
        ["tools", "ai.tool", false],
      ],
    );
  });

  it("a chat model needs the credential of its provider, and sends its settings", async () => {
    await assert.rejects(supplyOf("agent.model.gemini", {}), /credential for Gemini/);
    const calls = mockFetch([openaiAnswer({ content: "ok" })]);
    const model = await supplyOf(
      "agent.model.compatible",
      { model: "llama4", maxTokens: 50, temperature: 0.3 },
      { credential: { type: "ai.compatible", data: { baseUrl: "https://llm.test/v1" } } },
    );
    await (model as ChatModel).chat({ system: undefined, messages: [], tools: [] }, signal);
    assert.equal(calls[0]?.url, "https://llm.test/v1/chat/completions");
    assert.equal(calls[0]?.body.model, "llama4");
    assert.equal(calls[0]?.body.max_tokens, 50);
    assert.equal(calls[0]?.body.temperature, 0.3);
  });

  it("a workflow tool checks its name and needs runWorkflow", async () => {
    await assert.rejects(
      supplyOf("agent.tool.workflow", { name: "bad name", description: "d", workflowId: "w" }),
      /"name" must have/,
    );
    await assert.rejects(
      supplyOf("agent.tool.workflow", { name: "find", description: "d", workflowId: "w" }),
      /cannot run workflows/,
    );
  });
});

describe("agent.run", () => {
  it("needs a prompt and a chat model", async () => {
    await assert.rejects(runAgentNode({ prompt: " " }, {}), /needs "prompt"/);
    await assert.rejects(runAgentNode({ prompt: "x" }, undefined), /Connect a chat model/);
    await assert.rejects(runAgentNode({ prompt: "x" }, { model: {} }), /Connect a chat model/);
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
    const result = await runAgentNode(
      { prompt: "Who is a@b.c?" },
      {
        model: await openaiModel(),
        memory: await supplyOf(
          "agent.memory.table",
          { table: "chat", sessionId: "s1" },
          { tables: store },
        ),
        tools: [
          await supplyOf(
            "agent.tool.workflow",
            { name: "find", description: "Find a customer", workflowId: "wf1" },
            { runWorkflow },
          ),
        ],
      },
    );
    assert.deepEqual(runs, [
      { source: { kind: "database", workflowId: "wf1" }, input: { email: "a@b.c" } },
    ]);
    assert.equal((result.data as { output: string }).output, "Ada");
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
    await runAgentNode(
      { prompt: "and now?", history: [{ role: "user", content: "before" }] },
      { model: await openaiModel(), tools: [] },
    );
    assert.deepEqual(calls[0]?.body.messages, [
      { role: "user", content: "before" },
      { role: "user", content: "and now?" },
    ]);
  });

  it("rejects two tools with the same name, and a value that is not a tool", async () => {
    const model = await openaiModel();
    await assert.rejects(
      runAgentNode({ prompt: "x" }, { model, tools: [echo, echo] }),
      /Two tools/,
    );
    await assert.rejects(
      runAgentNode({ prompt: "x" }, { model, tools: [{}] }),
      /does not give a tool/,
    );
  });

  it("opens an MCP toolset, calls its tools, and closes it", async () => {
    const { McpServer } = await import("@modelcontextprotocol/sdk/server/mcp.js");
    const { WebStandardStreamableHTTPServerTransport } = await import(
      "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js"
    );
    const bodies: Call[] = [];
    let modelCalls = 0;
    const answers = [
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
        return new Response(JSON.stringify(answers[modelCalls++]), { status: 200 });
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
    const toolset = await supplyOf(
      "agent.tool.mcp",
      { url: "https://mcp.test/mcp", prefix: "docs", only: "shout" },
      { credential: { type: "http.bearer", data: { token: "tok" } } },
    );
    let closed = 0;
    const set = toolset as { close(): Promise<void> };
    const close = set.close.bind(set);
    set.close = async () => {
      closed++;
      await close();
    };
    const result = await runAgentNode(
      { prompt: "shout hi" },
      { model: await openaiModel(), tools: [toolset] },
    );
    const sent = bodies[0]?.body.tools as { function: { name: string } }[];
    assert.deepEqual(
      sent.map((tool) => tool.function.name),
      ["docs__shout"],
    );
    const data = result.data as { output: string; steps: { result: string }[] };
    assert.equal(data.steps[0]?.result, "HI");
    assert.equal(data.output, "HI");
    assert.equal(closed, 1);
    assert.ok(headers.every((header) => header === "Bearer tok"));
  });
});

describe("agent.memory.manage", () => {
  const manager = find("agent.memory.manage");
  const user = (content: string): Message => ({ role: "user", content });
  const toolTurn: Message[] = [
    user("find a@b.c"),
    { role: "assistant", content: "", toolCalls: [{ id: "c1", name: "find", input: {} }] },
    { role: "tool", toolCallId: "c1", name: "find", content: "Ada" },
    { role: "assistant", content: "It is Ada" },
  ];

  async function setup(turns: Message[][]) {
    const { store, rows } = fakeTables();
    for (const turn of turns) await tableMemory(store, "chat", "s1", 10, false).save(turn);
    await tableMemory(store, "chat", "other", 10, false).save([user("not mine")]);
    const memory = await supplyOf(
      "agent.memory.table",
      { table: "chat", sessionId: "s1", turns: 1 },
      { tables: store },
    );
    const run = async (config: Record<string, unknown>) => {
      const result = await manager.run({
        config: manager.config.parse({
          ...(manager.defaultConfig as Record<string, unknown>),
          ...config,
        }),
        input: {},
        credential: null,
        signal,
        scope: {},
        sandbox: null,
        tables: null,
        supplies: { memory },
      });
      return (result.data as { messages: Message[] }).messages;
    };
    return { run, rows };
  }

  it("needs a memory", async () => {
    await assert.rejects(
      async () =>
        manager.run({
          config: manager.config.parse(manager.defaultConfig),
          input: {},
          credential: null,
          signal,
          scope: {},
          sandbox: null,
          tables: null,
        }),
      /Connect a memory/,
    );
  });

  it("gets all messages, or only the window, of the session", async () => {
    const { run } = await setup([[user("one")], [user("two")]]);
    assert.deepEqual(await run({ operation: "get" }), [user("one"), user("two")]);
    assert.deepEqual(await run({ operation: "get", scope: "window" }), [user("two")]);
  });

  it("adds messages, or replaces all of them", async () => {
    const { run, rows } = await setup([[user("one")]]);
    const messages = {
      values: [
        { role: "assistant", content: "hi" },
        { role: "user", content: " " },
      ],
    };
    assert.deepEqual(await run({ operation: "insert", messages }), [
      user("one"),
      { role: "assistant", content: "hi" },
    ]);
    assert.deepEqual(await run({ operation: "insert", insertMode: "override", messages }), [
      { role: "assistant", content: "hi" },
    ]);
    // The other session stays.
    assert.ok(rows.some((row) => row.sessionId === "other"));
  });

  it("deletes the last messages, and never keeps a tool call without its result", async () => {
    const { run } = await setup([[user("one")], toolTurn]);
    // Deleting the last 2 cuts the tool result, so the open tool call goes too.
    assert.deepEqual(await run({ operation: "delete", count: 2 }), [
      user("one"),
      user("find a@b.c"),
    ]);
    assert.deepEqual(await run({ operation: "delete", count: 1 }), [user("one")]);
    assert.deepEqual(await run({ operation: "delete", deleteMode: "all" }), []);
  });

  it("returns the full messages when Simplify Output is off", async () => {
    const { run } = await setup([toolTurn]);
    const messages = await run({ operation: "get", simplify: false });
    assert.deepEqual(messages[1], toolTurn[1]);
  });
});
