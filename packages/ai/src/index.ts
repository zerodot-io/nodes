// SPDX-License-Identifier: AGPL-3.0-only
import type { CredentialTypeDefinition, NodeDefinition } from "@zerodot/node-sdk";
import {
  anthropicCredential,
  compatibleCredential,
  geminiCredential,
  openaiCredential,
} from "./credential";
import ai from "./node";

export const nodes: NodeDefinition[] = [ai];
export const credentialTypes: CredentialTypeDefinition[] = [
  openaiCredential,
  anthropicCredential,
  geminiCredential,
  compatibleCredential,
];
