// SPDX-License-Identifier: AGPL-3.0-only
import { defineNode } from "@zerodot/node-sdk";
import { z } from "zod";
import { runAgent } from "./agent";
import { AGENT_ICON } from "./icon";
import { readMessages } from "./memory";
import { isChatModel, isMemory, isTool, isToolset, KIND, type Tool, type Toolset } from "./types";

const config = z.object({
  systemPrompt: z.string().optional().meta({
    ui: "textarea",
    title: "System Prompt",
    description: "Rules for the agent. For example its role, its tone, and when to use each tool",
  }),
  prompt: z.string().default("").meta({
    ui: "textarea",
    title: "Prompt",
    description: "The message to the agent, such as {{ $input.message }}",
  }),
  history: z.unknown().optional().meta({
    title: "Previous Messages",
    description:
      'Optional. The "history" of an earlier agent run, such as {{ $input.history }}. It replaces the memory as the earlier messages',
  }),
  maxIterations: z.number().int().min(1).max(50).default(10).meta({
    title: "Max Model Calls",
    description: "The agent stops after this many calls to the model",
  }),
  maxResultChars: z.number().int().min(100).max(200_000).default(20_000).meta({
    title: "Max Tool Result Length",
    description: "A longer tool result is cut to this many characters",
  }),
});

/** The tools of the Tool port. A toolset opens here. The caller closes the opened toolsets. */
async function toolsOf(values: unknown, signal: AbortSignal, opened: Toolset[]): Promise<Tool[]> {
  const tools: Tool[] = [];
  for (const value of Array.isArray(values) ? values : []) {
    if (isTool(value)) tools.push(value);
    else if (isToolset(value)) {
      opened.push(value);
      tools.push(...(await value.open(signal)));
    } else throw new Error('A node on "Tool" does not give a tool');
  }
  const names = new Set<string>();
  for (const tool of tools) {
    if (names.has(tool.spec.name)) {
      throw new Error(`Two tools have the name "${tool.spec.name}". Rename one, or set a prefix`);
    }
    names.add(tool.spec.name);
  }
  return tools;
}

export default defineNode({
  type: "agent.run",
  label: "AI Agent",
  description: "An agent that calls tools until it has an answer",
  category: "integration",
  app: "AI Agent",
  icon: "BotIcon",
  iconUrl: AGENT_ICON,
  config,
  defaultConfig: { systemPrompt: "", prompt: "", maxIterations: 10, maxResultChars: 20_000 },
  ports: { in: ["in"], out: ["out"] },
  supplyPorts: [
    { name: "model", kind: KIND.model, label: "Chat Model", required: true },
    { name: "memory", kind: KIND.memory, label: "Memory" },
    { name: "tools", kind: KIND.tool, label: "Tool", multiple: true },
  ],
  async run({ config, signal, supplies, log }) {
    if (!config.prompt.trim()) throw new Error('The node needs "prompt"');
    const model = supplies?.model;
    if (!isChatModel(model)) throw new Error('Connect a chat model to "Chat Model"');
    const memory = supplies?.memory;
    if (memory !== undefined && !isMemory(memory)) {
      throw new Error('The node on "Memory" does not give a memory');
    }
    const history = readMessages(config.history, "history");
    const previous = history.length > 0 || !memory ? history : await memory.load();

    const opened: Toolset[] = [];
    try {
      const tools = await toolsOf(supplies?.tools, signal, opened);
      const result = await runAgent({
        model,
        tools,
        system: config.systemPrompt?.trim() || undefined,
        prompt: config.prompt,
        previous,
        maxIterations: config.maxIterations,
        maxResultChars: config.maxResultChars,
        signal,
        log: log ? (message) => log([{ level: "info", message }]) : undefined,
      });
      await memory?.save(result.history.slice(previous.length));
      return { port: "out", data: result };
    } finally {
      await Promise.all(opened.map((toolset) => toolset.close()));
    }
  },
});
