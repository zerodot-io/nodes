// SPDX-License-Identifier: AGPL-3.0-only
import type { CredentialTypeDefinition, NodeDefinition } from "@zerodot/node-sdk";
import { twilioCredential } from "./credential";
import twilio from "./node";
import twilioTrigger from "./trigger";

export const nodes: NodeDefinition[] = [twilioTrigger, twilio];
export const credentialTypes: CredentialTypeDefinition[] = [twilioCredential];
