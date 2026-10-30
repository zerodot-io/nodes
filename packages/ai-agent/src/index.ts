// SPDX-License-Identifier: AGPL-3.0-only
import type { CredentialTypeDefinition, NodeDefinition } from "@zerodot/node-sdk";
import {
  anthropicCredential,
  compatibleCredential,
  geminiCredential,
  openaiCredential,
} from "./credential";
import agent from "./node";

export const nodes: NodeDefinition[] = [agent];
export const credentialTypes: CredentialTypeDefinition[] = [
  openaiCredential,
  anthropicCredential,
  geminiCredential,
  compatibleCredential,
];
