// SPDX-License-Identifier: AGPL-3.0-only
import { isRecord } from "@zerodot/node-sdk";
import { type Access, type CallOptions, callApi, PROVIDER_LABEL, type Provider } from "./api";

type JsonObject = Record<string, unknown>;

export type ToolCall = { id: string; name: string; input: unknown };

/**
 * One message of the conversation, the same for each provider. `raw` is the answer content as
 * the provider gave it. The agent sends it back to the same provider, because some providers
 * need parts that this shape does not keep, such as thinking signatures.
 */
export type Message =
  | { role: "user"; content: string }
  | {
      role: "assistant";
      content: string;
      toolCalls?: ToolCall[];
      raw?: { provider: Provider; content: unknown };
    }
  | { role: "tool"; toolCallId: string; name: string; content: string; isError?: boolean };

export type ToolSpec = { name: string; description: string; inputSchema: JsonObject };

export type FinishReason = "stop" | "length" | "tool_calls" | "content_filter" | "other";

export type Usage = { inputTokens: number; outputTokens: number };

export type ModelTurn = {
  text: string;
  toolCalls: ToolCall[];
  finishReason: FinishReason;
  usage: Usage;
  raw?: { provider: Provider; content: unknown };
};

export type ChatRequest = {
  system: string | undefined;
  messages: Message[];
  tools: ToolSpec[];
  maxTokens: number | undefined;
  temperature: number | undefined;
};

/** A chat model that can call tools. A later sub-node port can give one to the agent. */
export type ChatModel = { chat(request: ChatRequest, signal: AbortSignal): Promise<ModelTurn> };

const rec = (value: unknown): JsonObject => (isRecord(value) ? value : {});
const arr = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
const str = (value: unknown): string | undefined => (typeof value === "string" ? value : undefined);
const num = (value: unknown): number => (typeof value === "number" ? value : 0);

/** The text, or the input as JSON. */
const parseArgs = (text: string): unknown => {
  if (text === "") return {};
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
};

/** The raw content of an earlier answer, when it came from this provider. */
const rawOf = (message: Message, provider: Provider): unknown =>
  message.role === "assistant" && message.raw?.provider === provider
    ? message.raw.content
    : undefined;

// OpenAI and compatible services: Chat Completions

function openaiMessages(system: string | undefined, messages: Message[]): JsonObject[] {
  const out: JsonObject[] = system ? [{ role: "system", content: system }] : [];
  for (const message of messages) {
    if (message.role === "user") out.push({ role: "user", content: message.content });
    else if (message.role === "tool") {
      out.push({ role: "tool", tool_call_id: message.toolCallId, content: message.content });
    } else {
      const calls = message.toolCalls ?? [];
      out.push({
        role: "assistant",
        content: message.content === "" && calls.length > 0 ? null : message.content,
        ...(calls.length > 0
          ? {
              tool_calls: calls.map((call) => ({
                id: call.id,
                type: "function",
                function: { name: call.name, arguments: JSON.stringify(call.input ?? {}) },
              })),
            }
          : {}),
      });
    }
  }
  return out;
}

function openaiTurn(answer: JsonObject): ModelTurn {
  const choice = rec(arr(answer.choices)[0]);
  const message = rec(choice.message);
  const usage = rec(answer.usage);
  const reasons: Record<string, FinishReason> = {
    stop: "stop",
    length: "length",
    tool_calls: "tool_calls",
    function_call: "tool_calls",
    content_filter: "content_filter",
  };
  const toolCalls = arr(message.tool_calls).map((entry, index) => {
    const call = rec(entry);
    const fn = rec(call.function);
    return {
      id: str(call.id) || `call_${index + 1}`,
      name: str(fn.name) ?? "",
      input: parseArgs(str(fn.arguments) ?? ""),
    };
  });
  const reason = str(choice.finish_reason);
  return {
    text: str(message.content) ?? "",
    toolCalls,
    finishReason: toolCalls.length > 0 ? "tool_calls" : (reason && reasons[reason]) || "other",
    usage: { inputTokens: num(usage.prompt_tokens), outputTokens: num(usage.completion_tokens) },
  };
}

// Anthropic: Messages

/** Messages with the same role next to each other become one message. Anthropic needs turns. */
function anthropicMessages(messages: Message[]): JsonObject[] {
  const out: { role: string; content: JsonObject[] }[] = [];
  const push = (role: string, blocks: JsonObject[]) => {
    const last = out.at(-1);
    if (last?.role === role) last.content.push(...blocks);
    else out.push({ role, content: blocks });
  };
  for (const message of messages) {
    if (message.role === "user") push("user", [{ type: "text", text: message.content }]);
    else if (message.role === "tool") {
      push("user", [
        {
          type: "tool_result",
          tool_use_id: message.toolCallId,
          content: message.content,
          ...(message.isError ? { is_error: true } : {}),
        },
      ]);
    } else {
      const raw = rawOf(message, "anthropic");
      const blocks: JsonObject[] = Array.isArray(raw)
        ? raw.map(rec)
        : [
            ...(message.content ? [{ type: "text", text: message.content }] : []),
            ...(message.toolCalls ?? []).map((call) => ({
              type: "tool_use",
              id: call.id,
              name: call.name,
              input: call.input ?? {},
            })),
          ];
      if (blocks.length > 0) push("assistant", blocks);
    }
  }
  return out;
}

function anthropicTurn(answer: JsonObject): ModelTurn {
  const content = arr(answer.content);
  const blocks = content.map(rec);
  const usage = rec(answer.usage);
  const reasons: Record<string, FinishReason> = {
    end_turn: "stop",
    stop_sequence: "stop",
    max_tokens: "length",
    tool_use: "tool_calls",
    refusal: "content_filter",
  };
  const reason = str(answer.stop_reason);
  return {
    text: blocks.map((block) => (block.type === "text" ? (str(block.text) ?? "") : "")).join(""),
    toolCalls: blocks
      .filter((block) => block.type === "tool_use")
      .map((block) => ({
        id: str(block.id) ?? "",
        name: str(block.name) ?? "",
        input: block.input ?? {},
      })),
    finishReason: (reason && reasons[reason]) || "other",
    usage: { inputTokens: num(usage.input_tokens), outputTokens: num(usage.output_tokens) },
    raw: { provider: "anthropic", content },
  };
}

// Google Gemini: generateContent

/** The start of a tool call id that the agent made, for a call that Gemini gave without one. */
const MADE_ID = "zerodot_call_";

function geminiContents(messages: Message[]): JsonObject[] {
  const out: { role: string; parts: JsonObject[] }[] = [];
  const push = (role: string, parts: JsonObject[]) => {
    const last = out.at(-1);
    if (last?.role === role) last.parts.push(...parts);
    else out.push({ role, parts });
  };
  for (const message of messages) {
    if (message.role === "user") push("user", [{ text: message.content }]);
    else if (message.role === "tool") {
      push("user", [
        {
          functionResponse: {
            // An id that the agent made is not sent. Gemini matches the call by name.
            ...(message.toolCallId.startsWith(MADE_ID) ? {} : { id: message.toolCallId }),
            name: message.name,
            response: message.isError ? { error: message.content } : { output: message.content },
          },
        },
      ]);
    } else {
      // The raw parts keep the thought signatures that Gemini needs after a function call.
      const raw = rawOf(message, "gemini");
      const parts: JsonObject[] = Array.isArray(raw)
        ? raw.map(rec)
        : [
            ...(message.content ? [{ text: message.content }] : []),
            ...(message.toolCalls ?? []).map((call) => ({
              functionCall: { id: call.id, name: call.name, args: call.input ?? {} },
            })),
          ];
      if (parts.length > 0) push("model", parts);
    }
  }
  return out;
}

function geminiTurn(answer: JsonObject): ModelTurn {
  const candidate = rec(arr(answer.candidates)[0]);
  const rawParts = arr(rec(candidate.content).parts);
  const parts = rawParts.map(rec);
  const toolCalls = parts
    .filter((part) => isRecord(part.functionCall))
    .map((part, index) => {
      const call = rec(part.functionCall);
      return {
        id: str(call.id) || `${MADE_ID}${index + 1}`,
        name: str(call.name) ?? "",
        input: call.args ?? {},
      };
    });
  const usage = rec(answer.usageMetadata);
  const reason = str(candidate.finishReason) ?? str(rec(answer.promptFeedback).blockReason);
  let finishReason: FinishReason = "other";
  if (toolCalls.length > 0) finishReason = "tool_calls";
  else if (reason === "STOP") finishReason = "stop";
  else if (reason === "MAX_TOKENS") finishReason = "length";
  else if (reason) finishReason = "content_filter";
  return {
    text: parts
      .filter((part) => part.thought !== true)
      .map((part) => str(part.text) ?? "")
      .join(""),
    toolCalls,
    finishReason,
    usage: {
      inputTokens: num(usage.promptTokenCount),
      // Thinking tokens are output tokens that the answer does not show.
      outputTokens: num(usage.candidatesTokenCount) + num(usage.thoughtsTokenCount),
    },
    raw: { provider: "gemini", content: rawParts },
  };
}

/** A Gemini model goes in a path. It can start with "models/". */
function geminiModelPath(model: string): string {
  const id = model.replace(/^models\//, "");
  if (!/^[A-Za-z0-9._-]{1,128}$/.test(id)) throw new Error(`"${model}" is not a model id`);
  return id;
}

/** The chat model of a provider. Each call has its own time limit. */
export function chatModelOf(access: Access, model: string, timeoutMs: number): ChatModel {
  const { provider } = access;
  return {
    async chat(request, signal) {
      const options: CallOptions = { signal, timeoutMs };
      const tools = request.tools;
      if (provider === "anthropic") {
        const answer = await callApi(
          access,
          {
            method: "POST",
            path: "/v1/messages",
            json: {
              model,
              max_tokens: request.maxTokens ?? 4096,
              system: request.system,
              messages: anthropicMessages(request.messages),
              tools:
                tools.length > 0
                  ? tools.map((tool) => ({
                      name: tool.name,
                      description: tool.description,
                      input_schema: tool.inputSchema,
                    }))
                  : undefined,
            },
          },
          options,
        );
        return anthropicTurn(answer);
      }
      if (provider === "gemini") {
        const answer = await callApi(
          access,
          {
            method: "POST",
            path: `/models/${geminiModelPath(model)}:generateContent`,
            json: {
              systemInstruction: request.system ? { parts: [{ text: request.system }] } : undefined,
              contents: geminiContents(request.messages),
              tools:
                tools.length > 0
                  ? [
                      {
                        functionDeclarations: tools.map((tool) => ({
                          name: tool.name,
                          description: tool.description,
                          parametersJsonSchema: tool.inputSchema,
                        })),
                      },
                    ]
                  : undefined,
              generationConfig: {
                temperature: request.temperature,
                maxOutputTokens: request.maxTokens,
              },
            },
          },
          options,
        );
        return geminiTurn(answer);
      }
      const answer = await callApi(
        access,
        {
          method: "POST",
          path: "/chat/completions",
          json: {
            model,
            messages: openaiMessages(request.system, request.messages),
            temperature: request.temperature,
            // Most compatible services know only the older name.
            [provider === "compatible" ? "max_tokens" : "max_completion_tokens"]: request.maxTokens,
            tools:
              tools.length > 0
                ? tools.map((tool) => ({
                    type: "function",
                    function: {
                      name: tool.name,
                      description: tool.description,
                      parameters: tool.inputSchema,
                    },
                  }))
                : undefined,
          },
        },
        options,
      );
      if (!Array.isArray(answer.choices)) {
        throw new Error(`${PROVIDER_LABEL[provider]} gave an answer without "choices"`);
      }
      return openaiTurn(answer);
    },
  };
}
