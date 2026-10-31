// SPDX-License-Identifier: AGPL-3.0-only
import type { ChatModel, Message, ToolSpec } from "@zerodot/ai-core";
import { isRecord } from "@zerodot/node-sdk";
import { RAG_KIND } from "./rag";

// The values that supply nodes give to the AI Agent. zerodot passes them as unknown, so the
// agent checks the shape when it runs. Another package can import these types to make its own
// supply nodes.

/** The supply kinds of the agent ports. */
export const KIND = {
  model: "ai.model",
  memory: "ai.memory",
  tool: "ai.tool",
  embedding: RAG_KIND.embedding,
} as const;

export type {
  ChatModel,
  ChatRequest,
  FinishReason,
  Message,
  ModelTurn,
  ToolCall,
  ToolSpec,
  Usage,
} from "@zerodot/ai-core";

type JsonObject = Record<string, unknown>;

/** The value of an "ai.memory" supply: the memory of one conversation. */
export type Memory = {
  /** The messages of the last turns, oldest first. */
  load(): Promise<Message[]>;
  /** Adds the messages of one turn. */
  save(messages: Message[]): Promise<void>;
  /** Optional, for the Chat Memory Manager: all messages of the session, oldest first. */
  loadAll?(): Promise<Message[]>;
  /** Optional, for the Chat Memory Manager: deletes all messages of the session. */
  clear?(): Promise<void>;
  /** Optional, for the Chat Memory Manager: deletes the last `count` messages. */
  deleteLast?(count: number): Promise<void>;
};

/** A value of an "ai.tool" supply: one tool that the model can call. */
export type Tool = { spec: ToolSpec; call(input: unknown, signal: AbortSignal): Promise<unknown> };

/**
 * A value of an "ai.tool" supply: a set of tools that needs a connection, such as an MCP
 * server. The agent opens it before the first model call and always closes it after the run.
 */
export type Toolset = { open(signal: AbortSignal): Promise<Tool[]>; close(): Promise<void> };

const hasFunctions = (value: unknown, ...names: string[]): value is JsonObject =>
  isRecord(value) && names.every((name) => typeof value[name] === "function");

export const isChatModel = (value: unknown): value is ChatModel => hasFunctions(value, "chat");

export const isMemory = (value: unknown): value is Memory => hasFunctions(value, "load", "save");

export const isTool = (value: unknown): value is Tool =>
  hasFunctions(value, "call") && isRecord(value.spec) && typeof value.spec.name === "string";

export const isToolset = (value: unknown): value is Toolset => hasFunctions(value, "open", "close");
