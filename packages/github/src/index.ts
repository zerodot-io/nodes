// SPDX-License-Identifier: AGPL-3.0-only
import type { CredentialTypeDefinition, NodeDefinition } from "@zerodot/node-sdk";
import { githubOAuth2Credential, githubTokenCredential } from "./credential";
import github from "./node";
import githubTrigger from "./trigger";

export const nodes: NodeDefinition[] = [githubTrigger, github];
export const credentialTypes: CredentialTypeDefinition[] = [
  githubTokenCredential,
  githubOAuth2Credential,
];
