// SPDX-License-Identifier: AGPL-3.0-only
import type { CredentialTypeDefinition, NodeDefinition } from "@zerodot/node-sdk";
import { telegramCredential } from "./credential";
import telegram from "./node";
import telegramTrigger from "./trigger";

export const nodes: NodeDefinition[] = [telegramTrigger, telegram];
export const credentialTypes: CredentialTypeDefinition[] = [telegramCredential];
