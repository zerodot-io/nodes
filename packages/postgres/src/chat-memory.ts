// SPDX-License-Identifier: AGPL-3.0-only
import type { defineSupplyNode as sdkDefineSupplyNode } from "@zerodot/node-sdk";

// The memory of an AI Agent of @zerodot/ai-agent. The redis and postgres packages have the
// same copy of this file (a test checks it), so they do not need the agent package.

/** The supply kind of the Memory port of the AI Agent. */
export const MEMORY_KIND = "ai.memory";

type ToolCall = { id: string; name: string; input: unknown };

/** One message of the conversation, as the AI Agent gives it. */
export type Message =
  | { role: "user"; content: string }
  | {
      role: "assistant";
      content: string;
      toolCalls?: ToolCall[];
      raw?: { provider: string; content: unknown };
    }
  | { role: "tool"; toolCallId: string; name: string; content: string; isError?: boolean };

/** The value of an "ai.memory" supply: the memory of one conversation. */
export type Memory = {
  /** The messages of the last turns, oldest first. */
  load(): Promise<Message[]>;
  /** Adds the messages of one turn. */
  save(messages: Message[]): Promise<void>;
  /** For the Chat Memory Manager: all messages of the session, oldest first. */
  loadAll(): Promise<Message[]>;
  /** For the Chat Memory Manager: deletes all messages of the session. */
  clear(): Promise<void>;
  /** For the Chat Memory Manager: deletes the last `count` messages. */
  deleteLast(count: number): Promise<void>;
};

/**
 * The same as `defineSupplyNode` of the node SDK 1.4. A running zerodot can keep an older SDK in
 * memory after npm updates the SDK in the nodes folder, and that SDK has no `defineSupplyNode`.
 */
export const defineSupplyNode: typeof sdkDefineSupplyNode = (definition) => ({
  ...definition,
  ports: { in: [], out: [] },
  run: () => {
    throw new Error("A supply node does not run as a step");
  },
});

const ROLES = new Set(["user", "assistant", "tool"]);

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** The messages of one stored turn, from JSON text or a parsed list. Bad items stop the run. */
export function readTurn(value: unknown): Message[] {
  let list = value;
  if (typeof value === "string") {
    try {
      list = JSON.parse(value);
    } catch {
      throw new Error("A turn in the memory is not valid JSON");
    }
  }
  if (!Array.isArray(list)) throw new Error("A turn in the memory is not a list of messages");
  return list.map((item, index) => {
    const ok =
      isObject(item) &&
      typeof item.role === "string" &&
      ROLES.has(item.role) &&
      typeof item.content === "string" &&
      (item.role !== "tool" || typeof item.toolCallId === "string");
    if (!ok) throw new Error(`Message ${index + 1} of a turn in the memory is not valid`);
    return item as Message;
  });
}

/**
 * The messages without an assistant tool call at the end whose results are not all there.
 * A provider refuses a tool call without a result.
 */
export function withoutOpenToolCall(messages: Message[]): Message[] {
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index];
    if (message?.role !== "assistant" || !message.toolCalls?.length) continue;
    const answered = new Set(
      messages.slice(index + 1).flatMap((next) => (next.role === "tool" ? [next.toolCallId] : [])),
    );
    const open = message.toolCalls.some((call) => !answered.has(call.id));
    return open ? messages.slice(0, index) : messages;
  }
  return messages;
}

/**
 * The turns, oldest first, without the last `count` messages. A turn keeps a tool call and its
 * result together, so a cut inside a turn also removes an open tool call. Empty turns go.
 */
export function withoutLastMessages(turns: Message[][], count: number): Message[][] {
  const kept = [...turns];
  let left = count;
  while (left > 0 && kept.length > 0) {
    const last = kept.pop() ?? [];
    if (last.length <= left) {
      left -= last.length;
      continue;
    }
    const cut = withoutOpenToolCall(last.slice(0, last.length - left));
    if (cut.length > 0) kept.push(cut);
    left = 0;
  }
  return kept;
}

/**
 * The start of the change that `withoutLastMessages` made: the turns before `from` stay the same,
 * the turns from `from` go, and `replacement` (none or one turn) comes after them.
 */
export function changeOf(turns: Message[][], kept: Message[][]) {
  let from = 0;
  while (from < kept.length && kept[from] === turns[from]) from++;
  return { from, replacement: kept.slice(from) };
}

/** The Session ID of a memory node, or an error. */
export function sessionOf(config: { sessionId: string }): string {
  const sessionId = config.sessionId.trim();
  if (!sessionId) throw new Error('The node needs "sessionId"');
  return sessionId;
}
