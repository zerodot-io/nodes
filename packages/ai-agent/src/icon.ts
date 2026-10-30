// SPDX-License-Identifier: AGPL-3.0-only
import { fileIcon } from "@zerodot/node-sdk";

// The file is in the package root. This works from `src` (tests) and from `dist` (published).
export const AGENT_ICON = fileIcon(import.meta.url, "../ai-agent.svg");

// The credential types are copies of the ones of @zerodot/ai, so they keep its icon.
export const AI_ICON = fileIcon(import.meta.url, "../ai.svg");
