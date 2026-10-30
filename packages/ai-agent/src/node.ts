// SPDX-License-Identifier: AGPL-3.0-only
import { defineNode } from "@zerodot/node-sdk";
import { runAgent } from "./agent";
import { accessOf, CREDENTIAL_OF } from "./api";
import { agentConfig, modelOf } from "./config";
import { AGENT_ICON } from "./icon";
import { type Memory, readMessages, tableMemory } from "./memory";
import { chatModelOf } from "./model";
import { openMcp, readToolRows, type Tool, workflowTools } from "./tools";

export default defineNode({
  type: "agent.run",
  label: "AI Agent",
  description:
    "An agent that calls tools until it has an answer. Tools are other workflows and MCP servers",
  category: "integration",
  app: "AI Agent",
  icon: "BotIcon",
  iconUrl: AGENT_ICON,
  config: agentConfig,
  defaultConfig: {
    provider: "openai",
    openaiModel: "gpt-6.1-terra",
    systemPrompt: "",
    prompt: "",
    memory: "none",
    memoryTurns: 10,
    trimMemory: false,
    maxIterations: 10,
    maxResultChars: 20_000,
    timeoutMs: 120_000,
  },
  credentialTypes: Object.values(CREDENTIAL_OF),
  // The Provider field says which credential type the user picks.
  credentialRules: Object.fromEntries(
    Object.entries(CREDENTIAL_OF).map(([provider, type]) => [
      type,
      { showWhen: { provider: [provider] } },
    ]),
  ),
  ports: { in: ["in"], out: ["out"] },
  subtitle: (config) => {
    const provider = String(config.provider ?? "openai");
    const model = config[`${provider}Model`] ?? config.customModel;
    return typeof model === "string" && model !== "" ? `${provider}: ${model}` : provider;
  },
  async run({ config, credential, signal, tables, runWorkflow, log }) {
    if (!config.prompt.trim()) throw new Error('The node needs "prompt"');
    const model = chatModelOf(
      accessOf(config.provider, credential),
      modelOf(config),
      config.timeoutMs,
    );
    const rows = readToolRows(config.tools);
    if (rows.workflow.length > 0 && !runWorkflow) {
      throw new Error("This worker cannot run workflows, so workflow tools do not work");
    }

    let memory: Memory | undefined;
    if (config.memory === "table") {
      const table = config.memoryTable?.trim();
      const sessionId = config.sessionId?.trim();
      if (!table) throw new Error('Memory needs "memoryTable"');
      if (!sessionId) throw new Error('Memory needs "sessionId"');
      if (!tables) throw new Error("This worker has no data tables, so the memory does not work");
      memory = tableMemory(tables, table, sessionId, config.memoryTurns, config.trimMemory);
    }
    const history = readMessages(config.history, "history");
    const previous = history.length > 0 || !memory ? history : await memory.load();

    const mcp = await openMcp(rows.mcp, signal, config.timeoutMs);
    try {
      const tools: Tool[] = [
        ...(runWorkflow ? workflowTools(rows.workflow, runWorkflow) : []),
        ...mcp.tools,
      ];
      const names = new Set<string>();
      for (const tool of tools) {
        if (names.has(tool.spec.name))
          throw new Error(`Two tools have the name "${tool.spec.name}"`);
        names.add(tool.spec.name);
      }
      const result = await runAgent({
        model,
        tools,
        system: config.systemPrompt?.trim() || undefined,
        prompt: config.prompt,
        previous,
        maxIterations: config.maxIterations,
        maxResultChars: config.maxResultChars,
        maxTokens: config.maxTokens,
        temperature: config.provider === "anthropic" ? undefined : config.temperature,
        signal,
        log: log ? (message) => log([{ level: "info", message }]) : undefined,
      });
      await memory?.save(result.history.slice(previous.length));
      return { port: "out", data: result };
    } finally {
      await mcp.close();
    }
  },
});
