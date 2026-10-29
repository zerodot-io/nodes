// SPDX-License-Identifier: AGPL-3.0-only
import type { NodeDefinition } from "@zerodot/node-sdk";
import fileSpreadsheet from "./file-spreadsheet";

export const nodes: NodeDefinition[] = [fileSpreadsheet];
export const credentialTypes: never[] = [];
