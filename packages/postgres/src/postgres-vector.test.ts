// SPDX-License-Identifier: AGPL-3.0-only
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { canBeTool, isRecord, suppliesOf } from "@zerodot/node-sdk";
import { nodes } from "./index";
import type { Run } from "./postgres-memory";
import type { Param, Row } from "./postgres-sql";
import {
  createStatements,
  type Database,
  DESCRIBE,
  pgVectorStore,
  type Store,
  scoreOf,
  storeOf,
  tableInfoOf,
} from "./postgres-vector";
import { type Embeddings, isVectorStore } from "./rag";

const signal = new AbortController().signal;

/** The columns of a table that the node made, with 2 dimensions. */
const COLUMNS = [
  { name: "id", type: "uuid" },
  { name: "collection", type: "text" },
  { name: "content", type: "text" },
  { name: "metadata", type: "jsonb" },
  { name: "embedding", type: "vector(2)" },
];

/**
 * A database that records the queries and answers each one with `answer`. The table is there
 * with `columns`, or is made by the first create statement when `columns` is empty.
 */
function fakeDatabase(
  answer: (query: string, values: Param[]) => Row[] = () => [],
  columns: Row[] = COLUMNS,
) {
  const queries: [string, Param[]][] = [];
  let table = columns;
  let transactions = 0;
  const run: Run = async (query, values) => {
    queries.push([query, values]);
    if (query === DESCRIBE) return table;
    if (query.startsWith("create table")) table = COLUMNS;
    return answer(query, values);
  };
  const database: Database = {
    run,
    transaction: async (work) => {
      transactions++;
      return work(run);
    },
  };
  return { queries, database, transactions: () => transactions };
}

const embeddings: Embeddings = {
  embed: async (texts) => texts.map((_, index) => [index, 1]),
};

const store = (extra: Partial<Store> = {}): Store => ({
  ...storeOf({
    schema: "app",
    table: "docs",
    collection: "",
    distance: "cosine",
    idColumn: "id",
    contentColumn: "content",
    metadataColumn: "metadata",
    embeddingColumn: "embedding",
    collectionColumn: "collection",
  }),
  ...extra,
});

describe("postgres.vectorStore", () => {
  it("has the same shared code as the AI Agent package", () => {
    const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
    assert.equal(read("./rag.ts"), read("../../ai-agent/src/rag.ts"));
  });

  it("is a step, or a supply in the retrieve modes", () => {
    const node = nodes.find((entry) => entry.type === "postgres.vectorStore");
    assert.ok(node);
    assert.deepEqual(
      node.supplyPorts?.map((port) => [port.name, port.kind, port.required ?? false]),
      [
        ["embedding", "ai.embedding", true],
        ["document", "ai.document", false],
        ["reranker", "ai.reranker", false],
      ],
    );
    assert.equal(nodes.length, new Set(nodes.map((entry) => entry.type)).size);
    assert.equal(suppliesOf(node, { mode: "load" }), undefined);
    assert.equal(suppliesOf(node, { mode: "insert" }), undefined);
    assert.equal(suppliesOf(node, { mode: "retrieve" }), "ai.vectorStore");
    assert.equal(suppliesOf(node, { mode: "retrieveAsTool" }), "ai.tool");
    assert.equal(canBeTool(node, { mode: "load" }), false);
  });

  it("makes the table and the indexes, and no vector index above 2000 dimensions", () => {
    const statements = createStatements(store({ distance: "euclidean" }), 3);
    assert.equal(statements[0], "create extension if not exists vector");
    assert.match(statements[1] ?? "", /create table if not exists "app"\."docs" \(/);
    assert.match(statements[1] ?? "", /"embedding" vector\(3\) not null/);
    assert.equal(
      statements[3],
      'create index if not exists "docs_embedding_euclidean_idx" on "app"."docs" using hnsw ("embedding" vector_l2_ops)',
    );
    assert.equal(createStatements(store(), 3072).length, 3);
  });

  it("makes the table once under a lock, and inserts each batch, with the collection", async () => {
    let next = 0;
    const db = fakeDatabase(
      (query) => (query.startsWith("insert") ? [{ id: `u${++next}` }] : []),
      [],
    );
    const vectors = pgVectorStore(db.database, store({ collection: "faq" }), embeddings);
    const rows = await vectors.insert(
      [
        { content: "a", metadata: { n: 1 } },
        { content: "b", metadata: {} },
      ],
      1,
      signal,
    );
    assert.deepEqual(rows, [
      { id: "u1", content: "a", metadata: { n: 1 } },
      { id: "u2", content: "b", metadata: {} },
    ]);
    assert.equal(db.transactions(), 1);
    const texts = db.queries.map(([query]) => query);
    assert.ok(texts.includes("select pg_advisory_xact_lock(hashtext($1::text))"));
    assert.equal(texts.filter((query) => query.startsWith("create table")).length, 1);
    const inserts = db.queries.filter(([query]) => query.startsWith("insert"));
    assert.equal(inserts.length, 2);
    const [query, values] = inserts[1] ?? ["", []];
    assert.match(
      query,
      /insert into "app"\."docs" \("content", "metadata", "embedding", "collection"\)/,
    );
    assert.match(query, /r\.embedding::text::vector, \$2 from jsonb_to_recordset/);
    assert.deepEqual(JSON.parse(String(values[0])), [
      { n: 0, content: "b", metadata: {}, embedding: [0, 1] },
    ]);
    assert.equal(values[1], "faq");
  });

  it("rejects vectors with another length than the table", async () => {
    const db = fakeDatabase();
    const wide: Embeddings = { embed: async (texts) => texts.map(() => [1, 2, 3]) };
    const vectors = pgVectorStore(db.database, store(), wide);
    await assert.rejects(
      vectors.insert([{ content: "a", metadata: {} }], 10, signal),
      /vectors of 2 dimensions, but the embedding model gives 3/,
    );
    await assert.rejects(vectors.search({ query: "q", limit: 1 }, signal), /gives 3/);
  });

  it("names a missing table and a missing or wrong column", async () => {
    const empty = fakeDatabase(() => [], []);
    await assert.rejects(
      pgVectorStore(empty.database, store(), embeddings).search({ query: "q", limit: 1 }, signal),
      /"app"\."docs" is not there/,
    );
    const columns = (types: Record<string, string>) => new Map(Object.entries(types));
    assert.throws(
      () => tableInfoOf(store({ collection: "x" }), columns({ id: "uuid", content: "text" })),
      /no column "metadata", "embedding", "collection"/,
    );
    const base = { id: "bigint", content: "text", metadata: "jsonb" };
    assert.throws(
      () => tableInfoOf(store(), columns({ ...base, embedding: "real[]" })),
      /not a pgvector column/,
    );
    assert.deepEqual(tableInfoOf(store(), columns({ ...base, embedding: "vector" })), {
      idType: "bigint",
      dimensions: undefined,
    });
  });

  it("searches with the filter and gives a score", async () => {
    const db = fakeDatabase(() => [{ id: "u1", content: "a", metadata: { n: 1 }, distance: 0.25 }]);
    const vectors = pgVectorStore(db.database, store(), embeddings);
    const found = await vectors.search({ query: "q", limit: 3, filter: { n: 1 } }, signal);
    assert.deepEqual(found, [{ id: "u1", content: "a", metadata: { n: 1 }, score: 0.75 }]);
    const [query, values] = db.queries.at(-1) ?? ["", []];
    assert.match(query, /"embedding" <=> \$1::text::vector as distance/);
    assert.match(query, /where "metadata" @> \$2::text::jsonb order by/);
    assert.deepEqual(values, ["[0,1]", '{"n":1}', 3]);
    assert.equal(scoreOf("innerProduct", -0.5), 0.5);
    assert.equal(scoreOf("euclidean", 1), 0.5);
  });

  it("updates in one transaction with the ID type, and fails for an unknown ID", async () => {
    const db = fakeDatabase((query, values) =>
      query.startsWith("update") && values[0] === "u1" ? [{ id: "u1" }] : [],
    );
    const vectors = pgVectorStore(db.database, store(), embeddings);
    assert.deepEqual(
      await vectors.update([{ id: "u1", document: { content: "x", metadata: {} } }], signal),
      [{ id: "u1", content: "x", metadata: {} }],
    );
    const [query] = db.queries.at(-1) ?? [""];
    assert.match(query, /where "id" = \$1::text::uuid returning/);
    await assert.rejects(
      vectors.update(
        [
          { id: "u1", document: { content: "x", metadata: {} } },
          { id: "nope", document: { content: "y", metadata: {} } },
        ],
        signal,
      ),
      /No chunk has the ID "nope"/,
    );
    assert.equal(db.transactions(), 2);
  });

  it("deletes by ID with the index, and only in the collection", async () => {
    const db = fakeDatabase(() => [{ id: "u1" }]);
    const vectors = pgVectorStore(db.database, store({ collection: "faq" }), undefined);
    assert.deepEqual(await vectors.delete(["u1", "u2"]), { deleted: 1, ids: ["u1"] });
    const [query, values] = db.queries.at(-1) ?? ["", []];
    assert.match(
      query,
      /where "id" = any\(array\(select jsonb_array_elements_text\(\$1::text::jsonb\)::uuid\)\) and "collection" = \$2 returning/,
    );
    assert.deepEqual(values, ['["u1","u2"]', "faq"]);
    assert.deepEqual(await vectors.delete([]), { deleted: 0, ids: [] });
  });

  const node = nodes.find((entry) => entry.type === "postgres.vectorStore");
  type Context = Parameters<NonNullable<NonNullable<typeof node>["supply"]>>[0];
  const supplyOf = (config: Record<string, unknown>, supplies?: Record<string, unknown>) => {
    assert.ok(node?.supply);
    const context = {
      config: node.config.parse({ ...(node.defaultConfig as Record<string, unknown>), ...config }),
      credential: { type: "postgres", data: { host: "localhost" } },
      signal,
      scope: {},
      sandbox: null,
      tables: null,
      node: { id: "s1", name: "Search docs" },
      supplies,
    };
    return node.supply(context as Context);
  };

  it("the supply needs an embedding model on its port", () => {
    assert.throws(() => supplyOf({ mode: "retrieve" }), /Connect an embedding model/);
    assert.throws(
      () => supplyOf({ mode: "retrieve", rerank: true }, { embedding: embeddings }),
      /Connect a reranker/,
    );
  });

  it("gives a vector store, or a tool named after the node", () => {
    const store = supplyOf({ mode: "retrieve" }, { embedding: embeddings });
    assert.equal(isVectorStore(store), true);
    const tool = supplyOf(
      { mode: "retrieveAsTool", toolDescription: "Search the handbook", limit: 3 },
      { embedding: embeddings },
    );
    assert.ok(isRecord(tool) && isRecord(tool.spec));
    assert.equal(tool.spec.name, "Search_docs");
    assert.equal(tool.spec.description, "Search the handbook");
    assert.equal(typeof tool.call, "function");
    assert.equal(typeof tool.close, "function");
  });

  it("does not run as a step in a retrieve mode", async () => {
    assert.ok(node);
    await assert.rejects(
      async () =>
        node.run({
          config: node.config.parse({
            ...(node.defaultConfig as Record<string, unknown>),
            mode: "retrieve",
          }),
        } as Parameters<typeof node.run>[0]),
      /gives a supply/,
    );
  });
});
