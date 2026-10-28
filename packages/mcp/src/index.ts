// SPDX-License-Identifier: AGPL-3.0-only
import type { NodeDefinition } from "@zerodot/node-sdk";
import mcpCallTool from "./mcp-call-tool";

export const nodes: NodeDefinition[] = [mcpCallTool];
export const credentialTypes: never[] = [];
