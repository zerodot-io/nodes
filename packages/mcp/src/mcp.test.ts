// SPDX-License-Identifier: AGPL-3.0-only
import assert from "node:assert/strict";
import { afterEach, describe, it, mock } from "node:test";
import { nodes } from "./index";

const signal = new AbortController().signal;
const def = nodes[0];
if (!def) throw new Error("no node");

afterEach(() => mock.restoreAll());

describe("mcp.call_tool", () => {
  async function fakeServer(
    tool: (args: { text: string }) => {
      content: { type: "text"; text: string }[];
      isError?: boolean;
    },
  ) {
    const { McpServer } = await import("@modelcontextprotocol/sdk/server/mcp.js");
    const { WebStandardStreamableHTTPServerTransport } = await import(
      "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js"
    );
    const { z } = await import("zod");
    const seen: Headers[] = [];
    // A new server for each request, like the zerodot server. No session.
    mock.method(globalThis, "fetch", async (input: string | URL, init?: RequestInit) => {
      const server = new McpServer({ name: "fake", version: "1" });
      server.registerTool(
        "echo",
        { description: "Echo", inputSchema: { text: z.string() } },
        async (args) => tool(args),
      );
      const transport = new WebStandardStreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
        enableJsonResponse: true,
      });
      await server.connect(transport);
      const request = new Request(input as string, init);
      seen.push(request.headers);
      return transport.handleRequest(request);
    });
    return seen;
  }

  const run = (
    config: Record<string, unknown>,
    credential: { type: string; data: Record<string, unknown> } | null = null,
  ) =>
    def.run({
      config,
      input: {},
      credential,
      signal,
      scope: {},
      sandbox: null,
      tables: null,
    });

  it("calls a tool and parses a JSON answer", async () => {
    const seen = await fakeServer((args) => ({
      content: [{ type: "text", text: JSON.stringify({ echoed: args.text }) }],
    }));
    const result = await run(
      { url: "https://mcp.test/mcp", tool: "echo", arguments: { text: "hi" }, timeoutMs: 5000 },
      { type: "http.bearer", data: { token: "tok" } },
    );
    assert.deepEqual(result, {
      port: "out",
      data: {
        text: '{"echoed":"hi"}',
        data: { echoed: "hi" },
        content: [{ type: "text", text: '{"echoed":"hi"}' }],
      },
    });
    assert.ok(seen.every((h) => h.get("authorization") === "Bearer tok"));
  });

  it("fails the node when the tool reports an error", async () => {
    await fakeServer(() => ({ content: [{ type: "text", text: "no such user" }], isError: true }));
    await assert.rejects(
      async () =>
        run({
          url: "https://mcp.test/mcp",
          tool: "echo",
          arguments: { text: "x" },
          timeoutMs: 5000,
        }),
      /failed: no such user/,
    );
  });
});
