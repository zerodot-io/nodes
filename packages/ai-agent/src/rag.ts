// SPDX-License-Identifier: AGPL-3.0-only
// The values that the supply nodes of a vector store give, and the code that the stores share.
// The same file is in ai-agent/src and postgres/src. A test checks that the two copies are the
// same. zerodot passes supply values as unknown, so each node checks the shape when it runs.
import { isRecord } from "@zerodot/node-sdk";

/** The supply kinds of the vector store ports. */
export const RAG_KIND = {
  embedding: "ai.embedding",
  textSplitter: "ai.textSplitter",
  document: "ai.document",
  reranker: "ai.reranker",
  vectorStore: "ai.vectorStore",
} as const;

type Row = Record<string, unknown>;

/**
 * What a text is for. Some providers make a better vector when they know it: a document goes in
 * a vector store, and a query searches it.
 */
export type EmbeddingUse = "document" | "query";

/** The value of an "ai.embedding" supply: a model that turns texts into vectors. */
export type Embeddings = {
  /** The length of each vector, when the settings set it. */
  dimensions?: number;
  /** One vector for each text, in the same order. */
  embed(texts: string[], use: EmbeddingUse, signal: AbortSignal): Promise<number[][]>;
};

/** The value of an "ai.textSplitter" supply: it cuts a text into chunks. */
export type TextSplitter = { split(text: string, signal: AbortSignal): Promise<string[]> };

/** One chunk of text with its metadata. */
export type Document = { content: string; metadata: Row };

/** The value of an "ai.document" supply: it makes the chunks of the input items. */
export type DocumentLoader = { load(items: Row[], signal: AbortSignal): Promise<Document[]> };

/** The place and the score of a text in the reranked order. Higher is more relevant. */
export type Ranked = { index: number; score: number };

/** The value of an "ai.reranker" supply: it orders texts by relevance to a query. */
export type Reranker = {
  rerank(query: string, texts: string[], topN: number, signal: AbortSignal): Promise<Ranked[]>;
};

/** A chunk that a search found. Higher scores are closer. */
export type Match = { id: string; content: string; metadata: Row; score: number };

export type SearchRequest = {
  query: string;
  limit: number;
  /** Only chunks whose metadata has these values. */
  filter?: Row;
};

/** The value of an "ai.vectorStore" supply: a store that a tool or a chain can search. */
export type VectorStore = {
  search(request: SearchRequest, signal: AbortSignal): Promise<Match[]>;
};

const hasFunction = (value: unknown, name: string): value is Row =>
  isRecord(value) && typeof value[name] === "function";

export const isEmbeddings = (value: unknown): value is Embeddings => hasFunction(value, "embed");
export const isTextSplitter = (value: unknown): value is TextSplitter =>
  hasFunction(value, "split");
export const isDocumentLoader = (value: unknown): value is DocumentLoader =>
  hasFunction(value, "load");
export const isReranker = (value: unknown): value is Reranker => hasFunction(value, "rerank");
export const isVectorStore = (value: unknown): value is VectorStore => hasFunction(value, "search");

/** The supply on a port, or an error that names the port. Empty is undefined when optional. */
export function supplyOn<T>(
  supplies: Row | undefined,
  port: string,
  label: string,
  check: (value: unknown) => value is T,
  what: string,
): T | undefined {
  const value = supplies?.[port];
  if (value === undefined) return undefined;
  if (!check(value)) throw new Error(`The node on "${label}" does not give ${what}`);
  return value;
}

// Text splitting

/** The chunk settings of the simple splitting. */
export const DEFAULT_CHUNK = { size: 1000, overlap: 200 } as const;

/**
 * Where a text can break, the best first. Each pattern matches an empty place, so the parts
 * join back to the same text. The last step cuts the text by length.
 */
const TEXT_BREAKS = [/(?<=\n\n)/, /(?<=\n)/, /(?<=[.!?。]\s)/, /(?<=[;:,]\s)/, /(?<=\s)/];

export const SEPARATORS = {
  text: TEXT_BREAKS,
  markdown: [/(?=\n#{1,6} )/, /(?=\n```)/, /(?=\n(?:---|\*\*\*|___)\n)/, ...TEXT_BREAKS],
  html: [
    /(?=<(?:h[1-6]|section|article|header|footer|table|pre)[\s>])/i,
    /(?=<(?:div|p|ul|ol|li|tr|blockquote|br)[\s>/])/i,
    ...TEXT_BREAKS,
  ],
  code: [
    /(?=\n(?:export |async |function |class |def |interface |type |const |let |var |func |fn |impl |struct |enum |public |private |protected ))/,
    /(?=\n\s*(?:if|for|while|switch|return|try)\b)/,
    ...TEXT_BREAKS,
  ],
} as const satisfies Record<string, readonly RegExp[]>;

export type SeparatorSet = keyof typeof SEPARATORS;

/** Cuts a text into parts of at most `size` characters. */
const cut = (text: string, size: number): string[] =>
  Array.from({ length: Math.ceil(text.length / size) }, (_, index) =>
    text.slice(index * size, (index + 1) * size),
  );

/**
 * Joins small parts into chunks of at most `size` characters. A new chunk starts with the last
 * parts of the previous chunk, up to `overlap` characters. `joiner` goes between two parts.
 */
export function mergeParts(parts: string[], size: number, overlap: number, joiner = ""): string[] {
  const chunks: string[] = [];
  const current: string[] = [];
  let length = 0;
  const emit = () => {
    const chunk = current.join(joiner).trim();
    if (chunk) chunks.push(chunk);
  };
  for (const part of parts) {
    const added = part.length + (current.length > 0 ? joiner.length : 0);
    if (current.length > 0 && length + added > size) {
      emit();
      while (current.length > 0 && (length > overlap || length + added > size)) {
        const first = current.shift() ?? "";
        length -= first.length + (current.length > 0 ? joiner.length : 0);
      }
    }
    length += part.length + (current.length > 0 ? joiner.length : 0);
    current.push(part);
  }
  emit();
  return chunks;
}

/**
 * Splits a text into chunks of at most `size` characters, and keeps paragraphs, then lines, then
 * sentences, then words together as long as it can.
 */
export function splitRecursive(
  text: string,
  size: number,
  overlap: number,
  separators: readonly RegExp[] = SEPARATORS.text,
): string[] {
  const partsOf = (piece: string, rest: readonly RegExp[]): string[] => {
    if (piece.length <= size) return [piece];
    const index = rest.findIndex((separator) => piece.split(separator).length > 1);
    const separator = rest[index];
    if (!separator) return cut(piece, size);
    const next = rest.slice(index + 1);
    return piece.split(separator).flatMap((part) => partsOf(part, next));
  };
  return mergeParts(partsOf(text, separators), size, overlap);
}

/** The chunks of a text: from the splitter on the port, or the simple splitting. */
export const splitWith = (
  splitter: TextSplitter | undefined,
  text: string,
  signal: AbortSignal,
): Promise<string[]> =>
  splitter
    ? splitter.split(text, signal)
    : Promise.resolve(splitRecursive(text, DEFAULT_CHUNK.size, DEFAULT_CHUNK.overlap));

// Documents

/**
 * The text of a value: a text stays the same. For an object or a list, one line for each value,
 * such as `address.city: Berlin`. The `binary` key of an item is not text, so it is left out.
 */
export function textOf(value: unknown): string {
  if (typeof value === "string") return value;
  const lines: string[] = [];
  const walk = (entry: unknown, path: string) => {
    if (Array.isArray(entry)) {
      entry.forEach((inner, index) => {
        walk(inner, path ? `${path}.${index}` : String(index));
      });
    } else if (isRecord(entry)) {
      for (const [key, inner] of Object.entries(entry)) {
        if (!path && key === "binary") continue;
        walk(inner, path ? `${path}.${key}` : key);
      }
    } else if (entry !== null && entry !== undefined && entry !== "") {
      lines.push(path ? `${path}: ${String(entry)}` : String(entry));
    }
  };
  walk(value, "");
  return lines.join("\n");
}

/**
 * The chunks of the input items: from the loader on the port, or the simple loading. The simple
 * loading uses all the data of each item, and the simple splitting.
 */
export async function documentsOf(
  loader: DocumentLoader | undefined,
  items: Row[],
  signal: AbortSignal,
): Promise<Document[]> {
  if (loader) return loader.load(items, signal);
  const documents: Document[] = [];
  for (const item of items) {
    for (const content of await splitWith(undefined, textOf(item), signal)) {
      documents.push({ content, metadata: {} });
    }
  }
  return documents;
}

// Search

/** The most candidates that a store gives to a reranker. */
const MAX_CANDIDATES = 100;

/** How many chunks the store finds. A reranker gets more, so it can choose. */
export const candidatesOf = (limit: number, reranker: Reranker | undefined): number =>
  reranker ? Math.min(Math.max(limit * 4, 20), MAX_CANDIDATES) : limit;

/** The best `limit` matches. A reranker orders them by relevance and gives its score. */
export async function rerankMatches(
  reranker: Reranker | undefined,
  query: string,
  matches: Match[],
  limit: number,
  signal: AbortSignal,
): Promise<Match[]> {
  if (!reranker || matches.length === 0) return matches.slice(0, limit);
  const ranked = await reranker.rerank(
    query,
    matches.map((match) => match.content),
    Math.min(limit, matches.length),
    signal,
  );
  return ranked.flatMap(({ index, score }) => {
    const match = matches[index];
    return match ? [{ ...match, score }] : [];
  });
}

/** A metadata object from JSON text or an object, such as a filter. Empty is undefined. */
export function filterOf(value: unknown, name = "filter"): Row | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  let parsed: unknown = value;
  if (typeof value === "string") {
    try {
      parsed = JSON.parse(value);
    } catch {
      throw new Error(`"${name}" is not valid JSON`);
    }
  }
  if (!isRecord(parsed)) throw new Error(`"${name}" must be a JSON object`);
  return Object.keys(parsed).length > 0 ? parsed : undefined;
}

/**
 * The store with a reranker: it finds more candidates, and the reranker keeps the best `limit`.
 * Without a reranker, it keeps the first `limit` matches.
 */
export function rerankedStore(store: VectorStore, reranker: Reranker | undefined): VectorStore {
  return {
    async search(request, signal) {
      const found = await store.search(
        { ...request, limit: candidatesOf(request.limit, reranker) },
        signal,
      );
      return rerankMatches(reranker, request.query, found, request.limit, signal);
    },
  };
}

// Tools

/** The settings of a tool that searches a vector store. */
export type SearchToolOptions = {
  name: string;
  description: string;
  limit: number;
  includeMetadata: boolean;
  filter: Row | undefined;
};

/** A tool for an AI Agent, with the shape of the "ai.tool" supply. */
export type SearchTool = {
  spec: {
    name: string;
    description: string;
    inputSchema: {
      type: "object";
      properties: Record<string, { type: "string"; description: string }>;
      required: string[];
      additionalProperties: false;
    };
  };
  call(input: unknown, signal?: AbortSignal): Promise<unknown>;
};

/** The "query" of a tool input. An empty query is an error. */
export function queryOf(input: unknown): string {
  const query = isRecord(input) && "query" in input ? String(input.query ?? "").trim() : "";
  if (!query) throw new Error('The tool needs "query"');
  return query;
}

/** A tool that gives the chunks closest to the query of the model. */
export function searchTool(
  store: VectorStore,
  options: SearchToolOptions,
  queryDescription = "The text to search for",
): SearchTool {
  return {
    spec: {
      name: options.name,
      description: options.description,
      inputSchema: {
        type: "object",
        properties: { query: { type: "string", description: queryDescription } },
        required: ["query"],
        additionalProperties: false,
      },
    },
    async call(input, signal) {
      const matches = await store.search(
        { query: queryOf(input), limit: options.limit, filter: options.filter },
        signal ?? new AbortController().signal,
      );
      return matches.map((match) => ({
        content: match.content,
        score: match.score,
        ...(options.includeMetadata ? { metadata: match.metadata } : {}),
      }));
    },
  };
}
