// SPDX-License-Identifier: AGPL-3.0-only
import { fileIcon } from "@zerodot/node-sdk";

// The file is in the package root. This works from `src` (tests) and from `dist` (published).
export const AGENT_ICON = fileIcon(import.meta.url, "../ai-agent.svg");

// The credential types are copies of the ones of @zerodot/ai, so they keep its icon.
export const AI_ICON = fileIcon(import.meta.url, "../ai.svg");

// The icons of the supply nodes. The editor knows only some icon names, so each one has a file.
export const MEMORY_ICON = fileIcon(import.meta.url, "../memory.svg");
export const WORKFLOW_ICON = fileIcon(import.meta.url, "../workflow.svg");
export const MCP_ICON = fileIcon(import.meta.url, "../mcp.svg");
