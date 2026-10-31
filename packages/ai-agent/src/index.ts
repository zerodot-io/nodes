// SPDX-License-Identifier: AGPL-3.0-only
import { aiCredentialTypes } from "@zerodot/ai-core";
import type { CredentialTypeDefinition, NodeDefinition } from "@zerodot/node-sdk";
import { chatModelNodes } from "./chat-models";
import documentLoader from "./document-loader";
import { embeddingNodes } from "./embedding-models";
import { AI_ICON } from "./icon";
import memoryManager from "./memory-manager";
import agent from "./node";
import { cohereCredential, cohereRerankerNode } from "./reranker";
import { supplyNodes } from "./supply-nodes";
import { splitterNodes } from "./text-splitters";
import vectorStoreTool from "./vector-store-tool";

export type {
  Document,
  DocumentLoader,
  Embeddings,
  EmbeddingUse,
  Match,
  Ranked,
  Reranker,
  SearchRequest,
  TextSplitter,
  VectorStore,
} from "./rag";
export { RAG_KIND } from "./rag";
export type {
  ChatModel,
  ChatRequest,
  FinishReason,
  Memory,
  Message,
  ModelTurn,
  Tool,
  ToolCall,
  ToolSpec,
  Toolset,
  Usage,
} from "./types";
export { KIND } from "./types";

export const nodes: NodeDefinition[] = [
  agent,
  memoryManager,
  ...chatModelNodes,
  ...embeddingNodes,
  ...splitterNodes,
  documentLoader,
  cohereRerankerNode,
  ...supplyNodes,
  vectorStoreTool,
];
export const credentialTypes: CredentialTypeDefinition[] = [
  ...aiCredentialTypes(AI_ICON),
  cohereCredential,
];
