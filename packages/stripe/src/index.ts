// SPDX-License-Identifier: AGPL-3.0-only
import type { CredentialTypeDefinition, NodeDefinition } from "@zerodot/node-sdk";
import { stripeCredential } from "./credential";
import stripe from "./node";
import stripeTrigger from "./trigger";

export const nodes: NodeDefinition[] = [stripeTrigger, stripe];
export const credentialTypes: CredentialTypeDefinition[] = [stripeCredential];
