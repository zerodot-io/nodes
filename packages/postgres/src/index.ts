// SPDX-License-Identifier: AGPL-3.0-only
import type { CredentialTypeDefinition, NodeDefinition } from "@zerodot/node-sdk";
import { postgresCredential } from "./credential";
import postgres from "./postgres";
import postgresListen from "./postgres-listen";
import postgresMemory from "./postgres-memory";
import postgresTrigger from "./postgres-trigger";
import postgresVector from "./postgres-vector";

export const nodes: NodeDefinition[] = [
  postgres,
  postgresTrigger,
  postgresListen,
  postgresMemory,
  postgresVector,
];
export const credentialTypes: CredentialTypeDefinition[] = [postgresCredential];
