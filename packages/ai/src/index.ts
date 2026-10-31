// SPDX-License-Identifier: AGPL-3.0-only
import { aiCredentialTypes } from "@zerodot/ai-core";
import type { CredentialTypeDefinition, NodeDefinition } from "@zerodot/node-sdk";
import { AI_ICON } from "./icon";
import ai from "./node";

export const nodes: NodeDefinition[] = [ai];
export const credentialTypes: CredentialTypeDefinition[] = aiCredentialTypes(AI_ICON);
