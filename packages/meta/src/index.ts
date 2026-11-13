// SPDX-License-Identifier: AGPL-3.0-only
import type { CredentialTypeDefinition, NodeDefinition } from "@zerodot/node-sdk";
import { metaCredential } from "./credential";
import meta from "./node";
import metaTrigger from "./trigger";

export const nodes: NodeDefinition[] = [metaTrigger, meta];
export const credentialTypes: CredentialTypeDefinition[] = [metaCredential];
