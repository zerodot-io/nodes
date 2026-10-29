// SPDX-License-Identifier: AGPL-3.0-only
import { isRecord } from "@zerodot/node-sdk";
import { type Cell, columnLetters, type Grid, isEmptyRow } from "./grid";

export type Row = Record<string, unknown>;

type RowOptions = {
  header: boolean;
  skipEmpty: boolean;
  maxRows: number;
  /** The column of the first cell, so that "no header" keys are the letters of the sheet. */
  firstColumn: number;
};

/** Empty names get `column_N`. A name that repeats gets `_2`, `_3`, and so on. */
function headerNames(row: Cell[], width: number): string[] {
  const used = new Set<string>();
  return Array.from({ length: width }, (_, index) => {
    const cell = row[index];
    const base = cell === null || cell === undefined ? "" : String(cell).trim();
    let name = base || `column_${index + 1}`;
    for (let n = 2; used.has(name); n++) name = `${base || `column_${index + 1}`}_${n}`;
    used.add(name);
    return name;
  });
}

const plain = (cell: Cell | undefined): unknown =>
  cell instanceof Date ? cell.toISOString() : (cell ?? null);

export function gridToRows(grid: Grid, options: RowOptions): { rows: Row[]; columns: string[] } {
  const width = grid.reduce((max, row) => Math.max(max, row.length), 0);
  const head = options.header ? (grid[0] ?? []) : [];
  const columns = options.header
    ? headerNames(head, width)
    : Array.from({ length: width }, (_, index) => columnLetters(options.firstColumn + index));
  let body = options.header ? grid.slice(1) : grid;
  if (options.skipEmpty) body = body.filter((row) => !isEmptyRow(row));
  if (options.maxRows > 0) body = body.slice(0, options.maxRows);
  const rows = body.map((cells) => {
    const row: Row = {};
    columns.forEach((name, index) => {
      row[name] = plain(cells[index]);
    });
    return row;
  });
  return { rows, columns };
}

/** A cell for a value from a workflow. A list or an object becomes JSON text. */
function toCell(value: unknown): Cell {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value;
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  return JSON.stringify(value);
}

export function rowsToGrid(items: Row[], names: string[], header: boolean): Grid {
  // No names given: use the keys of all rows, in the order they appear.
  const columns = names.length
    ? names
    : [...new Set(items.flatMap((item) => (isRecord(item) ? Object.keys(item) : [])))];
  if (!columns.length) throw new Error("The input rows have no fields to write");
  const grid: Grid = header ? [columns] : [];
  for (const item of items) grid.push(columns.map((name) => toCell(item[name])));
  return grid;
}
