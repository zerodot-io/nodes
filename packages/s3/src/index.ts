// SPDX-License-Identifier: AGPL-3.0-only
import type { CredentialTypeDefinition, NodeDefinition } from "@zerodot/node-sdk";
import { s3Credential } from "./credential";
import s3 from "./s3";

export const nodes: NodeDefinition[] = [s3];
export const credentialTypes: CredentialTypeDefinition[] = [s3Credential];
