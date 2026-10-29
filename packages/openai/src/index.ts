// SPDX-License-Identifier: AGPL-3.0-only
import type { CredentialTypeDefinition, NodeDefinition } from "@zerodot/node-sdk";
import { openaiCredential } from "./credential";
import openai from "./node";

export const nodes: NodeDefinition[] = [openai];
export const credentialTypes: CredentialTypeDefinition[] = [openaiCredential];
