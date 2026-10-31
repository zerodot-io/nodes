// SPDX-License-Identifier: AGPL-3.0-only
import { z } from "zod";
import {
  changeOf,
  defineSupplyNode,
  MEMORY_KIND,
  type Memory,
  readTurn,
  sessionOf,
  withoutLastMessages,
} from "./chat-memory";
import { POSTGRES_ICON } from "./icon";
import { loadPostgres, POSTGRES_CREDENTIAL_TYPES, postgresOptions } from "./postgres";
import { type Param, qualified, quoteIdent, type Row } from "./postgres-sql";

/** Runs one query with parameters. A test can fake it. */
export type Run = (query: string, values: Param[]) => Promise<Row[]>;

/** Opens a connection, gives `run` to `work`, and closes the connection. */
export type Connect = <T>(work: (run: Run) => Promise<T>) => Promise<T>;

type Options = { schema: string; table: string; sessionId: string; turns: number; trim: boolean };

/** The statements that make the table and its index when they are not there. */
export function createStatements(schema: string, table: string): string[] {
  const name = qualified(schema, table);
  return [
    `create table if not exists ${name} (id bigserial primary key, session_id text not null, messages jsonb not null, created_at timestamptz not null default now())`,
    `create index if not exists ${quoteIdent(`${table}_session_id_idx`)} on ${name} (session_id, id)`,
  ];
}

/**
 * Memory in a Postgres table. Each turn is one row: `session_id`, and `messages` (the messages of
 * the turn as JSONB). A turn keeps a tool call and its result together, so a window of turns
 * never splits them. The memory makes the table when it is not there. Each call opens its own
 * connection, because a supply has no close.
 */
export function postgresMemory(connect: Connect, options: Options): Memory {
  const { sessionId, turns, trim } = options;
  const table = qualified(options.schema, options.table);
  let created = false;
  const withRun = <T>(work: (run: Run) => Promise<T>) =>
    connect(async (run) => {
      if (!created) {
        for (const statement of createStatements(options.schema, options.table)) {
          await run(statement, []);
        }
        created = true;
      }
      return work(run);
    });
  const allRows = (run: Run) =>
    run(`select id, messages from ${table} where session_id = $1 order by id`, [sessionId]);
  return {
    load: () =>
      withRun(async (run) => {
        const rows = await run(
          `select messages from ${table} where session_id = $1 order by id desc limit $2`,
          [sessionId, turns],
        );
        return rows.reverse().flatMap((row) => readTurn(row.messages));
      }),
    save: (messages) =>
      withRun(async (run) => {
        // Text, then JSONB, so the driver does not encode the JSON a second time.
        await run(`insert into ${table} (session_id, messages) values ($1, $2::text::jsonb)`, [
          sessionId,
          JSON.stringify(messages),
        ]);
        if (!trim) return;
        // Older turns than the window go.
        await run(
          `delete from ${table} where session_id = $1 and id < (select min(id) from (select id from ${table} where session_id = $1 order by id desc limit $2) as kept)`,
          [sessionId, turns],
        );
      }),
    loadAll: () =>
      withRun(async (run) => (await allRows(run)).flatMap((row) => readTurn(row.messages))),
    clear: () =>
      withRun(async (run) => {
        await run(`delete from ${table} where session_id = $1`, [sessionId]);
      }),
    deleteLast: (count) =>
      withRun(async (run) => {
        const rows = await allRows(run);
        const all = rows.map((row) => readTurn(row.messages));
        const { from, replacement } = changeOf(all, withoutLastMessages(all, count));
        const first = rows[from];
        if (!first) return;
        const id = String(first.id);
        const [turn] = replacement;
        if (!turn) {
          await run(`delete from ${table} where session_id = $1 and id >= $2`, [sessionId, id]);
          return;
        }
        // One statement, so the change is all or nothing.
        await run(
          `with changed as (update ${table} set messages = $3::text::jsonb where id = $2) delete from ${table} where session_id = $1 and id > $2`,
          [sessionId, id, JSON.stringify(turn)],
        );
      }),
  };
}

export default defineSupplyNode({
  type: "postgres.memory",
  label: "Postgres Chat Memory",
  description: "Keeps the conversation of the AI Agent in a Postgres table",
  category: "integration",
  icon: "DatabaseIcon",
  iconUrl: POSTGRES_ICON,
  supplies: MEMORY_KIND,
  config: z.object({
    sessionId: z.string().default("").meta({
      title: "Session ID",
      description: "One conversation, such as {{ $input.chatId }}. It reads the input of the agent",
    }),
    schema: z.string().default("public").meta({ title: "Schema" }),
    table: z.string().default("zerodot_chat_memory").meta({
      title: "Table",
      description: "The memory makes the table when it is not there",
    }),
    turns: z.number().int().min(1).max(100).default(10).meta({
      title: "Turns to Remember",
      description: "How many earlier runs of the session the agent reads",
    }),
    trim: z.boolean().default(false).meta({
      title: "Delete Older Turns",
      description: "Delete the turns of the session that are older than the turns to remember",
    }),
  }),
  defaultConfig: {
    sessionId: "",
    schema: "public",
    table: "zerodot_chat_memory",
    turns: 10,
    trim: false,
  },
  credentialTypes: POSTGRES_CREDENTIAL_TYPES,
  subtitle: (config) =>
    typeof config.table === "string" && config.table !== "" ? config.table : undefined,
  supply: ({ config, credential, signal }) => {
    const schema = config.schema.trim() || "public";
    const table = config.table.trim();
    if (!table) throw new Error('The node needs "table"');
    // A missing credential or host stops the run before the agent calls the model.
    const settings = postgresOptions(credential);
    const connect: Connect = async (work) => {
      const postgres = await loadPostgres();
      const sql = postgres(settings);
      const abort = () => void sql.end({ timeout: 0 });
      signal.addEventListener("abort", abort, { once: true });
      try {
        return await work(async (query, values) => [...(await sql.unsafe(query, values))]);
      } finally {
        signal.removeEventListener("abort", abort);
        await sql.end({ timeout: 5 });
      }
    };
    return postgresMemory(connect, {
      schema,
      table,
      sessionId: sessionOf(config),
      turns: config.turns,
      trim: config.trim,
    });
  },
});
