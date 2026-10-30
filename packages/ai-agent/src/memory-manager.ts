// SPDX-License-Identifier: AGPL-3.0-only
import { defineNode, type FieldSpec } from "@zerodot/node-sdk";
import { z } from "zod";
import { MEMORY_ICON } from "./icon";
import { isMemory, KIND, type Memory, type Message } from "./types";

const OPERATIONS = ["get", "insert", "delete"] as const;

export const messagesSpec: FieldSpec = {
  name: "messages",
  label: "Messages",
  kind: "fixed",
  multiple: true,
  groups: [
    {
      name: "values",
      label: "Message",
      fields: [
        {
          name: "role",
          label: "Type",
          kind: "options",
          default: "user",
          options: [
            { value: "user", label: "User", hint: "A message from the person" },
            { value: "assistant", label: "AI", hint: "A message from the agent" },
          ],
        },
        { name: "content", label: "Message", kind: "string", multiline: true },
      ],
    },
  ],
};

const messageRows = z
  .object({
    values: z
      .array(
        z.object({
          role: z.enum(["user", "assistant"]).default("user"),
          content: z.string().default(""),
        }),
      )
      .default([]),
  })
  .default({ values: [] });

/** The messages of the Messages field. Empty messages are left out. */
function readRows(value: unknown): Message[] {
  const parsed = messageRows.safeParse(value ?? undefined);
  if (!parsed.success) throw new Error('"messages" is not a list of messages');
  return parsed.data.values
    .filter((row) => row.content.trim() !== "")
    .map((row) => ({ role: row.role, content: row.content }));
}

/** The method of the memory, or an error that names it. */
function need<K extends "loadAll" | "clear" | "deleteLast">(
  memory: Memory,
  key: K,
): NonNullable<Memory[K]> {
  const method = memory[key];
  if (typeof method !== "function") {
    throw new Error(`The memory on "Memory" cannot do this. It has no ${key}()`);
  }
  return method.bind(memory) as NonNullable<Memory[K]>;
}

/** Only the role and the text of each message. */
const simplify = (messages: Message[]) =>
  messages.map((message) => ({ role: message.role, content: message.content }));

export default defineNode({
  type: "agent.memory.manage",
  label: "Chat Memory Manager",
  description: "Read, add, or delete the messages in the memory of an AI Agent",
  category: "integration",
  icon: "DatabaseIcon",
  iconUrl: MEMORY_ICON,
  config: z.object({
    operation: z
      .enum(OPERATIONS)
      .default("get")
      .meta({
        title: "Operation",
        labels: { get: "Get Messages", insert: "Insert Messages", delete: "Delete Messages" },
        hints: {
          get: "Read the messages of the session",
          insert: "Add messages, or replace all of them",
          delete: "Delete the last messages, or all of them",
        },
      }),
    scope: z
      .enum(["all", "window"])
      .default("all")
      .meta({
        showWhen: { operation: ["get"] },
        title: "Messages",
        labels: { all: "All", window: "Turns to Remember" },
        hints: {
          all: "Every message of the session",
          window: "Only the turns that the agent reads (the setting of the memory node)",
        },
      }),
    insertMode: z
      .enum(["append", "override"])
      .default("append")
      .meta({
        showWhen: { operation: ["insert"] },
        title: "Insert Mode",
        labels: { append: "Add Messages", override: "Replace All Messages" },
        hints: {
          append: "Add the messages after the ones in the memory",
          override: "Delete the messages of the session, then add these",
        },
      }),
    messages: z
      .record(z.string(), z.unknown())
      .optional()
      .meta({
        showWhen: { operation: ["insert"] },
        title: "Messages",
        ui: "field-collection",
        fieldSpec: messagesSpec,
      }),
    deleteMode: z
      .enum(["last", "all"])
      .default("last")
      .meta({
        showWhen: { operation: ["delete"] },
        title: "Delete Mode",
        labels: { last: "Last N", all: "All Messages" },
        hints: {
          last: "Delete the newest messages",
          all: "Delete every message of the session",
        },
      }),
    count: z
      .number()
      .int()
      .min(1)
      .default(2)
      .meta({
        showWhen: { operation: ["delete"], deleteMode: ["last"] },
        title: "Messages Count",
        description: "How many of the newest messages to delete",
      }),
    simplify: z.boolean().default(true).meta({
      title: "Simplify Output",
      description: "Only the role and the text of each message",
    }),
  }),
  defaultConfig: { operation: "get", scope: "all", simplify: true },
  ports: { in: ["in"], out: ["out"] },
  supplyPorts: [{ name: "memory", kind: KIND.memory, label: "Memory", required: true }],
  subtitle: (config) => (typeof config.operation === "string" ? config.operation : undefined),
  // The output is the messages of the session after the operation.
  async run({ config, supplies }) {
    const memory = supplies?.memory;
    if (!isMemory(memory)) throw new Error('Connect a memory to "Memory"');
    if (config.operation === "insert") {
      const messages = readRows(config.messages);
      if (messages.length === 0) throw new Error('The node needs "messages"');
      if (config.insertMode === "override") await need(memory, "clear")();
      await memory.save(messages);
    } else if (config.operation === "delete") {
      if (config.deleteMode === "all") await need(memory, "clear")();
      else await need(memory, "deleteLast")(config.count);
    }
    const messages =
      config.operation === "get" && config.scope === "window"
        ? await memory.load()
        : await need(memory, "loadAll")();
    return { port: "out", data: { messages: config.simplify ? simplify(messages) : messages } };
  },
});
