// SPDX-License-Identifier: AGPL-3.0-only
import type { CredentialTypeDefinition, NodeDefinition } from "@zerodot/node-sdk";
import { mongodbCredential } from "./credential";
import mongodb from "./mongodb";

export const nodes: NodeDefinition[] = [mongodb];
export const credentialTypes: CredentialTypeDefinition[] = [mongodbCredential];
