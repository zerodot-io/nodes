// SPDX-License-Identifier: AGPL-3.0-only
import type { CredentialTypeDefinition, NodeDefinition } from "@zerodot/node-sdk";
import { anthropicCredential } from "./credential";
import anthropic from "./node";

export const nodes: NodeDefinition[] = [anthropic];
export const credentialTypes: CredentialTypeDefinition[] = [anthropicCredential];
