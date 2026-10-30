// SPDX-License-Identifier: AGPL-3.0-only
import { isRecord, type NodeRunContext } from "@zerodot/node-sdk";
import type { Memory, Message } from "./types";

type TableStore = NonNullable<NodeRunContext<unknown>["tables"]>;
type TableRow = Awaited<ReturnType<TableStore["query"]>>["rows"][number];

/** Rows for each page when the memory reads all turns of a session. */
const PAGE_SIZE = 100;

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
  const byId = (id: string) => ({ field: "id", op: "eq" as const, value: id });
  const latest = () =>
    tables.query(table, {
      filter: bySession,
      sort: [{ field: "createdAt", direction: "desc" }],
      limit: window,
    });
  /** Every row of the session, in the order of `direction`. */
  const allRows = async (direction: "asc" | "desc") => {
    const rows: TableRow[] = [];
    let cursor: string | null = null;
    do {
      const page = await tables.query(table, {
        filter: bySession,
        sort: [{ field: "createdAt", direction }],
        limit: PAGE_SIZE,
        cursor,
      });
      rows.push(...page.rows);
      cursor = page.nextCursor;
    } while (cursor);
    return rows;
  };
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
    async loadAll() {
      const rows = await allRows("asc");
      return rows.flatMap((row) => readMessages(row.messages, "messages"));
    },
    async clear() {
      await tables.delete(table, { filter: bySession });
    },
    async deleteLast(count) {
      let left = count;
      for (const row of await allRows("desc")) {
        if (left <= 0) return;
        const messages = readMessages(row.messages, "messages");
        if (messages.length <= left) {
          left -= messages.length;
          await tables.delete(table, { filter: byId(row.id) });
          continue;
        }
        // The cut is inside this turn. A tool call without its result cannot stay.
        const kept = withoutOpenToolCall(messages.slice(0, messages.length - left));
        left = 0;
        if (kept.length === 0) await tables.delete(table, { filter: byId(row.id) });
        else
          await tables.update(table, {
            filter: byId(row.id),
            set: { messages: JSON.stringify(kept) },
          });
      }
    },
  };
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
