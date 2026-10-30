// SPDX-License-Identifier: AGPL-3.0-only
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { isRecord, type NodeRunContext, type ResolvedCredential } from "@zerodot/node-sdk";
import type { Tool, Toolset } from "./types";

type JsonObject = Record<string, unknown>;
type RunWorkflow = NonNullable<NodeRunContext<unknown>["runWorkflow"]>;

/** OpenAI and Gemini accept these names. */
export const TOOL_NAME = /^[A-Za-z0-9_-]{1,64}$/;

/** An input schema for a tool without one: any object. */
const ANY_OBJECT: JsonObject = { type: "object", properties: {}, additionalProperties: true };

/** The input schema of a tool: JSON Schema text with type "object". Empty means any object. */
export function schemaOf(text: string | undefined, name: string): JsonObject {
  if (!text?.trim()) return ANY_OBJECT;
  let schema: unknown;
  try {
    schema = JSON.parse(text);
  } catch {
    throw new Error(`Tool "${name}": "inputSchema" is not valid JSON`);
  }
  if (!isRecord(schema) || schema.type !== "object") {
    throw new Error(`Tool "${name}": "inputSchema" must be a JSON Schema with type "object"`);
  }
  return schema;
}

/**
 * A tool that runs another workflow and waits for it. The input of the model is the trigger
 * input. The output of the last node that finished is the result.
 */
export function workflowTool(
  options: { name: string; description: string; workflowId: string; inputSchema?: string },
  runWorkflow: RunWorkflow,
): Tool {
  return {
    spec: {
      name: options.name,
      description: options.description,
      inputSchema: schemaOf(options.inputSchema, options.name),
    },
    call: (input) =>
      runWorkflow({ kind: "database", workflowId: options.workflowId }, input, { wait: true }),
  };
}

export const MCP_CREDENTIAL_TYPES = ["http.bearer", "http.header", "http.basic"];

const asText = (value: unknown, field: string): string => {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`The credential has no "${field}"`);
  }
  return value;
};

/** The header that a credential adds to the request. The same rules as @zerodot/mcp. */
export function credentialHeader(credential: ResolvedCredential): [string, string] {
  const { type, data } = credential;
  if (type === "http.basic") {
    const pair = `${asText(data.username, "username")}:${asText(data.password, "password")}`;
    return ["authorization", `Basic ${Buffer.from(pair).toString("base64")}`];
  }
  if (type === "http.bearer") return ["authorization", `Bearer ${asText(data.token, "token")}`];
  if (type === "http.header") return [asText(data.name, "name"), asText(data.value, "value")];
  throw new Error(`Unsupported credential type "${type}"`);
}

/** The SDK loads on first use. */
async function loadSdk() {
  const [{ Client }, { StreamableHTTPClientTransport }] = await Promise.all([
    import("@modelcontextprotocol/sdk/client/index.js"),
    import("@modelcontextprotocol/sdk/client/streamableHttp.js"),
  ]);
  return { Client, StreamableHTTPClientTransport };
}

/** The result of an MCP tool: the structured content, or the text. An error result throws. */
function mcpResult(name: string, result: JsonObject): unknown {
  const content = Array.isArray(result.content) ? result.content : [];
  const text = content
    .flatMap((part) => (isRecord(part) && part.type === "text" ? [String(part.text ?? "")] : []))
    .join("\n");
  if (result.isError === true) {
    throw new Error(`The MCP tool "${name}" failed${text ? `: ${text}` : ""}`);
  }
  return result.structuredContent ?? text;
}

export type McpOptions = {
  url: string;
  credential: ResolvedCredential | null;
  /** Put in front of each tool name, as `<prefix>__<tool>`. Empty means no prefix. */
  prefix: string;
  /** Tool names. Empty means all tools. */
  only: string[];
  timeoutMs: number;
};

/** The tools of one MCP server. The connection stays open from `open` to `close`. */
export function mcpToolset(options: McpOptions): Toolset {
  let client: Client | undefined;
  return {
    async open(signal) {
      const headers: Record<string, string> = {};
      if (options.credential) {
        const [name, value] = credentialHeader(options.credential);
        headers[name] = value;
      }
      const { Client, StreamableHTTPClientTransport } = await loadSdk();
      const opened = new Client({ name: "zerodot-agent", version: "1" });
      client = opened;
      const transport = new StreamableHTTPClientTransport(new URL(options.url), {
        requestInit: { headers },
      });
      const request = { signal, timeout: options.timeoutMs };
      await opened.connect(transport, request);
      const only = new Set(options.only);
      const listed = await opened.listTools(undefined, request);
      return listed.tools
        .filter((tool) => only.size === 0 || only.has(tool.name))
        .map((tool) => ({
          spec: {
            name: (options.prefix ? `${options.prefix}__${tool.name}` : tool.name)
              .replace(/[^A-Za-z0-9_-]/g, "_")
              .slice(0, 64),
            description: tool.description ?? tool.title ?? tool.name,
            inputSchema: isRecord(tool.inputSchema) ? tool.inputSchema : ANY_OBJECT,
          },
          call: async (input, callSignal) => {
            const result = await opened.callTool(
              { name: tool.name, arguments: isRecord(input) ? input : {} },
              undefined,
              { signal: callSignal, timeout: options.timeoutMs },
            );
            return mcpResult(tool.name, result);
          },
        }));
    },
    async close() {
      await client?.close().catch(() => {});
      client = undefined;
    },
  };
}
