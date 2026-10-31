// SPDX-License-Identifier: AGPL-3.0-only
import assert from "node:assert/strict";
import { afterEach, describe, it, mock } from "node:test";
import { formatOf, htmlText } from "./document-loader";
import { nodes } from "./index";
import {
  candidatesOf,
  type DocumentLoader,
  documentsOf,
  type Match,
  mergeParts,
  type Reranker,
  rerankMatches,
  SEPARATORS,
  splitRecursive,
  type TextSplitter,
  textOf,
  type VectorStore,
} from "./rag";
import { StatusError, withRetry } from "./retry";
import { splitCharacters, splitTokens } from "./text-splitters";
import type { ChatModel, ChatRequest, Tool } from "./types";

const signal = new AbortController().signal;
const KEY = `co-${"test".repeat(8)}`;

afterEach(() => mock.restoreAll());

/** Builds the value of a supply node, with the values on its own supply ports. */
async function supplyOf(
  type: string,
  config: Record<string, unknown>,
  extra: { supplies?: Record<string, unknown>; credential?: unknown; scope?: object } = {},
): Promise<unknown> {
  const node = nodes.find((entry) => entry.type === type);
  if (!node?.supply) throw new Error(`${type} is not a supply node`);
  const context = {
    config: node.config.parse({ ...(node.defaultConfig as Record<string, unknown>), ...config }),
    credential: null,
    signal,
    scope: {},
    sandbox: null,
    tables: null,
    node: { id: "s1", name: type },
    ...extra,
  };
  return node.supply(context as Parameters<typeof node.supply>[0]);
}

describe("text splitting", () => {
  const text = [
    "First paragraph. It has two sentences.",
    "Second paragraph is here, and it is a bit longer than the first one.",
    "Third.",
  ].join("\n\n");

  it("keeps paragraphs together, and no chunk is longer than the size", () => {
    const chunks = splitRecursive(text, 80, 0);
    assert.deepEqual(chunks, [
      "First paragraph. It has two sentences.",
      "Second paragraph is here, and it is a bit longer than the first one.\n\nThird.",
    ]);
    for (const chunk of splitRecursive(text, 20, 5)) assert.ok(chunk.length <= 20, chunk);
  });

  it("starts a chunk with the end of the previous one", () => {
    const chunks = splitRecursive("one two three four five six seven", 14, 6);
    assert.deepEqual(chunks, ["one two three", "three four", "four five six", "six seven"]);
  });

  it("cuts a long word by length", () => {
    assert.deepEqual(splitRecursive("abcdefghij", 4, 0), ["abcd", "efgh", "ij"]);
  });

  it("breaks Markdown at headings first", () => {
    const markdown = "# A\nalpha alpha\n## B\nbeta beta";
    assert.deepEqual(splitRecursive(markdown, 20, 0, SEPARATORS.markdown), [
      "# A\nalpha alpha",
      "## B\nbeta beta",
    ]);
  });

  it("merges parts with a joiner and an overlap", () => {
    assert.deepEqual(mergeParts(["aa", "bb", "cc", "dd"], 5, 2, "-"), ["aa-bb", "bb-cc", "cc-dd"]);
  });

  it("splits at a separator, and cuts a part that is too long", () => {
    assert.deepEqual(splitCharacters("a\n\nbb\n\ncccccc", "\n\n", 5, 0), ["a\n\nbb", "ccccc", "c"]);
  });

  it("splits tokens with an overlap", () => {
    const tokenizer = {
      encode: (value: string) => [...value].map((char) => char.charCodeAt(0)),
      decode: (tokens: number[]) => String.fromCharCode(...tokens),
    };
    assert.deepEqual(splitTokens(tokenizer, "abcdefg", 3, 1), ["abc", "cde", "efg"]);
  });

  it("the token splitter counts real tokens", async () => {
    const splitter = (await supplyOf("agent.splitter.token", {
      chunkSize: 5,
      chunkOverlap: 0,
    })) as TextSplitter;
    const chunks = await splitter.split(
      "The quick brown fox jumps over the lazy dog. ".repeat(4),
      signal,
    );
    assert.ok(chunks.length >= 6, String(chunks.length));
    assert.match(chunks.join(" "), /quick brown fox/);
  });

  it("rejects an overlap that is not less than the size", async () => {
    await assert.rejects(
      supplyOf("agent.splitter.recursive", { chunkSize: 10, chunkOverlap: 10 }),
      /less than "chunkSize"/,
    );
  });
});

describe("documents", () => {
  it("writes one line for each value of an item, without binary data", () => {
    assert.equal(
      textOf({ title: "Hi", tags: ["a", "b"], address: { city: "Berlin" }, binary: { x: 1 } }),
      "title: Hi\ntags.0: a\ntags.1: b\naddress.city: Berlin",
    );
    assert.equal(textOf("plain"), "plain");
  });

  it("loads all data with the simple splitting when no loader is on the port", async () => {
    assert.deepEqual(await documentsOf(undefined, [{ text: "hello" }], signal), [
      { content: "text: hello", metadata: {} },
    ]);
  });

  it("the default loader resolves the text and the metadata for each item", async () => {
    const loader = (await supplyOf(
      "agent.document.default",
      {
        mode: "specific",
        text: "{{ $json.title }}: {{ $json.body }}",
        metadataFields: "id, missing",
        metadata: '{"source": "{{ $json.url }}"}',
      },
      { scope: { $vars: {} } },
    )) as DocumentLoader;
    const documents = await loader.load(
      [
        { id: 1, title: "A", body: "alpha", url: "https://a.test" },
        { id: 2, title: "B", body: "beta", url: "https://b.test" },
      ],
      signal,
    );
    assert.deepEqual(documents, [
      { content: "A: alpha", metadata: { id: 1, source: "https://a.test" } },
      { content: "B: beta", metadata: { id: 2, source: "https://b.test" } },
    ]);
  });

  it("the default loader uses the text splitter on its port", async () => {
    const splitter: TextSplitter = { split: async (value) => value.split(" ") };
    const loader = (await supplyOf(
      "agent.document.default",
      { mode: "specific", text: "{{ $json.body }}" },
      { supplies: { textSplitter: splitter } },
    )) as DocumentLoader;
    const documents = await loader.load([{ body: "x y" }], signal);
    assert.deepEqual(
      documents.map((document) => document.content),
      ["x", "y"],
    );
    await assert.rejects(
      supplyOf("agent.document.default", {}, { supplies: { textSplitter: {} } }),
      /does not give a text splitter/,
    );
  });

  it("the default loader reads files, and keeps the file name", async () => {
    const loader = (await supplyOf("agent.document.default", {
      dataType: "binary",
    })) as DocumentLoader;
    const file = (text: string, mimeType: string, fileName: string) => ({
      binary: { data: { data: Buffer.from(text).toString("base64"), mimeType, fileName } },
    });
    const documents = await loader.load(
      [
        file("<p>Hello <b>you</b> &amp; me</p><script>x()</script>", "text/html", "a.html"),
        file('{"name":"Ann"}', "application/json", "b.json"),
      ],
      signal,
    );
    assert.deepEqual(documents, [
      { content: "Hello you & me", metadata: { fileName: "a.html", mimeType: "text/html" } },
      { content: "name: Ann", metadata: { fileName: "b.json", mimeType: "application/json" } },
    ]);
    await assert.rejects(loader.load([file("x", "image/png", "c.png")], signal), /image\/png/);
  });

  it("finds the format of a file", () => {
    assert.equal(formatOf("application/octet-stream", "notes.MD"), "markdown");
    assert.equal(formatOf("application/pdf"), "pdf");
    assert.equal(formatOf("text/csv", "a.csv"), "text");
    assert.equal(htmlText("a<br>b&#33;"), "a\nb!");
  });
});

const match = (id: string, score = 0.5): Match => ({
  id,
  content: `text ${id}`,
  metadata: { id },
  score,
});

describe("search", () => {
  it("gives a reranker more candidates, and keeps its order and score", async () => {
    assert.equal(candidatesOf(4, undefined), 4);
    const reranker: Reranker = {
      rerank: async (_, texts, topN) =>
        texts
          .map((_, index) => ({ index, score: index / 10 }))
          .reverse()
          .slice(0, topN),
    };
    assert.equal(candidatesOf(4, reranker), 20);
    assert.equal(candidatesOf(50, reranker), 100);
    const ranked = await rerankMatches(
      reranker,
      "q",
      [match("a"), match("b"), match("c")],
      2,
      signal,
    );
    assert.deepEqual(
      ranked.map((entry) => [entry.id, entry.score]),
      [
        ["c", 0.2],
        ["b", 0.1],
      ],
    );
  });

  it("the Cohere reranker sends the texts and reads the results", async () => {
    const calls: { url: string; body: unknown; auth: string | null }[] = [];
    mock.method(globalThis, "fetch", async (url: string, init: RequestInit) => {
      calls.push({
        url: String(url),
        body: JSON.parse(String(init.body)),
        auth: new Headers(init.headers).get("authorization"),
      });
      return new Response(
        JSON.stringify({
          results: [
            { index: 1, relevance_score: 0.9 },
            { index: 0, relevance_score: 0.2 },
          ],
        }),
      );
    });
    await assert.rejects(supplyOf("agent.reranker.cohere", {}), /Cohere credential/);
    const reranker = (await supplyOf(
      "agent.reranker.cohere",
      {},
      { credential: { type: "cohere", data: { apiKey: KEY } } },
    )) as Reranker;
    assert.deepEqual(await reranker.rerank("q", ["a", "b"], 2, signal), [
      { index: 1, score: 0.9 },
      { index: 0, score: 0.2 },
    ]);
    assert.equal(calls[0]?.url, "https://api.cohere.com/v2/rerank");
    assert.equal(calls[0]?.auth, `Bearer ${KEY}`);
    assert.deepEqual(calls[0]?.body, {
      model: "rerank-v4.0-fast",
      query: "q",
      documents: ["a", "b"],
      top_n: 2,
    });
  });
});

describe("vector store tool", () => {
  const requests: unknown[] = [];
  const store: VectorStore = {
    search: async (request) => {
      requests.push(request);
      return [match("a", 0.9), match("b", 0.8)];
    },
  };
  const base = { name: "search_docs", description: "Searches the docs", limit: 1 };

  it("needs a vector store, and gives the chunks to the model", async () => {
    await assert.rejects(supplyOf("agent.tool.vectorStore", base), /Connect a vector store/);
    const tool = (await supplyOf(
      "agent.tool.vectorStore",
      { ...base, filter: '{"lang":"en"}' },
      { supplies: { vectorStore: store } },
    )) as Tool;
    assert.equal(tool.spec.name, "search_docs");
    assert.deepEqual(tool.spec.inputSchema.required, ["query"]);
    assert.deepEqual(await tool.call({ query: "hi" }, signal), [
      { content: "text a", score: 0.9, metadata: { id: "a" } },
    ]);
    assert.deepEqual(requests.at(-1), { query: "hi", limit: 1, filter: { lang: "en" } });
    await assert.rejects(tool.call({}, signal), /needs "query"/);
  });

  it("answers from the chunks with a chat model", async () => {
    const seen: ChatRequest[] = [];
    const model: ChatModel = {
      chat: async (request) => {
        seen.push(request);
        return {
          text: "The answer",
          toolCalls: [],
          finishReason: "stop",
          usage: { inputTokens: 1, outputTokens: 1 },
        };
      },
    };
    const tool = (await supplyOf("agent.tool.vectorStore", base, {
      supplies: { vectorStore: store, model },
    })) as Tool;
    assert.deepEqual(await tool.call({ query: "why?" }, signal), { answer: "The answer" });
    assert.match(seen[0]?.system ?? "", /\[1\] text a\nMetadata: \{"id":"a"\}/);
    assert.deepEqual(seen[0]?.messages, [{ role: "user", content: "why?" }]);
  });
});

describe("retry", () => {
  it("tries again after a rate limit, and not after other errors", async () => {
    let calls = 0;
    const flaky = async () => {
      calls++;
      if (calls < 3) throw new StatusError("busy", 429);
      return "ok";
    };
    assert.equal(await withRetry(flaky, signal, { attempts: 4, baseMs: 1 }), "ok");
    assert.equal(calls, 3);
    calls = 0;
    const denied = async () => {
      calls++;
      throw new StatusError("no key", 401);
    };
    await assert.rejects(withRetry(denied, signal, { attempts: 4, baseMs: 1 }), /no key/);
    assert.equal(calls, 1);
    const always = async () => {
      throw new StatusError("busy", 503);
    };
    await assert.rejects(withRetry(always, signal, { attempts: 2, baseMs: 1 }), /busy/);
  });
});
