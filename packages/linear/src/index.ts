// SPDX-License-Identifier: AGPL-3.0-only
import type { CredentialTypeDefinition, NodeDefinition } from "@zerodot/node-sdk";
import { linearApiKeyCredential, linearOAuth2Credential } from "./credential";
import linear from "./node";
import linearTrigger from "./trigger";

export const nodes: NodeDefinition[] = [linearTrigger, linear];
export const credentialTypes: CredentialTypeDefinition[] = [
  linearApiKeyCredential,
  linearOAuth2Credential,
];
