// SPDX-License-Identifier: AGPL-3.0-only
import { parse } from "csv-parse/sync";
import { stringify } from "csv-stringify/sync";
import readXlsxFile, { readSheet } from "read-excel-file/node";
import writeXlsxFile from "write-excel-file/node";

/** One cell. An empty cell is null. */
export type Cell = string | number | boolean | Date | null;
export type Grid = Cell[][];
export type Format = "csv" | "xlsx";

export type CellRange = {
  rowStart: number;
  rowEnd: number | undefined;
  colStart: number;
  colEnd: number | undefined;
};

const ZIP_MAGIC = [0x50, 0x4b, 0x03, 0x04];

/** "A" is 0, "Z" is 25, "AA" is 26. */
function columnIndex(letters: string): number {
  let index = 0;
  for (const letter of letters.toUpperCase()) index = index * 26 + letter.charCodeAt(0) - 64;
  return index - 1;
}

/** 0 is "A", 26 is "AA". */
export function columnLetters(index: number): string {
  let letters = "";
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) {
    letters = String.fromCharCode(65 + ((n - 1) % 26)) + letters;
  }
  return letters;
}

/** Reads "A1:D20". Each part is optional, so "B2:", "A:C", and "2:5" also work. */
export function parseRange(text: string): CellRange | null {
  const value = text.trim();
  if (!value) return null;
  const match = /^([A-Za-z]{0,3})(\d*):([A-Za-z]{0,3})(\d*)$/.exec(value);
  if (!match) throw new Error(`"${value}" is not a range. Example: A1:D20`);
  const [, colA = "", rowA = "", colB = "", rowB = ""] = match;
  if (rowA === "0" || rowB === "0") throw new Error("Rows count from 1");
  const range: CellRange = {
    rowStart: rowA ? Number(rowA) - 1 : 0,
    rowEnd: rowB ? Number(rowB) - 1 : undefined,
    colStart: colA ? columnIndex(colA) : 0,
    colEnd: colB ? columnIndex(colB) : undefined,
  };
  if (
    (range.rowEnd !== undefined && range.rowEnd < range.rowStart) ||
    (range.colEnd !== undefined && range.colEnd < range.colStart)
  ) {
    throw new Error(`The range "${value}" ends before it starts`);
  }
  return range;
}

export function cropGrid(grid: Grid, range: CellRange | null): Grid {
  if (!range) return grid;
  const end = range.rowEnd === undefined ? undefined : range.rowEnd + 1;
  const colEnd = range.colEnd === undefined ? undefined : range.colEnd + 1;
  return grid.slice(range.rowStart, end).map((row) => row.slice(range.colStart, colEnd));
}

const isBlank = (cell: Cell | undefined): boolean =>
  cell === null || cell === undefined || (typeof cell === "string" && cell.trim() === "");

export const isEmptyRow = (row: Cell[]): boolean => row.every(isBlank);

/** Guess the format from the file name, the type, and the first bytes. */
export function detectFormat(
  bytes: Uint8Array,
  fileName: string | undefined,
  mimeType: string | undefined,
): Format {
  const extension = /\.([^.]+)$/.exec(fileName ?? "")?.[1]?.toLowerCase();
  if (extension === "xlsx") return "xlsx";
  if (extension === "xls") {
    throw new Error("The old XLS format is not supported. Save the file as XLSX or CSV.");
  }
  if (extension === "csv" || extension === "tsv" || extension === "txt") return "csv";
  if (mimeType?.includes("spreadsheetml")) return "xlsx";
  if (mimeType === "text/csv") return "csv";
  return ZIP_MAGIC.every((byte, index) => bytes[index] === byte) ? "xlsx" : "csv";
}

/** A number or a boolean in text becomes a number or a boolean. "007" stays text. */
function castText(text: string): Cell {
  if (text === "") return null;
  const lower = text.toLowerCase();
  if (lower === "true") return true;
  if (lower === "false") return false;
  const number = Number(text);
  return Number.isFinite(number) && String(number) === text ? number : text;
}

export function readCsv(bytes: Uint8Array, delimiter: string, parseValues: boolean): Grid {
  let records: unknown;
  try {
    records = parse(Buffer.from(bytes), {
      delimiter,
      bom: true,
      relax_column_count: true,
      relax_quotes: true,
      skip_empty_lines: false,
    });
  } catch (error) {
    throw new Error(
      `The CSV file has an error: ${error instanceof Error ? error.message : "unknown error"}`,
    );
  }
  if (!Array.isArray(records)) return [];
  return records.map((record: unknown) =>
    (Array.isArray(record) ? record : []).map((value: unknown): Cell => {
      const text = String(value ?? "");
      return parseValues ? castText(text) : text === "" ? null : text;
    }),
  );
}

function fromSheetCell(value: unknown): Cell {
  if (value === null || value === undefined) return null;
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  return value instanceof Date ? value : String(value);
}

export async function sheetNames(bytes: Uint8Array): Promise<string[]> {
  try {
    return (await readXlsxFile(Buffer.from(bytes))).map((entry) => entry.sheet);
  } catch {
    throw new Error("The binary data is not an XLSX file that this node can read");
  }
}

export async function readXlsx(bytes: Uint8Array, sheet: string): Promise<Grid> {
  const buffer = Buffer.from(bytes);
  // Check the sheet name first, so the error can list the names.
  const names = await sheetNames(bytes);
  if (sheet && !names.includes(sheet)) {
    throw new Error(`The file has no sheet "${sheet}". Sheets: ${names.join(", ")}`);
  }
  const data = await readSheet(buffer, sheet || 1);
  return data.map((row) => row.map(fromSheetCell));
}

const textOf = (cell: Cell): string => (cell instanceof Date ? cell.toISOString() : String(cell));

export function writeCsv(grid: Grid, delimiter: string): Uint8Array {
  const text = stringify(
    grid.map((row) => row.map((cell) => (cell === null ? "" : textOf(cell)))),
    { delimiter },
  );
  return Buffer.from(text, "utf8");
}

export async function writeXlsx(grid: Grid, sheet: string, boldFirstRow: boolean) {
  if (sheet.length > 31 || /[[\]:*?/\\]/.test(sheet)) {
    throw new Error("A sheet name has 31 characters or less, and has none of: [ ] : * ? / \\");
  }
  const data = grid.map((row, index) =>
    row.map((cell) =>
      boldFirstRow && index === 0 && cell !== null
        ? { value: textOf(cell), fontWeight: "bold" as const }
        : cell,
    ),
  );
  const buffer = await writeXlsxFile(data, {
    sheet: sheet || "Sheet1",
    dateFormat: "yyyy-mm-dd hh:mm:ss",
  }).toBuffer();
  return new Uint8Array(buffer);
}
