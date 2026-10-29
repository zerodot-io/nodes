// SPDX-License-Identifier: AGPL-3.0-only
import type { SheetsRequest } from "./api";

export type Cell = string | number | boolean;
export type Row = Record<string, unknown>;

// ---------------------------------------------------------------------------------------------
// IDs and A1 notation

const ID = /^[A-Za-z0-9_-]+$/;

/** The ID of a spreadsheet, from its URL or the bare ID. */
export function parseSpreadsheetId(input: string | undefined): string {
  const value = (input ?? "").trim();
  if (!value) throw new Error('"spreadsheetId" is needed: the URL of the spreadsheet, or its ID');
  const fromUrl = /\/spreadsheets\/d\/([A-Za-z0-9_-]+)/.exec(value)?.[1];
  if (fromUrl) return fromUrl;
  if (ID.test(value)) return value;
  throw new Error(`"${value}" is not a spreadsheet URL or ID`);
}

/** The tab ID (gid) in a spreadsheet URL, if the URL has one. */
export function gidOf(input: string | undefined): number | undefined {
  const gid = /[#&?]gid=(\d+)/.exec(input ?? "")?.[1];
  return gid === undefined ? undefined : Number(gid);
}

/** A tab name in A1 notation: always in single quotes, a quote is doubled. */
export const quoteSheet = (title: string) => `'${title.replaceAll("'", "''")}'`;

/** The A1 range of a tab. A range that already names a tab (has `!`) stays as it is. */
export function a1Range(title: string, range?: string): string {
  const part = range?.trim();
  if (!part) return quoteSheet(title);
  if (part.includes("!")) return part;
  return `${quoteSheet(title)}!${part}`;
}

/** 0 for A, 25 for Z, 26 for AA. */
export function columnIndex(letters: string): number {
  let index = 0;
  for (const char of letters.toUpperCase()) index = index * 26 + (char.charCodeAt(0) - 64);
  return index - 1;
}

/** A for 0, AA for 26. */
export function columnLetter(index: number): string {
  let letters = "";
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) {
    letters = String.fromCharCode(65 + ((n - 1) % 26)) + letters;
  }
  return letters;
}

/** The first row (1-based) and column (0-based) of an A1 range such as `'Tab'!B3:F9`. */
export function rangeStart(range: string | undefined): { row: number; column: number } {
  const local = range?.slice(range.lastIndexOf("!") + 1) ?? "";
  const match = /^\$?([A-Za-z]*)\$?(\d*)/.exec(local);
  const letters = match?.[1] ?? "";
  const digits = match?.[2] ?? "";
  return {
    column: letters ? columnIndex(letters) : 0,
    row: digits ? Number(digits) : 1,
  };
}

// ---------------------------------------------------------------------------------------------
// Requests

const seg = encodeURIComponent;

export function createSpreadsheetRequest(
  title: string | undefined,
  tabs: string | undefined,
): SheetsRequest {
  const names = (tabs ?? "")
    .split(",")
    .map((name) => name.trim())
    .filter(Boolean);
  const body: Record<string, unknown> = {};
  if (title?.trim()) body.properties = { title: title.trim() };
  if (names.length > 0) body.sheets = names.map((name) => ({ properties: { title: name } }));
  return { method: "POST", path: "", body, action: "create the spreadsheet" };
}

export const getSpreadsheetRequest = (id: string): SheetsRequest => ({
  method: "GET",
  path: `/${seg(id)}`,
  action: "get the spreadsheet",
});

/** Only the properties of the tabs: their IDs and names. */
export const listTabsRequest = (id: string): SheetsRequest => ({
  method: "GET",
  path: `/${seg(id)}`,
  query: { fields: "sheets.properties(sheetId,title,index)" },
  action: "get the tabs",
});

export const readValuesRequest = (
  id: string,
  range: string,
  render: string,
  dateTimeRender?: string,
): SheetsRequest => ({
  method: "GET",
  path: `/${seg(id)}/values/${seg(range)}`,
  query: {
    majorDimension: "ROWS",
    valueRenderOption: render,
    dateTimeRenderOption: render === "FORMATTED_VALUE" ? undefined : dateTimeRender,
  },
  action: "read the rows",
});

export const appendValuesRequest = (
  id: string,
  range: string,
  values: Cell[][],
  valueInputOption: string,
): SheetsRequest => ({
  method: "POST",
  path: `/${seg(id)}/values/${seg(range)}:append`,
  query: { valueInputOption, insertDataOption: "INSERT_ROWS", includeValuesInResponse: "false" },
  body: { range, majorDimension: "ROWS", values },
  action: "append the rows",
});

export type ValueRange = { range: string; values: Cell[][] };

export const updateValuesRequest = (
  id: string,
  data: ValueRange[],
  valueInputOption: string,
): SheetsRequest => ({
  method: "POST",
  path: `/${seg(id)}/values:batchUpdate`,
  body: { valueInputOption, data },
  action: "update the rows",
});

export const clearValuesRequest = (id: string, range: string): SheetsRequest => ({
  method: "POST",
  path: `/${seg(id)}/values/${seg(range)}:clear`,
  body: {},
  action: "clear the range",
});

export const batchUpdateRequest = (
  id: string,
  requests: Record<string, unknown>[],
  action: string,
): SheetsRequest => ({
  method: "POST",
  path: `/${seg(id)}:batchUpdate`,
  body: { requests },
  action,
});

export const addTabRequest = (id: string, title: string) =>
  batchUpdateRequest(id, [{ addSheet: { properties: { title } } }], "create the tab");

export const deleteTabRequest = (id: string, sheetId: number) =>
  batchUpdateRequest(id, [{ deleteSheet: { sheetId } }], "delete the tab");

/** `startRow` is the 1-based row number of the first row. */
export const deleteRowsRequest = (id: string, sheetId: number, startRow: number, count: number) =>
  batchUpdateRequest(
    id,
    [
      {
        deleteDimension: {
          range: {
            sheetId,
            dimension: "ROWS",
            startIndex: startRow - 1,
            endIndex: startRow - 1 + count,
          },
        },
      },
    ],
    "delete the rows",
  );

// ---------------------------------------------------------------------------------------------
// Tabs

export type Tab = { sheetId: number; title: string };

/** The tabs in an answer of `listTabsRequest`. */
export function tabsOf(answer: unknown): Tab[] {
  const sheets = (answer as { sheets?: unknown } | null)?.sheets;
  if (!Array.isArray(sheets)) return [];
  return sheets.flatMap((sheet) => {
    const properties = (sheet as { properties?: { sheetId?: unknown; title?: unknown } })
      .properties;
    return typeof properties?.sheetId === "number" && typeof properties.title === "string"
      ? [{ sheetId: properties.sheetId, title: properties.title }]
      : [];
  });
}

/** The tab with this name, else the tab of the gid, else the first tab. */
export function pickTab(tabs: Tab[], name: string | undefined, gid: number | undefined): Tab {
  const wanted = name?.trim();
  if (wanted) {
    const found = tabs.find((tab) => tab.title === wanted);
    if (!found) throw new Error(`The spreadsheet has no tab "${wanted}"`);
    return found;
  }
  const tab = (gid === undefined ? undefined : tabs.find((t) => t.sheetId === gid)) ?? tabs[0];
  if (!tab) throw new Error("The spreadsheet has no tabs");
  return tab;
}

// ---------------------------------------------------------------------------------------------
// Rows and header-row mapping

/** A value that the Sheets API takes. */
export function toCell(value: unknown): Cell {
  if (value === null || value === undefined) return "";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  if (typeof value === "bigint") return value.toString();
  if (value instanceof Date) return value.toISOString();
  return JSON.stringify(value);
}

const sameValue = (a: unknown, b: unknown) => String(toCell(a)) === String(toCell(b));

export type Table = {
  /** Column names. An empty name is a column without a header. */
  headers: string[];
  /** The 1-based row number of the header row. */
  headerRow: number;
  /** The 0-based column of the first header. */
  startColumn: number;
  rows: { rowNumber: number; cells: unknown[] }[];
};

/**
 * The table in an answer of `readValuesRequest`. The values start at the first row of the range
 * of the answer. `headerRow` is a row number in the tab.
 */
export function toTable(answer: unknown, headerRow: number): Table {
  const { range, values } = (answer ?? {}) as { range?: unknown; values?: unknown };
  const start = rangeStart(typeof range === "string" ? range : undefined);
  const rows = Array.isArray(values) ? values.map((row) => (Array.isArray(row) ? row : [])) : [];
  const headerIndex = headerRow - start.row;
  if (headerIndex < 0) {
    throw new Error(
      `The header row ${headerRow} is above the range, which starts at row ${start.row}`,
    );
  }
  const headers = (rows[headerIndex] ?? []).map((cell) => String(toCell(cell)).trim());
  return {
    headers,
    headerRow,
    startColumn: start.column,
    rows: rows.slice(headerIndex + 1).map((cells, n) => ({ rowNumber: headerRow + 1 + n, cells })),
  };
}

const isEmptyRow = (cells: unknown[]) => cells.every((cell) => cell === "" || cell == null);

/** A row as an object keyed by header, with its row number. */
export function rowObject(headers: string[], cells: unknown[], rowNumber: number): Row {
  const row: Row = { row_number: rowNumber };
  headers.forEach((header, index) => {
    if (header) row[header] = cells[index] ?? "";
  });
  return row;
}

/** The rows of a table as objects. Empty rows are left out. A filter keeps matching rows. */
export function tableObjects(table: Table, filter?: { column: string; value: string }): Row[] {
  let column = -1;
  if (filter?.column) {
    column = table.headers.indexOf(filter.column);
    if (column < 0) throw new Error(`The header row has no column "${filter.column}"`);
  }
  return table.rows
    .filter(({ cells }) => !isEmptyRow(cells))
    .filter(({ cells }) => column < 0 || sameValue(cells[column], filter?.value))
    .map(({ rowNumber, cells }) => rowObject(table.headers, cells, rowNumber));
}

/** The cells of an item in the order of the headers. A missing key gives an empty cell. */
export const rowCells = (item: Row, headers: string[]): Cell[] =>
  headers.map((header) => (header && header in item ? toCell(item[header]) : ""));

/**
 * The headers to write with. When the header row is empty, the keys of the items are the
 * headers. With `addNew`, a key that is not a header becomes a new column.
 */
export function withItemHeaders(
  headers: string[],
  items: Row[],
  addNew: boolean,
): { headers: string[]; changed: boolean } {
  const empty = headers.every((header) => header === "");
  if (!empty && !addNew) return { headers, changed: false };
  const next = empty ? [] : [...headers];
  for (const item of items) {
    for (const key of Object.keys(item)) {
      if (key !== "row_number" && !next.includes(key)) next.push(key);
    }
  }
  return { headers: next, changed: next.length !== headers.length || empty };
}

export type WritePlan = {
  /** Cells to change, one range per cell, so the other cells stay as they are. */
  updates: ValueRange[];
  /** New rows, in the order of the items. */
  appends: Cell[][];
  /** For each item: the row number it changed, or the index in `appends`. */
  targets: ({ rowNumber: number } | { append: number })[];
};

/**
 * Finds the row of each item by the match column, and plans the writes. `update` throws when
 * an item has no row. `appendOrUpdate` appends it. Only the keys of an item that are headers
 * are written.
 */
export function planWrite(
  table: Table,
  headers: string[],
  items: Row[],
  options: { matchColumn: string; mode: "update" | "appendOrUpdate"; sheetTitle: string },
): WritePlan {
  const { matchColumn, mode, sheetTitle } = options;
  const byRowNumber = matchColumn === "row_number";
  const keyIndex = byRowNumber ? -1 : headers.indexOf(matchColumn);
  if (!byRowNumber && keyIndex < 0)
    throw new Error(`The header row has no column "${matchColumn}"`);

  const plan: WritePlan = { updates: [], appends: [], targets: [] };
  const appended = new Map<string, number>();

  items.forEach((item, index) => {
    const key = item[matchColumn];
    if (key === undefined || key === null || key === "") {
      throw new Error(`Item ${index} has no value for the match column "${matchColumn}"`);
    }
    let rowNumber: number | undefined;
    if (byRowNumber) {
      rowNumber = Number(key);
      if (!Number.isInteger(rowNumber) || rowNumber <= table.headerRow) {
        throw new Error(`Item ${index} has a row_number that is not below the header row`);
      }
    } else {
      rowNumber = table.rows.find((r) => sameValue(r.cells[keyIndex], key))?.rowNumber;
    }

    if (rowNumber !== undefined) {
      headers.forEach((header, column) => {
        if (!header || !(header in item) || header === matchColumn) return;
        const cell = `${columnLetter(table.startColumn + column)}${rowNumber}`;
        plan.updates.push({
          range: `${quoteSheet(sheetTitle)}!${cell}`,
          values: [[toCell(item[header])]],
        });
      });
      plan.targets.push({ rowNumber });
      return;
    }
    if (mode === "update") {
      throw new Error(`No row has "${matchColumn}" = "${String(toCell(key))}"`);
    }
    // Two items with the same new key make one new row. The later item wins.
    const seen = appended.get(String(toCell(key)));
    if (seen !== undefined) {
      const cells = plan.appends[seen] ?? [];
      rowCells(item, headers).forEach((cell, column) => {
        if (headers[column] && headers[column] in item) cells[column] = cell;
      });
      plan.targets.push({ append: seen });
      return;
    }
    appended.set(String(toCell(key)), plan.appends.length);
    plan.targets.push({ append: plan.appends.length });
    plan.appends.push(rowCells(item, headers));
  });
  return plan;
}
