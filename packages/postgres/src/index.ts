// SPDX-License-Identifier: AGPL-3.0-only
import type { CredentialTypeDefinition, NodeDefinition } from "@zerodot/node-sdk";
import { postgresCredential } from "./credential";
import postgres from "./postgres";
import postgresListen from "./postgres-listen";
import postgresTrigger from "./postgres-trigger";

export const nodes: NodeDefinition[] = [postgres, postgresTrigger, postgresListen];
export const credentialTypes: CredentialTypeDefinition[] = [postgresCredential];
