// SPDX-License-Identifier: AGPL-3.0-only
import type { CredentialTypeDefinition, NodeDefinition } from "@zerodot/node-sdk";
import { notionCredential } from "./credential";
import notion from "./node";
import notionTrigger from "./trigger";

export const nodes: NodeDefinition[] = [notionTrigger, notion];
export const credentialTypes: CredentialTypeDefinition[] = [notionCredential];
