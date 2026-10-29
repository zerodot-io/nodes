// SPDX-License-Identifier: AGPL-3.0-only
import type { CredentialTypeDefinition, NodeDefinition } from "@zerodot/node-sdk";
import { gmailOAuth2Credential, gmailServiceAccountCredential } from "./credential";
import gmail from "./node";
import gmailTrigger from "./trigger";

export const nodes: NodeDefinition[] = [gmail, gmailTrigger];
export const credentialTypes: CredentialTypeDefinition[] = [
  gmailOAuth2Credential,
  gmailServiceAccountCredential,
];
