// SPDX-License-Identifier: AGPL-3.0-only
import {
  defineNode,
  type ResolvedCredential,
  resolveTemplate,
  type ShowRules,
  type SupplyPort,
  TOOL_KIND,
  toolName,
} from "@zerodot/node-sdk";
import { z } from "zod";
import { POSTGRES_ICON } from "./icon";
import { loadPostgres, POSTGRES_CREDENTIAL_TYPES, postgresOptions } from "./postgres";
import type { Run } from "./postgres-memory";
import {
  isRecord,
  parsePostgresError,
  qualified,
  quoteIdent,
  type Row,
  toItems,
} from "./postgres-sql";
import {
  candidatesOf,
  type Document,
  documentsOf,
  type Embeddings,
  filterOf,
  isDocumentLoader,
  isEmbeddings,
  isReranker,
  type Match,
  RAG_KIND,
  rerankedStore,
  rerankMatches,
  type SearchRequest,
  searchTool,
  supplyOn,
  type VectorStore,
} from "./rag";

export const DISTANCES = ["cosine", "euclidean", "innerProduct"] as const;
export type Distance = (typeof DISTANCES)[number];

/** The pgvector operator and index class of each distance. */
const OPERATOR_OF = { cosine: "<=>", euclidean: "<->", innerProduct: "<#>" } as const;
const OPS_OF = {
  cosine: "vector_cosine_ops",
  euclidean: "vector_l2_ops",
  innerProduct: "vector_ip_ops",
} as const;

/** An HNSW index on the vector type takes at most 2000 dimensions. */
const MAX_INDEX_DIMENSIONS = 2000;

/** A score where higher is closer. The inner product operator gives the negative product. */
export const scoreOf = (distance: Distance, value: number): number =>
  distance === "cosine" ? 1 - value : distance === "innerProduct" ? -value : 1 / (1 + value);

export type Columns = {
  id: string;
  content: string;
  metadata: string;
  embedding: string;
  collection: string;
};

export type Store = {
  schema: string;
  table: string;
  distance: Distance;
  columns: Columns;
  /** Empty means all rows of the table. */
  collection: string;
};

/** A connection: one query, or queries in one transaction. A test can fake it. */
export type Database = {
  run: Run;
  transaction<T>(work: (run: Run) => Promise<T>): Promise<T>;
};

/** The statements that make the extension, the table, and its indexes. */
export function createStatements(store: Store, dimensions: number): string[] {
  const name = qualified(store.schema, store.table);
  const c = store.columns;
  const statements = [
    "create extension if not exists vector",
    `create table if not exists ${name} (${quoteIdent(c.id)} uuid primary key default gen_random_uuid(), ${quoteIdent(c.collection)} text not null default '', ${quoteIdent(c.content)} text not null, ${quoteIdent(c.metadata)} jsonb not null default '{}', ${quoteIdent(c.embedding)} vector(${dimensions}) not null, created_at timestamptz not null default now())`,
    `create index if not exists ${quoteIdent(`${store.table}_${c.collection}_idx`)} on ${name} (${quoteIdent(c.collection)})`,
  ];
  if (dimensions <= MAX_INDEX_DIMENSIONS) {
    statements.push(
      `create index if not exists ${quoteIdent(`${store.table}_${c.embedding}_${store.distance}_idx`)} on ${name} using hnsw (${quoteIdent(c.embedding)} ${OPS_OF[store.distance]})`,
    );
  }
  return statements;
}

/** The columns of a table and their types, or undefined when the table is not there. */
export const DESCRIBE =
  "select a.attname as name, format_type(a.atttypid, a.atttypmod) as type from pg_attribute a where a.attrelid = to_regclass($1::text) and a.attnum > 0 and not a.attisdropped";

/** A type name that is safe in a cast, such as `uuid`, `bigint`, or `character varying(64)`. */
const SAFE_TYPE = /^[a-z][a-z0-9_ ]*(\(\d+(,\d+)?\))?$/i;

export type TableInfo = { idType: string; dimensions: number | undefined };

/** The ID type and the vector length of a table. An error names a missing or wrong column. */
export function tableInfoOf(store: Store, types: Map<string, string>): TableInfo {
  const c = store.columns;
  const needed = [c.id, c.content, c.metadata, c.embedding];
  if (store.collection) needed.push(c.collection);
  const missing = needed.filter((name) => !types.has(name));
  if (missing.length > 0) {
    throw new Error(
      `The table "${store.schema}"."${store.table}" has no column ${missing.map((name) => `"${name}"`).join(", ")}. Check the column names`,
    );
  }
  const vector = /^vector(?:\((\d+)\))?$/.exec(types.get(c.embedding) ?? "");
  if (!vector) {
    throw new Error(
      `The column "${c.embedding}" is not a pgvector column. Its type is ${types.get(c.embedding)}`,
    );
  }
  const idType = types.get(c.id) ?? "";
  if (!SAFE_TYPE.test(idType)) throw new Error(`The node cannot use an ID of the type ${idType}`);
  return { idType, dimensions: vector[1] ? Number(vector[1]) : undefined };
}

/** An error when the vectors do not have the length of the table. */
function checkLength(info: TableInfo, store: Store, length: number) {
  if (info.dimensions !== undefined && info.dimensions !== length) {
    throw new Error(
      `The table "${store.table}" has vectors of ${info.dimensions} dimensions, but the embedding model gives ${length}. Use the model and the dimensions of the table, or another table`,
    );
  }
}

/** The SQL text of the collection condition, and its value. Empty means no condition. */
const collectionWhere = (store: Store, param: number): [string, string[]] =>
  store.collection
    ? [` and ${quoteIdent(store.columns.collection)} = $${param}`, [store.collection]]
    : ["", []];

/** A pgvector store on one table. It reads the columns of the table one time. */
export function pgVectorStore(
  database: Database,
  store: Store,
  embeddings: Embeddings | undefined,
) {
  const { run } = database;
  const table = qualified(store.schema, store.table);
  const c = store.columns;
  const id = quoteIdent(c.id);
  const content = quoteIdent(c.content);
  const metadata = quoteIdent(c.metadata);
  const embedding = quoteIdent(c.embedding);
  const needEmbeddings = (): Embeddings => {
    if (!embeddings) throw new Error('Connect an embedding model to "Embedding"');
    return embeddings;
  };

  let info: TableInfo | undefined;
  const describe = async (): Promise<TableInfo | undefined> => {
    if (info) return info;
    const rows = await run(DESCRIBE, [table]);
    if (rows.length === 0) return undefined;
    info = tableInfoOf(store, new Map(rows.map((row) => [String(row.name), String(row.type)])));
    return info;
  };
  const existing = async (): Promise<TableInfo> => {
    const found = await describe();
    if (!found) {
      throw new Error(
        `The table "${store.schema}"."${store.table}" is not there. Insert documents first, or check the schema and the table`,
      );
    }
    return found;
  };
  /** Makes the table when it is not there. A lock stops two runs that make it at one time. */
  const ensure = async (dimensions: number): Promise<TableInfo> => {
    if (!(await describe())) {
      await database.transaction(async (tx) => {
        await tx("select pg_advisory_xact_lock(hashtext($1::text))", [table]);
        for (const statement of createStatements(store, dimensions)) await tx(statement, []);
      });
    }
    const found = await existing();
    checkLength(found, store, dimensions);
    return found;
  };
  /** The vector of each text, with the length of the table. */
  const embedChecked = async (texts: string[], use: "document" | "query", signal: AbortSignal) => {
    const vectors = await needEmbeddings().embed(texts, use, signal);
    if (vectors.length !== texts.length) {
      throw new Error(
        `The embedding model gave ${vectors.length} vectors for ${texts.length} texts`,
      );
    }
    return vectors;
  };

  return {
    /**
     * Embeds and inserts the chunks, one batch after the other. The table is made when it is
     * not there. When a batch fails, the batches before it stay in the table.
     */
    async insert(documents: Document[], batchSize: number, signal: AbortSignal): Promise<Row[]> {
      const inserted: Row[] = [];
      for (let start = 0; start < documents.length; start += batchSize) {
        const batch = documents.slice(start, start + batchSize);
        const vectors = await embedChecked(
          batch.map((document) => document.content),
          "document",
          signal,
        );
        const found = await ensure(vectors[0]?.length ?? 0);
        for (const vector of vectors) checkLength(found, store, vector.length);
        // One JSON text, so the driver sends one value. JSON numbers are the vector text of pgvector.
        const rows = batch.map((document, index) => ({
          n: index,
          content: document.content,
          metadata: document.metadata,
          embedding: vectors[index],
        }));
        const columns = [content, metadata, embedding];
        const values = ["r.content", "r.metadata", "r.embedding::text::vector"];
        if (store.collection) {
          columns.push(quoteIdent(c.collection));
          values.push("$2");
        }
        const ids = await run(
          `insert into ${table} (${columns.join(", ")}) select ${values.join(", ")} from jsonb_to_recordset($1::text::jsonb) as r(n int, content text, metadata jsonb, embedding jsonb) order by r.n returning ${id}::text as id`,
          [JSON.stringify(rows), ...(store.collection ? [store.collection] : [])],
        );
        inserted.push(
          ...ids.map((row, index) => ({
            id: row.id,
            content: batch[index]?.content,
            metadata: batch[index]?.metadata,
          })),
        );
      }
      return inserted;
    },

    /** The closest chunks to the query, closest first. */
    async search(request: SearchRequest, signal: AbortSignal): Promise<Match[]> {
      const found = await existing();
      const [vector] = await embedChecked([request.query], "query", signal);
      if (!vector) throw new Error("The embedding model gave no vector for the query");
      checkLength(found, store, vector.length);
      const operator = OPERATOR_OF[store.distance];
      const [where, extra] = collectionWhere(store, 4);
      const rows = await run(
        `select ${id}::text as id, ${content} as content, ${metadata} as metadata, ${embedding} ${operator} $1::text::vector as distance from ${table} where ${metadata} @> $2::text::jsonb${where} order by ${embedding} ${operator} $1::text::vector limit $3`,
        [JSON.stringify(vector), JSON.stringify(request.filter ?? {}), request.limit, ...extra],
      );
      return rows.map((row) => ({
        id: String(row.id),
        content: typeof row.content === "string" ? row.content : String(row.content ?? ""),
        metadata: isRecord(row.metadata) ? row.metadata : {},
        score: scoreOf(store.distance, Number(row.distance)),
      }));
    },

    /**
     * Replaces the text, the metadata, and the vector of each chunk. The vectors come first,
     * then all changes go in one transaction: when an ID is not there, nothing changes.
     */
    async update(changes: { id: string; document: Document }[], signal: AbortSignal) {
      if (changes.length === 0) return [];
      const found = await existing();
      const vectors = await embedChecked(
        changes.map((change) => change.document.content),
        "document",
        signal,
      );
      for (const vector of vectors) checkLength(found, store, vector.length);
      const [where, extra] = collectionWhere(store, 5);
      return database.transaction(async (tx) => {
        const updated: Row[] = [];
        for (const [index, change] of changes.entries()) {
          const rows = await tx(
            `update ${table} set ${content} = $2, ${metadata} = $3::text::jsonb, ${embedding} = $4::text::vector where ${id} = $1::text::${found.idType}${where} returning ${id}::text as id`,
            [
              change.id,
              change.document.content,
              JSON.stringify(change.document.metadata),
              JSON.stringify(vectors[index]),
              ...extra,
            ],
          );
          if (rows.length === 0) throw new Error(`No chunk has the ID "${change.id}"`);
          updated.push({
            id: change.id,
            content: change.document.content,
            metadata: change.document.metadata,
          });
        }
        return updated;
      });
    },

    /** Deletes the chunks with these IDs, in one statement. */
    async delete(ids: string[]): Promise<Row> {
      if (ids.length === 0) return { deleted: 0, ids: [] };
      const found = await existing();
      const [where, extra] = collectionWhere(store, 2);
      const rows = await run(
        `delete from ${table} where ${id} = any(array(select jsonb_array_elements_text($1::text::jsonb)::${found.idType}))${where} returning ${id}::text as id`,
        [JSON.stringify(ids), ...extra],
      );
      return { deleted: rows.length, ids: rows.map((row) => row.id) };
    },
  };
}

/** A list from text with commas, or from an array. */
export function listOf(value: unknown): string[] {
  const entries = Array.isArray(value) ? value : String(value ?? "").split(",");
  return entries.map((entry) => String(entry).trim()).filter(Boolean);
}

/** A supply port that shows only for some settings. The node SDK 1.5 reads `showWhen`. */
const port = (definition: SupplyPort & ShowRules): SupplyPort => definition;

/** The fields of the table, the same for the step and for the supply. */
const storeFields = {
  schema: z.string().default("public").meta({ title: "Schema" }),
  table: z.string().default("zerodot_vectors").meta({
    title: "Table",
    description:
      "Insert makes the table and the vector extension when they are not there. The user needs the right to do it",
  }),
  collection: z.string().default("").meta({
    title: "Collection",
    description:
      "Optional. A name that keeps a set of chunks apart from the other sets in the same table",
  }),
  distance: z
    .enum(DISTANCES)
    .default("cosine")
    .meta({
      title: "Distance",
      labels: { cosine: "Cosine", euclidean: "Euclidean", innerProduct: "Inner Product" },
      hints: {
        cosine: "A good first choice",
        euclidean: "The straight-line distance",
        innerProduct: "For vectors with a length of 1",
      },
    }),
  idColumn: z.string().default("id").meta({ title: "ID Column Name" }),
  contentColumn: z.string().default("content").meta({ title: "Content Column Name" }),
  metadataColumn: z.string().default("metadata").meta({ title: "Metadata Column Name" }),
  embeddingColumn: z.string().default("embedding").meta({ title: "Vector Column Name" }),
  collectionColumn: z.string().default("collection").meta({ title: "Collection Column Name" }),
};

const storeDefaults = {
  schema: "public",
  table: "zerodot_vectors",
  collection: "",
  distance: "cosine",
  idColumn: "id",
  contentColumn: "content",
  metadataColumn: "metadata",
  embeddingColumn: "embedding",
  collectionColumn: "collection",
} as const;

type StoreConfig = { [Key in Exclude<keyof typeof storeDefaults, "distance">]: string } & {
  distance: Distance;
};

/** The checked table settings. */
export function storeOf(config: StoreConfig): Store {
  const table = config.table.trim();
  if (!table) throw new Error('The node needs "table"');
  const column = (value: string, fallback: string) => value.trim() || fallback;
  return {
    schema: config.schema.trim() || "public",
    table,
    distance: config.distance,
    collection: config.collection.trim(),
    columns: {
      id: column(config.idColumn, "id"),
      content: column(config.contentColumn, "content"),
      metadata: column(config.metadataColumn, "metadata"),
      embedding: column(config.embeddingColumn, "embedding"),
      collection: column(config.collectionColumn, "collection"),
    },
  };
}

/** A connection that ends when `close` runs or when the signal stops. */
async function connectionOf(credential: ResolvedCredential | null, signal: AbortSignal) {
  const settings = postgresOptions(credential);
  const postgres = await loadPostgres();
  const sql = postgres(settings);
  const abort = () => void sql.end({ timeout: 0 });
  signal.addEventListener("abort", abort, { once: true });
  const database: Database = {
    run: async (query, values) => [...(await sql.unsafe(query, values))],
    transaction: async (work) =>
      (await sql.begin((tx) =>
        work(async (query, values) => [...(await tx.unsafe(query, values))]),
      )) as Awaited<ReturnType<typeof work>>,
  };
  const close = async () => {
    signal.removeEventListener("abort", abort);
    await sql.end({ timeout: 5 });
  };
  return { database, close };
}

const MODES = ["load", "insert", "retrieve", "retrieveAsTool", "update", "delete"] as const;
type Mode = (typeof MODES)[number];

const MODE_LABELS: Record<Mode, string> = {
  load: "Get Many",
  insert: "Insert Documents",
  retrieve: "Retrieve Documents (As Vector Store for Chain/Tool)",
  retrieveAsTool: "Retrieve Documents (As Tool for AI Agent)",
  update: "Update Documents",
  delete: "Delete Documents",
};

/** The modes that search, and so can use a reranker. */
const SEARCH_MODES: Mode[] = ["load", "retrieve", "retrieveAsTool"];

/** The connection of a supply, opened on the first search. `close` ends it. */
function lazyStore(
  credential: ResolvedCredential | null,
  signal: AbortSignal,
  store: Store,
  embeddings: Embeddings,
): VectorStore & { close(): Promise<void> } {
  let opened:
    | Promise<{ vectors: ReturnType<typeof pgVectorStore>; close: () => Promise<void> }>
    | undefined;
  return {
    async search(request, searchSignal) {
      opened ??= connectionOf(credential, signal).then((connection) => ({
        vectors: pgVectorStore(connection.database, store, embeddings),
        close: connection.close,
      }));
      try {
        return await (await opened).vectors.search(request, searchSignal);
      } catch (error) {
        throw parsePostgresError(error, []);
      }
    },
    async close() {
      const connection = opened;
      opened = undefined;
      if (connection) await (await connection).close();
    },
  };
}

export default defineNode({
  type: "postgres.vectorStore",
  label: "Postgres Vector Store",
  description: "Keep chunks of text as vectors in Postgres with pgvector, and search them",
  category: "integration",
  app: "Postgres",
  icon: "DatabaseIcon",
  iconUrl: POSTGRES_ICON,
  config: z.object({
    mode: z
      .enum(MODES)
      .default("load")
      .meta({
        title: "Operation Mode",
        labels: MODE_LABELS,
        hints: {
          load: "Get the chunks that are closest to a prompt, ranked",
          insert: "Make chunks of the items, embed them, and keep them",
          retrieve: "Give the store to an AI node, such as the Vector Store Tool",
          retrieveAsTool: "Give the store to an AI Agent as a tool",
          update: "Replace the text and the vector of one chunk for each item",
          delete: "Delete chunks by their ID",
        },
      }),
    toolDescription: z
      .string()
      .default("")
      .meta({
        ui: "textarea",
        showWhen: { mode: ["retrieveAsTool"] },
        title: "Description",
        placeholder: "Search the product handbook",
        description:
          "Tell the model what the tool does and when to use it. The tool name is the node name",
      }),
    ...storeFields,
    query: z
      .string()
      .default("")
      .meta({
        showWhen: { mode: ["load"] },
        title: "Prompt",
        description:
          "The text to search for, such as {{ $json.question }}. Each item gives one search",
      }),
    limit: z
      .number()
      .int()
      .min(1)
      .max(1000)
      .default(4)
      .meta({
        showWhen: { mode: ["load", "retrieveAsTool"] },
        title: "Limit",
        description: "How many chunks each search gives",
      }),
    includeMetadata: z
      .boolean()
      .default(true)
      .meta({
        showWhen: { mode: ["load", "retrieveAsTool"] },
        title: "Include Metadata",
        description: "Give the metadata of each chunk",
      }),
    filter: z
      .string()
      .default("")
      .meta({
        ui: "code",
        showWhen: { mode: SEARCH_MODES },
        title: "Metadata Filter",
        placeholder: '{"source":"handbook"}',
        description: "Optional. A JSON object. Only chunks whose metadata has these values match",
      }),
    rerank: z
      .boolean()
      .default(false)
      .meta({
        showWhen: { mode: SEARCH_MODES },
        title: "Rerank Results",
        description: "Connect a reranker. It orders the chunks by relevance to the prompt",
      }),
    id: z
      .string()
      .default("")
      .meta({
        showWhen: { mode: ["update", "delete"] },
        title: "ID",
        description:
          "The chunk ID, such as {{ $json.id }}. For Delete, more IDs can have commas between them",
      }),
    batchSize: z
      .number()
      .int()
      .min(1)
      .max(2048)
      .default(200)
      .meta({
        showWhen: { mode: ["insert"] },
        title: "Embedding Batch Size",
        description:
          "How many chunks go to the embedding model in one call. Each batch goes in the table before the next one",
      }),
  }),
  defaultConfig: {
    mode: "load",
    toolDescription: "",
    ...storeDefaults,
    query: "",
    limit: 4,
    includeMetadata: true,
    filter: "",
    rerank: false,
    id: "",
    batchSize: 200,
  },
  // These keys read one item, so the node resolves them for each item.
  rawConfigKeys: ["query", "filter", "id"],
  credentialTypes: POSTGRES_CREDENTIAL_TYPES,
  ports: { in: ["in"], out: ["out"] },
  // In these modes the node is a supply and not a step.
  supplyModes: [
    { kind: RAG_KIND.vectorStore, showWhen: { mode: ["retrieve"] } },
    { kind: TOOL_KIND, showWhen: { mode: ["retrieveAsTool"] } },
  ],
  // The step modes write to the table, so they do not go on a tool port.
  usableAsTool: false,
  supplyPorts: [
    port({
      name: "embedding",
      kind: RAG_KIND.embedding,
      label: "Embedding",
      required: true,
      showWhen: { mode: ["load", "insert", "retrieve", "retrieveAsTool", "update"] },
    }),
    port({
      name: "document",
      kind: RAG_KIND.document,
      label: "Document",
      showWhen: { mode: ["insert", "update"] },
    }),
    port({
      name: "reranker",
      kind: RAG_KIND.reranker,
      label: "Reranker",
      showWhen: { mode: SEARCH_MODES, rerank: [true] },
    }),
  ],
  subtitle: (cfg) => {
    const mode = MODES.find((entry) => entry === cfg.mode);
    if (!mode) return undefined;
    return typeof cfg.table === "string" && cfg.table !== ""
      ? `${MODE_LABELS[mode]}: ${cfg.table}`
      : MODE_LABELS[mode];
  },
  async run({ config: cfg, input, credential, scope, signal, supplies }) {
    if (cfg.mode === "retrieve" || cfg.mode === "retrieveAsTool") {
      throw new Error(
        `"${MODE_LABELS[cfg.mode]}" gives a supply. Connect the node to a supply port. A zerodot with the node SDK 1.5 or later builds it`,
      );
    }
    const store = storeOf(cfg);
    const items = toItems(input);
    const resolve = (key: "query" | "filter" | "id", index: number) =>
      resolveTemplate(cfg[key], {
        ...scope,
        $item: items[index],
        $json: items[index],
        $index: index,
      });
    const embeddings =
      cfg.mode === "delete"
        ? undefined
        : supplyOn(supplies, "embedding", "Embedding", isEmbeddings, "an embedding model");
    if (cfg.mode !== "delete" && !embeddings) {
      throw new Error('Connect an embedding model to "Embedding"');
    }
    const loader = supplyOn(
      supplies,
      "document",
      "Document",
      isDocumentLoader,
      "a document loader",
    );
    const reranker = cfg.rerank
      ? supplyOn(supplies, "reranker", "Reranker", isReranker, "a reranker")
      : undefined;
    if (cfg.mode === "load" && cfg.rerank && !reranker) {
      throw new Error('Connect a reranker to "Reranker", or turn off "Rerank Results"');
    }

    // The checks that read the items run before the node connects.
    const searches: SearchRequest[] =
      cfg.mode === "load"
        ? items.map((_, index) => {
            const query = String(resolve("query", index) ?? "").trim();
            if (!query) throw new Error(`Item ${index} has no "query"`);
            const filter = filterOf(resolve("filter", index));
            return { query, limit: candidatesOf(cfg.limit, reranker), filter };
          })
        : [];
    const ids =
      cfg.mode === "update" || cfg.mode === "delete"
        ? items.map((_, index) => listOf(resolve("id", index)))
        : [];

    const connection = await connectionOf(credential, signal);
    try {
      const vectors = pgVectorStore(connection.database, store, embeddings);
      let data: Row[];
      if (cfg.mode === "insert") {
        const documents = await documentsOf(loader, items, signal);
        data = await vectors.insert(documents, cfg.batchSize, signal);
      } else if (cfg.mode === "delete") {
        data = [await vectors.delete(ids.flat())];
      } else if (cfg.mode === "update") {
        const changes: { id: string; document: Document }[] = [];
        for (const [index, item] of items.entries()) {
          const [chunkId, ...more] = ids[index] ?? [];
          if (!chunkId || more.length > 0) throw new Error(`Item ${index} needs one "id"`);
          const documents = await documentsOf(loader, [item], signal);
          const [document, ...rest] = documents;
          if (!document || rest.length > 0) {
            throw new Error(
              `Item ${index} gives ${documents.length} chunks. Update needs one. Set a larger chunk size`,
            );
          }
          changes.push({ id: chunkId, document });
        }
        data = await vectors.update(changes, signal);
      } else {
        data = [];
        for (const [index, search] of searches.entries()) {
          const found = await vectors.search(search, signal);
          const matches = await rerankMatches(reranker, search.query, found, cfg.limit, signal);
          data.push(
            ...matches.map(({ metadata, ...match }) => ({
              ...match,
              ...(cfg.includeMetadata ? { metadata } : {}),
              item: index,
            })),
          );
        }
      }
      return { port: "out", data };
    } catch (error) {
      throw parsePostgresError(error, []);
    } finally {
      await connection.close();
    }
  },
  /**
   * The store as a supply: a vector store for an AI node, or a tool for the AI Agent. It opens
   * one connection on the first search. The node SDK 1.5 calls `close` when the run is done.
   */
  supply: (context) => {
    const { config, credential, signal, supplies, node } = context;
    const store = storeOf(config);
    // A missing credential or host stops the run before the agent calls the model.
    postgresOptions(credential);
    const embeddings = supplyOn(
      supplies,
      "embedding",
      "Embedding",
      isEmbeddings,
      "an embedding model",
    );
    if (!embeddings) throw new Error('Connect an embedding model to "Embedding"');
    const reranker = config.rerank
      ? supplyOn(supplies, "reranker", "Reranker", isReranker, "a reranker")
      : undefined;
    if (config.rerank && !reranker) {
      throw new Error('Connect a reranker to "Reranker", or turn off "Rerank Results"');
    }
    // The filter is a raw key, so it can still have an expression here.
    const filter = filterOf(resolveTemplate(config.filter, context.scope));
    const base = lazyStore(credential, signal, store, embeddings);
    const filtered: VectorStore = {
      search: (request, searchSignal) =>
        base.search(
          {
            ...request,
            filter: filter || request.filter ? { ...filter, ...request.filter } : undefined,
          },
          searchSignal,
        ),
    };
    const ranked = rerankedStore(filtered, reranker);
    if (config.mode !== "retrieveAsTool") return { search: ranked.search, close: base.close };
    const tool = searchTool(ranked, {
      name: toolName(node.name, new Set()),
      description:
        config.toolDescription.trim() ||
        `Search the table "${store.table}" for the chunks of text that are closest to a query`,
      limit: config.limit,
      includeMetadata: config.includeMetadata,
      filter: undefined,
    });
    return { ...tool, close: base.close };
  },
});
