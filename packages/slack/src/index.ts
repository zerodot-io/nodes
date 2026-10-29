// SPDX-License-Identifier: AGPL-3.0-only
import type { CredentialTypeDefinition, NodeDefinition } from "@zerodot/node-sdk";
import { slackCredential } from "./credential";
import slack from "./node";
import slackTrigger from "./trigger";

export const nodes: NodeDefinition[] = [slackTrigger, slack];
export const credentialTypes: CredentialTypeDefinition[] = [slackCredential];
