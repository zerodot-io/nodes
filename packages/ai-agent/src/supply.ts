// SPDX-License-Identifier: AGPL-3.0-only
import { isRecord, type defineSupplyNode as sdkDefineSupplyNode } from "@zerodot/node-sdk";

/**
 * The same as `defineSupplyNode` of the node SDK 1.4. A running zerodot can keep an older SDK in
 * memory after npm updates the SDK in the nodes folder, and that SDK has no `defineSupplyNode`.
 * So the package does not call SDK functions that are newer than 1.2 (see the test).
 */
export const defineSupplyNode: typeof sdkDefineSupplyNode = (definition) => ({
  ...definition,
  ports: { in: [], out: [] },
  run: () => {
    throw new Error("A supply node does not run as a step");
  },
});

/**
 * The values on the supply ports of a supply node. The node SDK 1.5 gives them in `supplies`.
 * The SDK 1.4 types do not have the field, so this reads it without them.
 */
export const suppliesOf = (context: object): Record<string, unknown> | undefined =>
  "supplies" in context && isRecord(context.supplies) ? context.supplies : undefined;
