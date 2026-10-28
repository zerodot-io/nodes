// SPDX-License-Identifier: AGPL-3.0-only

export type Row = Record<string, unknown>;

export const isRecord = (value: unknown): value is Row =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** The items of a node input. A list is many items, an object is one, and a value is wrapped. */
export function toItems(input: unknown): Row[] {
  if (Array.isArray(input)) return input.map((item) => (isRecord(item) ? item : { value: item }));
  if (isRecord(input)) return [input];
  if (input === null || input === undefined) return [{}];
  return [{ value: input }];
}
