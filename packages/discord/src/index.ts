// SPDX-License-Identifier: AGPL-3.0-only
import type { CredentialTypeDefinition, NodeDefinition } from "@zerodot/node-sdk";
import { discordBotCredential, discordWebhookCredential } from "./credential";
import discord from "./node";
import discordTrigger from "./trigger";

export const nodes: NodeDefinition[] = [discordTrigger, discord];
export const credentialTypes: CredentialTypeDefinition[] = [
  discordBotCredential,
  discordWebhookCredential,
];
