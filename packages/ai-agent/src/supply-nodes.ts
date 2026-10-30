// SPDX-License-Identifier: AGPL-3.0-only
import type { NodeDefinition } from "@zerodot/node-sdk";
import { z } from "zod";
import { CODE_ICON, MCP_ICON, MEMORY_ICON, WORKFLOW_ICON } from "./icon";
import { tableMemory } from "./memory";
import { defineSupplyNode } from "./supply";
import { MCP_CREDENTIAL_TYPES, mcpToolset, schemaOf, TOOL_NAME, workflowTool } from "./tools";
import { KIND, type Tool } from "./types";

const tableMemoryNode = defineSupplyNode({
  type: "agent.memory.table",
  label: "Data Table Memory",
  description: "Keeps the conversation of the AI Agent in a data table of the project",
  category: "integration",
  icon: "DatabaseIcon",
  iconUrl: MEMORY_ICON,
  supplies: KIND.memory,
  config: z.object({
    table: z.string().default("").meta({
      title: "Table",
      description: 'The ID or the name of a table with the text columns "sessionId" and "messages"',
    }),
    sessionId: z.string().default("").meta({
      title: "Session ID",
      description: "One conversation, such as {{ $input.chatId }}. It reads the input of the agent",
    }),
    turns: z.number().int().min(1).max(100).default(10).meta({
      title: "Turns to Remember",
      description: "How many earlier runs of the session the agent reads",
    }),
    trim: z.boolean().default(false).meta({
      title: "Delete Older Turns",
      description: "Delete the turns of the session that are older than the turns to remember",
    }),
  }),
  defaultConfig: { table: "", sessionId: "", turns: 10, trim: false },
  subtitle: (config) =>
    typeof config.table === "string" && config.table !== "" ? config.table : undefined,
  supply: ({ config, tables }) => {
    const table = config.table.trim();
    const sessionId = config.sessionId.trim();
    if (!table) throw new Error('The node needs "table"');
    if (!sessionId) throw new Error('The node needs "sessionId"');
    if (!tables) throw new Error("This worker has no data tables");
    return tableMemory(tables, table, sessionId, config.turns, config.trim);
  },
});

const workflowToolNode = defineSupplyNode({
  type: "agent.tool.workflow",
  label: "Workflow Tool",
  description: "Lets the AI Agent run another workflow as a tool",
  category: "integration",
  icon: "WorkflowIcon",
  iconUrl: WORKFLOW_ICON,
  supplies: KIND.tool,
  config: z.object({
    name: z.string().default("").meta({
      title: "Tool Name",
      placeholder: "find_customer",
      description: "Letters, digits, _ and -. Each tool of the agent needs its own name",
    }),
    description: z.string().default("").meta({
      ui: "textarea",
      title: "Description",
      description: "What the tool does and when to use it. The model reads it",
    }),
    workflowId: z.string().default("").meta({
      title: "Workflow ID",
      description:
        "The workflow to run. Its trigger input is the input from the model. End it with one last node: its output is the result. It must be published, and it cannot wait",
    }),
    inputSchema: z.string().optional().meta({
      ui: "code",
      title: "Input Schema",
      placeholder: '{"type":"object","properties":{"email":{"type":"string"}}}',
      description: "Optional. A JSON Schema with type object. Empty means any object",
    }),
  }),
  defaultConfig: { name: "", description: "", workflowId: "" },
  subtitle: (config) =>
    typeof config.name === "string" && config.name !== "" ? config.name : undefined,
  supply: ({ config, runWorkflow }) => {
    const name = config.name.trim();
    if (!TOOL_NAME.test(name)) {
      throw new Error('"name" must have 1 to 64 letters, digits, _ or -');
    }
    const description = config.description.trim();
    if (!description) throw new Error('The node needs "description". The model reads it');
    const workflowId = config.workflowId.trim();
    if (!workflowId) throw new Error('The node needs "workflowId"');
    if (!runWorkflow) throw new Error("This worker cannot run workflows");
    return workflowTool(
      { name, description, workflowId, inputSchema: config.inputSchema },
      runWorkflow,
    );
  },
});

const mcpToolNode = defineSupplyNode({
  type: "agent.tool.mcp",
  label: "MCP Client Tool",
  description: "Gives the tools of an MCP server to the AI Agent",
  category: "integration",
  icon: "PlugSocketIcon",
  iconUrl: MCP_ICON,
  supplies: KIND.tool,
  config: z.object({
    url: z.url().meta({ title: "URL", description: "A Streamable HTTP endpoint" }),
    prefix: z
      .string()
      .regex(/^[A-Za-z0-9_-]{0,20}$/, "Use up to 20 letters, digits, _ or -")
      .default("")
      .meta({
        title: "Tool Name Prefix",
        description:
          "Optional. The tools are <prefix>__<tool>. Use it when two servers share a name",
      }),
    include: z
      .enum(["all", "selected", "except"])
      .default("all")
      .meta({
        title: "Tools to Include",
        labels: { all: "All", selected: "Selected", except: "All Except" },
        hints: {
          all: "Every tool of the server",
          selected: "Only the tools that you name",
          except: "Every tool except the ones that you name",
        },
      }),
    toolNames: z
      .string()
      .default("")
      .meta({
        showWhen: { include: ["selected", "except"] },
        title: "Tool Names",
        description: "The tool names of the server, with commas between them",
      }),
    timeoutMs: z.number().int().min(1000).max(300_000).default(30_000).meta({
      title: "Timeout (ms)",
      description: "The time limit of the connection and of each tool call",
    }),
  }),
  defaultConfig: { url: "https://", prefix: "", include: "all", toolNames: "", timeoutMs: 30_000 },
  // Optional. The credential gives the header of each request.
  credentialTypes: MCP_CREDENTIAL_TYPES,
  subtitle: (config) => (typeof config.url === "string" ? config.url : undefined),
  supply: ({ config, credential }) =>
    mcpToolset({
      url: config.url,
      credential,
      prefix: config.prefix,
      include: config.include,
      toolNames: config.toolNames
        .split(/[\s,]+/)
        .map((name) => name.trim())
        .filter(Boolean),
      timeoutMs: config.timeoutMs,
    }),
});

/** The Tool Name and Description fields of a tool node. */
const toolFields = {
  name: z.string().default("").meta({
    title: "Tool Name",
    placeholder: "get_weather",
    description: "Letters, digits, _ and -. Each tool of the agent needs its own name",
  }),
  description: z.string().default("").meta({
    ui: "textarea",
    title: "Description",
    description: "What the tool does and when to use it. The model reads it",
  }),
};

/** The checked name and description of a tool node. */
function nameAndDescription(config: { name: string; description: string }) {
  const name = config.name.trim();
  if (!TOOL_NAME.test(name)) throw new Error('"name" must have 1 to 64 letters, digits, _ or -');
  const description = config.description.trim();
  if (!description) throw new Error('The node needs "description". The model reads it');
  return { name, description };
}

/** The most code and time that the sandbox takes. The same limits as the Code node. */
const MAX_CODE_CHARS = 200_000;
const MAX_TIMEOUT_MS = 60_000;

const DEFAULT_CODE = `// The input from the model is in \`input\`. Return the result for the model.
// console.log shows in the logs of the agent.
return { received: input };`;

const codeToolNode = defineSupplyNode({
  type: "agent.tool.code",
  label: "Code Tool",
  description: "A tool for the AI Agent that runs your JavaScript",
  category: "integration",
  icon: "SourceCodeIcon",
  iconUrl: CODE_ICON,
  supplies: KIND.tool,
  config: z.object({
    ...toolFields,
    inputSchema: z.string().optional().meta({
      ui: "code",
      title: "Input Schema",
      placeholder: '{"type":"object","properties":{"city":{"type":"string"}}}',
      description: "Optional. A JSON Schema with type object. Empty means any object",
    }),
    // The body of an async function, as in the Code node.
    code: z.string().min(1).max(MAX_CODE_CHARS).meta({ ui: "code", title: "JavaScript" }),
    timeoutMs: z.number().int().min(1).max(MAX_TIMEOUT_MS).default(10_000).meta({
      title: "Timeout (ms)",
      description: "The time limit of one call",
    }),
  }),
  defaultConfig: { name: "", description: "", code: DEFAULT_CODE, timeoutMs: 10_000 },
  // JavaScript is not an expression. `{{ }}` in code stays as it is.
  rawConfigKeys: ["code"],
  subtitle: (config) =>
    typeof config.name === "string" && config.name !== "" ? config.name : undefined,
  supply: ({ config, sandbox, scope, log }): Tool => {
    const { name, description } = nameAndDescription(config);
    if (!sandbox) throw new Error("Code cannot run here: the worker has no SANDBOX_URL");
    const inputSchema = schemaOf(config.inputSchema, name);
    return {
      spec: { name, description, inputSchema },
      call: (input, signal) =>
        sandbox.run(
          { code: config.code, scope: { ...scope, input }, timeoutMs: config.timeoutMs },
          signal,
          log,
        ),
    };
  },
});

export const supplyNodes: NodeDefinition[] = [
  tableMemoryNode,
  workflowToolNode,
  mcpToolNode,
  codeToolNode,
];
