// SPDX-License-Identifier: AGPL-3.0-only
import type { CredentialTypeDefinition, NodeDefinition } from "@zerodot/node-sdk";
import { redisCredential } from "./credential";
import redis from "./redis";
import redisTrigger from "./redis-trigger";

export const nodes: NodeDefinition[] = [redis, redisTrigger];
export const credentialTypes: CredentialTypeDefinition[] = [redisCredential];
