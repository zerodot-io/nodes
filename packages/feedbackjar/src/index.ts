// SPDX-License-Identifier: AGPL-3.0-only
import type { CredentialTypeDefinition, NodeDefinition } from "@zerodot/node-sdk";
import { feedbackjarCredential } from "./credential";
import feedbackjar from "./node";
import feedbackjarTrigger from "./trigger";

export const nodes: NodeDefinition[] = [feedbackjarTrigger, feedbackjar];
export const credentialTypes: CredentialTypeDefinition[] = [feedbackjarCredential];
