// SPDX-License-Identifier: AGPL-3.0-only
import type { CredentialTypeDefinition, NodeDefinition } from "@zerodot/node-sdk";
import { mysqlCredential } from "./credential";
import mysql from "./mysql";

export const nodes: NodeDefinition[] = [mysql];
export const credentialTypes: CredentialTypeDefinition[] = [mysqlCredential];
