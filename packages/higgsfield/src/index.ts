// SPDX-License-Identifier: AGPL-3.0-only
import type { CredentialTypeDefinition, NodeDefinition } from "@zerodot/node-sdk";
import { higgsfieldCredential } from "./credential";
import higgsfield from "./node";

export const nodes: NodeDefinition[] = [higgsfield];
export const credentialTypes: CredentialTypeDefinition[] = [higgsfieldCredential];
