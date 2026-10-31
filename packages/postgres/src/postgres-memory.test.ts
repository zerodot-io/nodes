// SPDX-License-Identifier: AGPL-3.0-only
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Message } from "./chat-memory";
import { nodes } from "./index";
import { type Connect, createStatements, postgresMemory, type Run } from "./postgres-memory";
import type { Param, Row } from "./postgres-sql";

/** A database that records the queries and answers each one with `answer`. */
function fakeDatabase(answer: (query: string, values: Param[]) => Row[] = () => []) {
  const queries: [string, Param[]][] = [];
  let connections = 0;
  const run: Run = async (query, values) => {
    queries.push([query, values]);
    return answer(query, values);
  };
  const connect: Connect = async (work) => {
    connections++;
    return work(run);
  };
  return { queries, connect, connections: () => connections };
}

const user = (content: string): Message => ({ role: "user", content });
const ai = (content: string): Message => ({ role: "assistant", content });

const options = { schema: "public", table: "memory", sessionId: "s1", turns: 3, trim: false };

describe("postgres.memory", () => {
  it("is a supply node of the memory kind", () => {
    const node = nodes.find((entry) => entry.type === "postgres.memory");
    assert.equal(node?.supplies, "ai.memory");
    assert.deepEqual(node?.ports, { in: [], out: [] });
    assert.deepEqual(node?.credentialTypes, ["postgres"]);
  });

  it("makes the table and its index once, with quoted names", async () => {
    assert.deepEqual(createStatements("app", 'my"table'), [
      'create table if not exists "app"."my""table" (id bigserial primary key, session_id text not null, messages jsonb not null, created_at timestamptz not null default now())',
      'create index if not exists "my""table_session_id_idx" on "app"."my""table" (session_id, id)',
    ]);
    const db = fakeDatabase();
    const memory = postgresMemory(db.connect, options);
    await memory.load();
    await memory.load();
    assert.equal(db.queries.filter(([query]) => query.startsWith("create")).length, 2);
    assert.equal(db.connections(), 2);
  });

  it("reads the last turns, oldest first", async () => {
    const db = fakeDatabase((query) =>
      query.startsWith("select")
        ? [{ messages: [user("b"), ai("2")] }, { messages: JSON.stringify([user("a"), ai("1")]) }]
        : [],
    );
    const memory = postgresMemory(db.connect, options);
    assert.deepEqual(await memory.load(), [user("a"), ai("1"), user("b"), ai("2")]);
    assert.deepEqual(db.queries.at(-1)?.[1], ["s1", 3]);
  });

  it("adds one row for each turn and deletes older turns on request", async () => {
    const db = fakeDatabase();
    await postgresMemory(db.connect, options).save([user("a")]);
    assert.deepEqual(db.queries.at(-1), [
      'insert into "public"."memory" (session_id, messages) values ($1, $2::text::jsonb)',
      ["s1", '[{"role":"user","content":"a"}]'],
    ]);
    await postgresMemory(db.connect, { ...options, trim: true }).save([user("a")]);
    assert.match(db.queries.at(-1)?.[0] ?? "", /^delete .* id < \(select min\(id\)/);
  });

  it("deletes the last messages: whole rows, then a part of one", async () => {
    const rows = [
      { id: "1", messages: [user("a"), ai("1")] },
      { id: "2", messages: [user("b"), ai("2")] },
    ];
    const db = fakeDatabase((query) => (query.startsWith("select") ? rows : []));
    const memory = postgresMemory(db.connect, options);
    await memory.deleteLast(2);
    assert.deepEqual(db.queries.at(-1), [
      'delete from "public"."memory" where session_id = $1 and id >= $2',
      ["s1", "2"],
    ]);
    await memory.deleteLast(3);
    assert.deepEqual(db.queries.at(-1)?.[1], ["s1", "1", '[{"role":"user","content":"a"}]']);
    assert.match(db.queries.at(-1)?.[0] ?? "", /^with changed as \(update/);
  });
});
