// SPDX-License-Identifier: AGPL-3.0-only
import { z } from "zod";
import { VECTOR_STORE_ICON } from "./icon";
import {
  filterOf,
  isReranker,
  isVectorStore,
  type Match,
  queryOf,
  RAG_KIND,
  type Reranker,
  rerankedStore,
  type SearchToolOptions,
  searchTool,
  supplyOn,
  type VectorStore,
} from "./rag";
import { defineSupplyNode, suppliesOf } from "./supply";
import { nameAndDescription, toolFields } from "./supply-nodes";
import { type ChatModel, isChatModel, KIND, type Tool } from "./types";

const ANSWER_SYSTEM = `Answer the question with only the context below. If the context does not have the answer, say that you do not know. Do not make up facts.

Context:
`;

/** The context text for the model: the chunks, with their metadata when the settings keep it. */
const contextOf = (matches: Match[], includeMetadata: boolean): string =>
  matches
    .map((match, index) => {
      const metadata =
        includeMetadata && Object.keys(match.metadata).length > 0
          ? `\nMetadata: ${JSON.stringify(match.metadata)}`
          : "";
      return `[${index + 1}] ${match.content}${metadata}`;
    })
    .join("\n\n");

/**
 * An agent tool that searches a vector store. With a chat model, the tool answers the question
 * from the chunks that it finds, so the agent gets a short answer and not all the chunks.
 */
export function vectorStoreTool(
  store: VectorStore,
  options: SearchToolOptions,
  reranker: Reranker | undefined,
  model: ChatModel | undefined,
): Tool {
  const ranked = rerankedStore(store, reranker);
  if (!model) {
    const tool = searchTool(ranked, options);
    return { spec: tool.spec, call: (input, signal) => tool.call(input, signal) };
  }
  const { spec } = searchTool(ranked, options, "The question to answer");
  return {
    spec,
    async call(input, signal) {
      const query = queryOf(input);
      const matches = await ranked.search(
        { query, limit: options.limit, filter: options.filter },
        signal,
      );
      const turn = await model.chat(
        {
          system: `${ANSWER_SYSTEM}${contextOf(matches, options.includeMetadata)}`,
          messages: [{ role: "user", content: query }],
          tools: [],
        },
        signal,
      );
      return { answer: turn.text };
    },
  };
}

export default defineSupplyNode({
  type: "agent.tool.vectorStore",
  label: "Vector Store Tool",
  description:
    "Lets the AI Agent search a vector store. A chat model on this tool is optional: it answers from the chunks, so the agent gets only the answer",
  category: "integration",
  icon: "DatabaseIcon",
  iconUrl: VECTOR_STORE_ICON,
  supplies: KIND.tool,
  supplyPorts: [
    { name: "vectorStore", kind: RAG_KIND.vectorStore, label: "Vector Store", required: true },
    { name: "reranker", kind: RAG_KIND.reranker, label: "Reranker" },
    { name: "model", kind: KIND.model, label: "Answer Model" },
  ],
  config: z.object({
    ...toolFields,
    limit: z.number().int().min(1).max(100).default(4).meta({
      title: "Limit",
      description: "How many chunks one search gives",
    }),
    includeMetadata: z.boolean().default(true).meta({
      title: "Include Metadata",
      description: "Give the metadata of each chunk to the model",
    }),
    filter: z.string().default("").meta({
      ui: "code",
      title: "Metadata Filter",
      placeholder: '{"source":"handbook"}',
      description: "Optional. A JSON object. Only chunks whose metadata has these values match",
    }),
  }),
  defaultConfig: { name: "", description: "", limit: 4, includeMetadata: true, filter: "" },
  subtitle: (config) =>
    typeof config.name === "string" && config.name !== "" ? config.name : undefined,
  supply: (context) => {
    const { config } = context;
    const { name, description } = nameAndDescription(config);
    const supplies = suppliesOf(context);
    const store = supplyOn(
      supplies,
      "vectorStore",
      "Vector Store",
      isVectorStore,
      "a vector store",
    );
    if (!store) {
      throw new Error(
        'Connect a vector store to "Vector Store". A zerodot with the node SDK 1.5 or later builds it',
      );
    }
    return vectorStoreTool(
      store,
      {
        name,
        description,
        limit: config.limit,
        includeMetadata: config.includeMetadata,
        filter: filterOf(config.filter),
      },
      supplyOn(supplies, "reranker", "Reranker", isReranker, "a reranker"),
      supplyOn(supplies, "model", "Answer Model", isChatModel, "a chat model"),
    );
  },
});
