// SPDX-License-Identifier: AGPL-3.0-only
import type { CredentialTypeDefinition, NodeDefinition } from "@zerodot/node-sdk";
import { sheetsOAuth2Credential, sheetsServiceAccountCredential } from "./credential";
import googleSheets from "./node";

export const nodes: NodeDefinition[] = [googleSheets];
export const credentialTypes: CredentialTypeDefinition[] = [
  sheetsOAuth2Credential,
  sheetsServiceAccountCredential,
];
