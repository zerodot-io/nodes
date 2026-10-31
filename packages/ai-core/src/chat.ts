// SPDX-License-Identifier: AGPL-3.0-only
import { isRecord } from "@zerodot/node-sdk";
import type {
  AssistantModelMessage,
  JSONSchema7,
  ModelMessage,
  FinishReason as SdkFinishReason,
  ToolSet,
} from "ai";
import { type Access, type CallOptions, signalOf } from "./access";
import { sdkCall } from "./errors";
import { languageModelOf } from "./providers";

// The chat model of the AI Agent, and the parts of it that the AI node uses too.

export type ToolCall = { id: string; name: string; input: unknown };

/**
 * One message of the conversation, the same for each provider. `raw` is the answer content as
 * the model gave it. The agent sends it back to the same provider, because some providers need
 * parts that this shape does not keep, such as thinking signatures.
 */
export type Message =
  | { role: "user"; content: string }
  | {
      role: "assistant";
      content: string;
      toolCalls?: ToolCall[];
      raw?: { provider: string; content: unknown };
    }
  | { role: "tool"; toolCallId: string; name: string; content: string; isError?: boolean };

export type ToolSpec = { name: string; description: string; inputSchema: Record<string, unknown> };

export type FinishReason = "stop" | "length" | "tool_calls" | "content_filter" | "other";

export type Usage = { inputTokens: number; outputTokens: number };

export type ModelTurn = {
  text: string;
  toolCalls: ToolCall[];
  finishReason: FinishReason;
  usage: Usage;
  raw?: { provider: string; content: unknown };
};

export type ChatRequest = { system: string | undefined; messages: Message[]; tools: ToolSpec[] };

/** The value of an "ai.model" supply: a chat model that can call tools. */
export type ChatModel = { chat(request: ChatRequest, signal: AbortSignal): Promise<ModelTurn> };

/** The tools for the AI SDK. They have no `execute`, so the model call stops at a tool call. */
export async function toolSetOf(specs: ToolSpec[]): Promise<ToolSet | undefined> {
  if (specs.length === 0) return undefined;
  const { jsonSchema, tool } = await import("ai");
  return Object.fromEntries(
    specs.map((spec) => [
      spec.name,
      tool({
        description: spec.description,
        inputSchema: jsonSchema(spec.inputSchema as JSONSchema7),
      }),
    ]),
  );
}

/** The finish reason of the AI SDK in the shape of the nodes. A tool call always wins. */
export function finishReasonOf(reason: SdkFinishReason, toolCalls: number): FinishReason {
  if (toolCalls > 0) return "tool_calls";
  const reasons: Partial<Record<SdkFinishReason, FinishReason>> = {
    stop: "stop",
    length: "length",
    "tool-calls": "tool_calls",
    "content-filter": "content_filter",
  };
  return reasons[reason] ?? "other";
}

/** The mark of a raw answer that came from the AI SDK, for the provider. */
const rawMark = (access: Access) => `ai-sdk:${access.provider}`;

export type AssistantPart = Exclude<AssistantModelMessage["content"], string>[number];

const rec = (value: unknown): Record<string, unknown> => (isRecord(value) ? value : {});
const str = (value: unknown): string => (typeof value === "string" ? value : "");

/**
 * The parts of the `content` of an Anthropic answer. Thinking and its signature must go back to
 * Anthropic after a tool call. The AI node gives this content, and older versions kept it.
 */
export function partsOfAnthropic(content: unknown[]): AssistantPart[] {
  return content.map(rec).flatMap((block): AssistantPart[] => {
    if (block.type === "text") return [{ type: "text", text: str(block.text) }];
    if (block.type === "thinking") {
      const signature = str(block.signature);
      return [
        {
          type: "reasoning",
          text: str(block.thinking),
          providerOptions: { anthropic: { signature } },
        },
      ];
    }
    if (block.type === "redacted_thinking") {
      const redactedData = str(block.data);
      return [{ type: "reasoning", text: "", providerOptions: { anthropic: { redactedData } } }];
    }
    if (block.type === "tool_use") {
      return [
        {
          type: "tool-call",
          toolCallId: str(block.id),
          toolName: str(block.name),
          input: block.input ?? {},
        },
      ];
    }
    return [];
  });
}

/** The parts of a Gemini answer. The thought signatures must go back after a function call. */
function partsOfGemini(parts: unknown[]): AssistantPart[] {
  let calls = 0;
  return parts.map(rec).flatMap((part): AssistantPart[] => {
    const thoughtSignature = str(part.thoughtSignature);
    const providerOptions = thoughtSignature ? { google: { thoughtSignature } } : undefined;
    if (isRecord(part.functionCall)) {
      calls += 1;
      return [
        {
          type: "tool-call",
          // The older version made the same id for a call without one.
          toolCallId: str(part.functionCall.id) || `zerodot_call_${calls}`,
          toolName: str(part.functionCall.name),
          input: part.functionCall.args ?? {},
          providerOptions,
        },
      ];
    }
    if (typeof part.text !== "string") return [];
    return part.thought === true
      ? [{ type: "reasoning", text: part.text, providerOptions }]
      : [{ type: "text", text: part.text, providerOptions }];
  });
}

/** The raw content of an answer of an older version, which called the APIs itself. */
function legacyParts(access: Access, raw: unknown[]): AssistantPart[] | undefined {
  if (access.provider === "anthropic") return partsOfAnthropic(raw);
  if (access.provider === "gemini") return partsOfGemini(raw);
  return undefined;
}

function messagesOf(access: Access, messages: Message[]): ModelMessage[] {
  return messages.map((message): ModelMessage => {
    if (message.role === "user") return { role: "user", content: message.content };
    if (message.role === "tool") {
      return {
        role: "tool",
        content: [
          {
            type: "tool-result",
            toolCallId: message.toolCallId,
            toolName: message.name,
            output: message.isError
              ? { type: "error-text", value: message.content }
              : { type: "text", value: message.content },
          },
        ],
      };
    }
    // The raw parts keep the signatures that some providers need after a tool call. A message
    // from another provider has only the text and the tool calls.
    const raw = message.raw;
    if (raw?.provider === rawMark(access) && Array.isArray(raw.content)) {
      return { role: "assistant", content: raw.content };
    }
    const legacy =
      raw?.provider === access.provider && Array.isArray(raw.content)
        ? legacyParts(access, raw.content)
        : undefined;
    if (legacy && legacy.length > 0) return { role: "assistant", content: legacy };
    return {
      role: "assistant",
      content: [
        ...(message.content ? [{ type: "text" as const, text: message.content }] : []),
        ...(message.toolCalls ?? []).map((call) => ({
          type: "tool-call" as const,
          toolCallId: call.id,
          toolName: call.name,
          input: call.input ?? {},
        })),
      ],
    };
  });
}

export type ModelSettings = {
  model: string;
  maxTokens: number | undefined;
  /** Not sent to Anthropic. Its current API version has no temperature. */
  temperature: number | undefined;
  /** The time limit of one call. */
  timeoutMs: number;
};

/** The chat model of a provider, for the "ai.model" supply. */
export function chatModelOf(access: Access, settings: ModelSettings): ChatModel {
  const { provider } = access;
  const { maxTokens, temperature, timeoutMs } = settings;
  return {
    async chat(request, signal) {
      const options: CallOptions = { signal, timeoutMs };
      const { generateText } = await import("ai");
      const model = await languageModelOf(access, settings.model);
      const tools = await toolSetOf(request.tools);
      const result = await sdkCall(provider, "chat", () =>
        generateText({
          model,
          system: request.system,
          messages: messagesOf(access, request.messages),
          tools,
          maxOutputTokens: provider === "anthropic" ? (maxTokens ?? 4096) : maxTokens,
          temperature: provider === "anthropic" ? undefined : temperature,
          // The agent tries again itself, with its own wait.
          maxRetries: 0,
          abortSignal: signalOf(options),
        }),
      );
      const toolCalls = result.toolCalls.map((call) => ({
        id: call.toolCallId,
        name: call.toolName,
        input: call.input,
      }));
      const answer = result.responseMessages.find((entry) => entry.role === "assistant");
      return {
        text: result.text,
        toolCalls,
        finishReason: finishReasonOf(result.finishReason, toolCalls.length),
        usage: {
          inputTokens: result.usage.inputTokens ?? 0,
          outputTokens: result.usage.outputTokens ?? 0,
        },
        ...(answer && Array.isArray(answer.content)
          ? { raw: { provider: rawMark(access), content: answer.content } }
          : {}),
      };
    },
  };
}
