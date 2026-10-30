// SPDX-License-Identifier: AGPL-3.0-only
import type { ChatModel, Message, Tool, ToolCall, Usage } from "./types";

/** The most tool calls that run at the same time. Workflow tools share the worker. */
export const TOOL_CONCURRENCY = 3;

export type Step = {
  tool: string;
  input: unknown;
  /** The result as the model saw it. Long results are cut. */
  result: string;
  error: boolean;
};

export type AgentResult = {
  output: string;
  finishReason: "stop" | "length" | "content_filter" | "other" | "max_iterations";
  steps: Step[];
  /** The earlier messages and the messages of this run. The input of a next run. */
  history: Message[];
  usage: Usage;
};

export type AgentOptions = {
  model: ChatModel;
  tools: Tool[];
  system: string | undefined;
  prompt: string;
  /** The messages before this run, oldest first. */
  previous: Message[];
  maxIterations: number;
  maxResultChars: number;
  signal: AbortSignal;
  log?: (message: string) => void;
};

/** A result as text for the model, cut to the limit. */
export function resultText(value: unknown, limit: number): string {
  const text =
    typeof value === "string" ? value : value === undefined ? "null" : JSON.stringify(value);
  if (text.length <= limit) return text;
  return `${text.slice(0, limit)}\n[The result was cut. It had ${text.length} characters.]`;
}

/** Runs `work` on each item, with at most `limit` at the same time. The order of results stays. */
async function mapLimit<T, R>(items: T[], limit: number, work: (item: T) => Promise<R>) {
  const results: R[] = new Array(items.length);
  let next = 0;
  const lane = async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await work(items[index] as T);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, lane));
  return results;
}

const stopIfAborted = (signal: AbortSignal) => {
  if (signal.aborted) throw signal.reason instanceof Error ? signal.reason : new Error("Stopped");
};

/**
 * The agent loop: ask the model, run the tools it calls, give it the results, and ask again,
 * until it answers without a tool call or it reaches the limit. A tool that fails gives its
 * error to the model, which can try again. A model error stops the run.
 */
export async function runAgent(options: AgentOptions): Promise<AgentResult> {
  const { model, signal, log } = options;
  const byName = new Map(options.tools.map((tool) => [tool.spec.name, tool]));
  const turn: Message[] = [{ role: "user", content: options.prompt }];
  const steps: Step[] = [];
  const usage: Usage = { inputTokens: 0, outputTokens: 0 };
  let output = "";

  const callTool = async (call: ToolCall): Promise<{ step: Step; message: Message }> => {
    const tool = byName.get(call.name);
    let result: string;
    let error = false;
    try {
      if (!tool) throw new Error(`There is no tool "${call.name}"`);
      result = resultText(await tool.call(call.input, signal), options.maxResultChars);
    } catch (caught) {
      stopIfAborted(signal);
      result = `Error: ${(caught as Error).message}`;
      error = true;
    }
    log?.(`${call.name}${error ? " failed" : ""}: ${result.slice(0, 200)}`);
    return {
      step: { tool: call.name, input: call.input, result, error },
      message: {
        role: "tool",
        toolCallId: call.id,
        name: call.name,
        content: result,
        ...(error ? { isError: true } : {}),
      },
    };
  };

  for (let iteration = 0; iteration < options.maxIterations; iteration++) {
    stopIfAborted(signal);
    const answer = await model.chat(
      {
        system: options.system,
        messages: [...options.previous, ...turn],
        tools: options.tools.map((tool) => tool.spec),
      },
      signal,
    );
    usage.inputTokens += answer.usage.inputTokens;
    usage.outputTokens += answer.usage.outputTokens;
    output = answer.text;
    turn.push({
      role: "assistant",
      content: answer.text,
      ...(answer.toolCalls.length > 0 ? { toolCalls: answer.toolCalls } : {}),
      ...(answer.raw ? { raw: answer.raw } : {}),
    });
    if (answer.toolCalls.length === 0) {
      const finishReason = answer.finishReason === "tool_calls" ? "other" : answer.finishReason;
      return { output, finishReason, steps, history: [...options.previous, ...turn], usage };
    }
    // The steps and the results keep the order of the calls.
    for (const done of await mapLimit(answer.toolCalls, TOOL_CONCURRENCY, callTool)) {
      steps.push(done.step);
      turn.push(done.message);
    }
  }
  log?.(`Stopped after ${options.maxIterations} model calls`);
  return {
    output,
    finishReason: "max_iterations",
    steps,
    history: [...options.previous, ...turn],
    usage,
  };
}
