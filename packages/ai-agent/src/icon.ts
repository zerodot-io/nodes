// SPDX-License-Identifier: AGPL-3.0-only
import { fileIcon } from "@zerodot/node-sdk";

// The file is in the package root. This works from `src` (tests) and from `dist` (published).
export const AGENT_ICON = fileIcon(import.meta.url, "../ai-agent.svg");

// The credential types come from @zerodot/ai-core, the same as in @zerodot/ai, so they keep its icon.
export const AI_ICON = fileIcon(import.meta.url, "../ai.svg");

// The icons of the supply nodes. The editor knows only some icon names, so each one has a file.
export const MEMORY_ICON = fileIcon(import.meta.url, "../memory.svg");
export const WORKFLOW_ICON = fileIcon(import.meta.url, "../workflow.svg");
export const MCP_ICON = fileIcon(import.meta.url, "../mcp.svg");
export const CODE_ICON = fileIcon(import.meta.url, "../code.svg");
export const SPLITTER_ICON = fileIcon(import.meta.url, "../splitter.svg");
export const DOCUMENT_ICON = fileIcon(import.meta.url, "../document.svg");
export const RERANKER_ICON = fileIcon(import.meta.url, "../reranker.svg");
export const VECTOR_STORE_ICON = fileIcon(import.meta.url, "../vector-store.svg");
export const MEMORY_MANAGER_ICON = fileIcon(import.meta.url, "../memory-manager.svg");

// The logos of the model providers.
export const OPENAI_ICON = fileIcon(import.meta.url, "../openai.svg");
export const ANTHROPIC_ICON = fileIcon(import.meta.url, "../anthropic.svg");
export const GEMINI_ICON = fileIcon(import.meta.url, "../gemini.svg");
export const MISTRAL_ICON = fileIcon(import.meta.url, "../mistral.svg");
export const GROQ_ICON = fileIcon(import.meta.url, "../groq.svg");
export const XAI_ICON = fileIcon(import.meta.url, "../xai.svg");
export const DEEPSEEK_ICON = fileIcon(import.meta.url, "../deepseek.svg");
export const OPENROUTER_ICON = fileIcon(import.meta.url, "../openrouter.svg");
export const OLLAMA_ICON = fileIcon(import.meta.url, "../ollama.svg");
export const AZURE_ICON = fileIcon(import.meta.url, "../azure.svg");
export const BEDROCK_ICON = fileIcon(import.meta.url, "../bedrock.svg");
export const VERTEX_ICON = fileIcon(import.meta.url, "../vertex.svg");
