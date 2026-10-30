// SPDX-License-Identifier: AGPL-3.0-only
import { defineNode, isRecord, readBinary, toBinary, toItems } from "@zerodot/node-sdk";
import { z } from "zod";
import {
  type Cell,
  cropGrid,
  detectFormat,
  type Format,
  type Grid,
  isEmptyRow,
  parseRange,
  readCsv,
  readXlsx,
  sheetNames,
  writeCsv,
  writeXlsx,
} from "./grid";
import { SPREADSHEET_ICON } from "./icon";
import { gridToRows, type Row, rowsToGrid } from "./rows";

const OPERATIONS = ["read", "write", "convert", "sheets"] as const;
const DELIMITERS = [",", ";", "\t", "|"] as const;
const MIME: Record<Format, string> = {
  csv: "text/csv",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
};

const config = z.object({
  operation: z
    .enum(OPERATIONS)
    .default("read")
    .meta({
      title: "Operation",
      labels: {
        read: "Read",
        write: "Write",
        convert: "Convert",
        sheets: "List Sheets",
      },
      hints: {
        read: "Turn a CSV or XLSX file into rows",
        write: "Turn rows into a CSV or XLSX file",
        convert: "Change a CSV file to XLSX, or an XLSX file to CSV",
        sheets: "Get the names of the sheets in an XLSX file",
      },
    }),
  property: z
    .string()
    .min(1)
    .default("data")
    .meta({
      title: "Input Binary Field",
      description: "The file is in binary.<property> of the input",
      showWhen: { operation: ["read", "convert", "sheets"] },
    }),
  format: z
    .enum(["auto", "csv", "xlsx"])
    .default("auto")
    .meta({
      title: "File Format",
      labels: { auto: "Detect", csv: "CSV", xlsx: "XLSX" },
      hints: { auto: "Use the file name, the file type, and the first bytes of the file" },
      showWhen: { operation: ["read", "convert"] },
    }),
  outputFormat: z
    .enum(["csv", "xlsx"])
    .default("csv")
    .meta({
      title: "Output Format",
      labels: { csv: "CSV", xlsx: "XLSX" },
      showWhen: { operation: ["write"] },
    }),
  outputProperty: z
    .string()
    .min(1)
    .default("data")
    .meta({
      title: "Output Binary Field",
      description: "The new file goes to binary.<property> of the output",
      showWhen: { operation: ["write", "convert"] },
    }),
  fileName: z
    .string()
    .default("data")
    .meta({
      title: "File Name",
      description: "The name of the new file, with no extension",
      showWhen: { operation: ["write"] },
    }),
  rowsProperty: z
    .string()
    .default("")
    .meta({
      title: "Rows Field",
      description:
        "The field of the input with the list of rows, for example rows. Empty means each input item is one row.",
      showWhen: { operation: ["write"] },
    }),
  columns: z
    .string()
    .default("")
    .meta({
      title: "Columns",
      description: "Names of the columns to write, in order. Split with commas. Empty means all.",
      showWhen: { operation: ["write"] },
    }),
  hasHeader: z
    .boolean()
    .default(true)
    .meta({
      title: "First Row Is Header",
      description:
        "On: the first row gives the field names. Off: the fields are named A, B, C, and so on.",
      showWhen: { operation: ["read"] },
    }),
  writeHeader: z
    .boolean()
    .default(true)
    .meta({
      title: "Write Header Row",
      description: "Write the column names in the first row",
      showWhen: { operation: ["write"] },
    }),
  delimiter: z
    .enum(DELIMITERS)
    .default(",")
    .meta({
      title: "Delimiter",
      description: "The character between the values in a CSV file",
      labels: { ",": "Comma", ";": "Semicolon", "\t": "Tab", "|": "Pipe" },
      showWhen: { operation: ["read", "write", "convert"] },
    }),
  sheet: z
    .string()
    .default("")
    .meta({
      title: "Sheet Name",
      description:
        "For an XLSX file. Read: empty means the first sheet. Write: empty means Sheet1.",
      showWhen: { operation: ["read", "write", "convert"] },
    }),
  range: z
    .string()
    .default("")
    .meta({
      title: "Range",
      description: "Read only some cells. Example: A1:D20, B2:, or A:C. Empty means all cells.",
      showWhen: { operation: ["read", "convert"] },
    }),
  skipEmpty: z
    .boolean()
    .default(true)
    .meta({
      title: "Skip Empty Rows",
      showWhen: { operation: ["read", "convert"] },
    }),
  parseValues: z
    .boolean()
    .default(true)
    .meta({
      title: "Parse Numbers and Booleans",
      description: "For a CSV file. On: 12 is a number. Off: 12 is text. Text like 007 stays text.",
      showWhen: { operation: ["read", "convert"] },
    }),
  maxRows: z
    .number()
    .int()
    .min(0)
    .default(0)
    .meta({
      title: "Row Limit",
      description: "Read at most this many rows. 0 means no limit.",
      showWhen: { operation: ["read"] },
    }),
});

function stemOf(fileName: string | undefined, fallback: string): string {
  return (fileName ?? fallback).replace(/\.[^.]+$/, "") || fallback;
}

function splitNames(text: string): string[] {
  return text
    .split(",")
    .map((name) => name.trim())
    .filter(Boolean);
}

/** The rows to write: the list in one field of the input, or the input items. */
function rowsOf(input: unknown, field: string): Row[] {
  const source = field ? (isRecord(input) ? input[field] : undefined) : toItems(input);
  if (!Array.isArray(source)) {
    throw new Error(`The input has no list of rows in the field "${field}"`);
  }
  return source.map((item: unknown) => {
    if (!isRecord(item)) return { value: item };
    const { binary: _binary, ...row } = item;
    return row;
  });
}

export default defineNode({
  type: "file.spreadsheet",
  label: "Spreadsheet File",
  description: "Read and write CSV and XLSX files",
  category: "data",
  actions: [
    { label: "Read rows from a spreadsheet file", config: { operation: "read" } },
    { label: "Write rows to a CSV file", config: { operation: "write", outputFormat: "csv" } },
    { label: "Write rows to an XLSX file", config: { operation: "write", outputFormat: "xlsx" } },
    { label: "Convert a spreadsheet file between CSV and XLSX", config: { operation: "convert" } },
    { label: "List the sheets of an XLSX file", config: { operation: "sheets" } },
  ],
  icon: "Xls01Icon",
  iconUrl: SPREADSHEET_ICON,
  config,
  defaultConfig: {
    operation: "read",
    property: "data",
    format: "auto",
    outputFormat: "csv",
    outputProperty: "data",
    fileName: "data",
    rowsProperty: "",
    columns: "",
    hasHeader: true,
    writeHeader: true,
    delimiter: ",",
    sheet: "",
    range: "",
    skipEmpty: true,
    parseValues: true,
    maxRows: 0,
  },
  ports: { in: ["in"], out: ["out"] },
  subtitle: (cfg) => (typeof cfg.operation === "string" ? cfg.operation : undefined),
  async run({ config: cfg, input }) {
    if (cfg.operation === "write") {
      const items = rowsOf(input, cfg.rowsProperty.trim());
      if (!items.length) throw new Error("The input has no rows to write");
      const grid = rowsToGrid(items, splitNames(cfg.columns), cfg.writeHeader);
      const name = `${cfg.fileName.trim() || "data"}.${cfg.outputFormat}`;
      const bytes =
        cfg.outputFormat === "csv"
          ? writeCsv(grid, cfg.delimiter)
          : await writeXlsx(grid, cfg.sheet.trim(), cfg.writeHeader);
      return {
        port: "out",
        data: {
          binary: { [cfg.outputProperty]: toBinary(bytes, name, MIME[cfg.outputFormat]) },
          rows: items.length,
        },
      };
    }

    const file = readBinary(input, cfg.property);
    const bytes = new Uint8Array(Buffer.from(file.data, "base64"));
    if (!bytes.length) throw new Error("The file is empty");
    const format: Format =
      cfg.format === "auto" ? detectFormat(bytes, file.fileName, file.mimeType) : cfg.format;

    if (cfg.operation === "sheets") {
      if (format === "csv") throw new Error("A CSV file has no sheets. Use an XLSX file.");
      const names = await sheetNames(bytes);
      return { port: "out", data: { sheets: names, count: names.length } };
    }

    const sheet = cfg.sheet.trim();
    const range = parseRange(cfg.range);
    const whole: Grid =
      format === "csv"
        ? readCsv(bytes, cfg.delimiter, cfg.parseValues)
        : await readXlsx(bytes, sheet);
    const grid = cropGrid(whole, range);

    if (cfg.operation === "read") {
      const { rows, columns } = gridToRows(grid, {
        header: cfg.hasHeader,
        skipEmpty: cfg.skipEmpty,
        maxRows: cfg.maxRows,
        firstColumn: range?.colStart ?? 0,
      });
      return { port: "out", data: { rows, columns, count: rows.length } };
    }

    // convert: the other format, with the cells as they are
    const kept: Cell[][] = cfg.skipEmpty ? grid.filter((row) => !isEmptyRow(row)) : grid;
    if (!kept.length) throw new Error("The file has no rows to convert");
    const target: Format = format === "csv" ? "xlsx" : "csv";
    const out =
      target === "csv" ? writeCsv(kept, cfg.delimiter) : await writeXlsx(kept, sheet, false);
    const name = `${stemOf(file.fileName, "data")}.${target}`;
    return {
      port: "out",
      data: {
        binary: { [cfg.outputProperty]: toBinary(out, name, MIME[target]) },
        rows: kept.length,
        format: target,
      },
    };
  },
});
