// SPDX-License-Identifier: AGPL-3.0-only
import type { CredentialTypeDefinition, NodeDefinition } from "@zerodot/node-sdk";
import { chatModelNodes } from "./chat-models";
import {
  anthropicCredential,
  compatibleCredential,
  geminiCredential,
  openaiCredential,
} from "./credential";
import agent from "./node";
import { supplyNodes } from "./supply-nodes";

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

export const nodes: NodeDefinition[] = [agent, ...chatModelNodes, ...supplyNodes];
export const credentialTypes: CredentialTypeDefinition[] = [
  openaiCredential,
  anthropicCredential,
  geminiCredential,
  compatibleCredential,
];
