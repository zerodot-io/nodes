// SPDX-License-Identifier: AGPL-3.0-only
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { isRecord, type NodeRunContext } from "@zerodot/node-sdk";
import { z } from "zod";
import type { ToolSpec } from "./model";

type JsonObject = Record<string, unknown>;
type RunWorkflow = NonNullable<NodeRunContext<unknown>["runWorkflow"]>;

/** A tool that the model can call. A later sub-node port can give tools to the agent. */
export type Tool = { spec: ToolSpec; call(input: unknown, signal: AbortSignal): Promise<unknown> };

/** OpenAI and Gemini accept these names. */
export const TOOL_NAME = /^[A-Za-z0-9_-]{1,64}$/;

/** An input schema for a tool without one: any object. */
const ANY_OBJECT: JsonObject = { type: "object", properties: {}, additionalProperties: true };

const workflowRow = z.object({
  name: z.string().trim().regex(TOOL_NAME, "must have 1 to 64 letters, digits, _ or -"),
  description: z.string().trim().min(1, "is needed. The model reads it to choose the tool"),
  workflowId: z.string().trim().min(1, "is needed"),
  inputSchema: z.string().optional(),
});

const mcpRow = z.object({
  name: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9_-]{1,20}$/, "must have 1 to 20 letters, digits, _ or -"),
  url: z.url(),
  headerName: z.string().trim().optional(),
  headerValue: z.string().optional(),
  only: z.string().optional(),
});

/** The "Tools" field: a list of each kind. */
const toolsValue = z
  .object({
    workflow: z.array(workflowRow).default([]),
    mcp: z.array(mcpRow).default([]),
  })
  .default({ workflow: [], mcp: [] });

export type ToolRows = z.output<typeof toolsValue>;

/** Reads the "Tools" field. An error names the row and the field. */
export function readToolRows(value: unknown): ToolRows {
  const parsed = toolsValue.safeParse(value ?? undefined);
  if (parsed.success) return parsed.data;
  const issue = parsed.error.issues[0];
  const [kind, index, field] = issue?.path ?? [];
  const where =
    typeof index === "number"
      ? `${kind === "mcp" ? "MCP server" : "Workflow tool"} ${index + 1}: "${String(field)}"`
      : "Tools";
  throw new Error(`${where} ${issue?.message ?? "is not valid"}`);
}

/** The input schema of a workflow tool: JSON Schema text with type "object". */
function schemaOf(text: string | undefined, name: string): JsonObject {
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
export function workflowTools(rows: ToolRows["workflow"], runWorkflow: RunWorkflow): Tool[] {
  return rows.map((row) => ({
    spec: {
      name: row.name,
      description: row.description,
      inputSchema: schemaOf(row.inputSchema, row.name),
    },
    call: (input) =>
      runWorkflow({ kind: "database", workflowId: row.workflowId }, input, { wait: true }),
  }));
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
  if (result.isError === true)
    throw new Error(`The MCP tool "${name}" failed${text ? `: ${text}` : ""}`);
  return result.structuredContent ?? text;
}

export type McpSession = { tools: Tool[]; close(): Promise<void> };

/**
 * Connects to each MCP server for the whole run, and lists its tools. A tool name is
 * `<server name>__<tool name>`. The caller must close the session.
 */
export async function openMcp(
  rows: ToolRows["mcp"],
  signal: AbortSignal,
  timeoutMs: number,
): Promise<McpSession> {
  const clients: Client[] = [];
  const close = async () => {
    await Promise.all(clients.map((client) => client.close().catch(() => {})));
  };
  if (rows.length === 0) return { tools: [], close };
  const { Client, StreamableHTTPClientTransport } = await loadSdk();
  const tools: Tool[] = [];
  const request = { signal, timeout: timeoutMs };
  try {
    for (const row of rows) {
      const headers: Record<string, string> = {};
      const headerName = row.headerName?.trim();
      if (headerName && row.headerValue) headers[headerName] = row.headerValue;
      const client = new Client({ name: "zerodot-agent", version: "1" });
      clients.push(client);
      const transport = new StreamableHTTPClientTransport(new URL(row.url), {
        requestInit: { headers },
      });
      try {
        await client.connect(transport, request);
      } catch (error) {
        throw new Error(`MCP server "${row.name}": ${(error as Error).message}`);
      }
      const only = new Set(
        (row.only ?? "")
          .split(/[\s,]+/)
          .map((name) => name.trim())
          .filter(Boolean),
      );
      const listed = await client.listTools(undefined, request);
      for (const tool of listed.tools) {
        if (only.size > 0 && !only.has(tool.name)) continue;
        const name = `${row.name}__${tool.name}`.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 64);
        tools.push({
          spec: {
            name,
            description: tool.description ?? tool.title ?? tool.name,
            inputSchema: isRecord(tool.inputSchema) ? tool.inputSchema : ANY_OBJECT,
          },
          call: async (input, callSignal) => {
            const result = await client.callTool(
              { name: tool.name, arguments: isRecord(input) ? input : {} },
              undefined,
              { signal: callSignal, timeout: timeoutMs },
            );
            return mcpResult(tool.name, result);
          },
        });
      }
    }
  } catch (error) {
    await close();
    throw error;
  }
  return { tools, close };
}
