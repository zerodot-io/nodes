// SPDX-License-Identifier: AGPL-3.0-only
import type { CredentialTypeDefinition, NodeDefinition } from "@zerodot/node-sdk";
import { imapCredential, smtpCredential } from "./credential";
import emailSend from "./email-send";
import triggerEmailImap from "./trigger-email-imap";

export const nodes: NodeDefinition[] = [emailSend, triggerEmailImap];
export const credentialTypes: CredentialTypeDefinition[] = [smtpCredential, imapCredential];
