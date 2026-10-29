// SPDX-License-Identifier: AGPL-3.0-only
import type { NodeDefinition } from "@zerodot/node-sdk";
import filePdf from "./file-pdf";

export const nodes: NodeDefinition[] = [filePdf];
export const credentialTypes: never[] = [];
