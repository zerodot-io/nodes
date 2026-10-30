// SPDX-License-Identifier: AGPL-3.0-only
import { isRecord, type NodeRunContext } from "@zerodot/node-sdk";
import type { Memory, Message } from "./types";

type TableStore = NonNullable<NodeRunContext<unknown>["tables"]>;

const ROLES = new Set(["user", "assistant", "tool"]);

/** A list of messages from JSON or from an earlier output. Bad items stop the run. */
export function readMessages(value: unknown, name: string): Message[] {
  let list = value;
  if (typeof value === "string") {
    if (value.trim() === "") return [];
    try {
      list = JSON.parse(value);
    } catch {
      throw new Error(`"${name}" is not valid JSON`);
    }
  }
  if (list === undefined || list === null) return [];
  if (!Array.isArray(list)) throw new Error(`"${name}" must be a list of messages`);
  return list.map((item, index) => {
    if (!isRecord(item) || typeof item.role !== "string" || !ROLES.has(item.role)) {
      throw new Error(`"${name}" item ${index + 1} needs "role": user, assistant, or tool`);
    }
    if (typeof item.content !== "string") {
      throw new Error(`"${name}" item ${index + 1} needs "content" as text`);
    }
    if (item.role === "tool" && typeof item.toolCallId !== "string") {
      throw new Error(`"${name}" item ${index + 1} needs "toolCallId"`);
    }
    return item as Message;
  });
}

/**
 * Memory in a data table. Each run adds one row: `sessionId`, and `messages` (the messages of
 * the turn as JSON text). A turn keeps a tool call and its result together, so a window of turns
 * never splits them. The table needs the two text columns.
 */
export function tableMemory(
  tables: TableStore,
  table: string,
  sessionId: string,
  window: number,
  trim: boolean,
): Memory {
  const bySession = { field: "sessionId", op: "eq" as const, value: sessionId };
  const latest = () =>
    tables.query(table, {
      filter: bySession,
      sort: [{ field: "createdAt", direction: "desc" }],
      limit: window,
    });
  return {
    async load() {
      const { rows } = await latest();
      return rows.reverse().flatMap((row) => readMessages(row.messages, "messages"));
    },
    async save(messages) {
      await tables.insert(table, [{ sessionId, messages: JSON.stringify(messages) }]);
      if (!trim) return;
      // A table holds a limited number of rows. Older turns than the window go.
      const { rows } = await latest();
      const oldest = rows.at(-1);
      if (rows.length < window || !oldest) return;
      await tables.delete(table, {
        filter: { and: [bySession, { field: "createdAt", op: "lt", value: oldest.createdAt }] },
      });
    },
  };
}
