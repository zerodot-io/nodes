// SPDX-License-Identifier: AGPL-3.0-only
import { z } from "zod";

// Resource and operation names follow the Google Sheets API v4.

export const RESOURCES = ["spreadsheet", "sheet"] as const;
export type Resource = (typeof RESOURCES)[number];

export const OPERATIONS_OF = {
  spreadsheet: ["create", "get"],
  sheet: [
    "getRows",
    "append",
    "update",
    "appendOrUpdate",
    "clear",
    "deleteRows",
    "create",
    "delete",
  ],
} as const satisfies Record<Resource, readonly string[]>;

const ALL_OPERATIONS = [...new Set(Object.values(OPERATIONS_OF).flat())] as [string, ...string[]];

export const AUTHENTICATION = ["oAuth2", "serviceAccount"] as const;

/** Operations that write the rows of the input. */
const WRITE_ROWS = ["append", "update", "appendOrUpdate"];
/** Operations that read or write cells, with an optional A1 range. */
const WITH_RANGE = ["getRows", "update", "appendOrUpdate", "clear"];
const WITH_HEADER = ["getRows", ...WRITE_ROWS];

/** Show a field only for these operations of the sheet resource. */
const onSheet = (...operations: string[]) => ({
  showWhen: { resource: ["sheet"], operation: operations },
});

export const sheetsConfig = z
  .object({
    authentication: z
      .enum(AUTHENTICATION)
      .default("oAuth2")
      .meta({
        title: "Authentication",
        labels: { oAuth2: "OAuth2", serviceAccount: "Service Account" },
        hints: {
          oAuth2: "Sign in with a Google account",
          serviceAccount: "Use the JSON key of a service account",
        },
      }),
    resource: z
      .enum(RESOURCES)
      .default("sheet")
      .meta({
        labels: { spreadsheet: "Spreadsheet", sheet: "Sheet" },
        hints: {
          spreadsheet: "Create a spreadsheet or get its details",
          sheet: "Read and write rows, or add and remove tabs",
        },
      }),
    operation: z
      .enum(ALL_OPERATIONS)
      .default("getRows")
      .meta({
        labels: {
          create: "Create",
          get: "Get",
          getRows: "Get Rows",
          append: "Append Rows",
          update: "Update Rows",
          appendOrUpdate: "Append or Update Rows",
          clear: "Clear",
          deleteRows: "Delete Rows",
          delete: "Delete",
        },
        hints: {
          create: "Create a spreadsheet, or add a tab to a spreadsheet",
          get: "Get the details and the tabs of a spreadsheet",
          getRows: "Read the rows of a tab",
          append: "Add the input items as new rows at the end",
          update: "Change the rows that match a key column",
          appendOrUpdate: "Change the rows that match a key column, and add the others",
          clear: "Remove the values in a range, and keep the cells",
          deleteRows: "Remove rows and move the rows below up",
          delete: "Remove a tab from a spreadsheet",
        },
      }),
    spreadsheetId: z
      .string()
      .optional()
      .meta({
        title: "Spreadsheet",
        showWhen: [{ resource: ["sheet"] }, { resource: ["spreadsheet"], operation: ["get"] }],
        description: "The URL of the spreadsheet, or its ID",
      }),
    sheetName: z
      .string()
      .optional()
      .meta({
        ...onSheet(...WITH_RANGE, "append", "deleteRows", "delete"),
        title: "Tab",
        description: "The name of the tab. Empty: the tab in the URL (gid), or the first tab",
      }),
    title: z
      .string()
      .optional()
      .meta({
        showWhen: [
          { resource: ["spreadsheet"], operation: ["create"] },
          { resource: ["sheet"], operation: ["create"] },
        ],
        description: "The title of the new spreadsheet or tab",
      }),
    sheetTitles: z
      .string()
      .optional()
      .meta({
        showWhen: { resource: ["spreadsheet"], operation: ["create"] },
        title: "Tabs",
        description: "Names of the tabs, with commas between. Empty: one tab",
      }),
    range: z
      .string()
      .optional()
      .meta({
        ...onSheet(...WITH_RANGE),
        title: "Range",
        description: "A1 range in the tab, for example A1:F100 or B:D. Empty: the full tab",
      }),
    useHeaderRow: z
      .boolean()
      .default(true)
      .meta({
        ...onSheet("getRows"),
        title: "Use Header Row",
        description: "Give each row as an object with the column names as keys",
      }),
    headerRow: z
      .number()
      .int()
      .min(1)
      .default(1)
      .meta({
        ...onSheet(...WITH_HEADER),
        title: "Header Row",
        description: "The row number with the column names. The data starts below it",
      }),
    matchColumn: z
      .string()
      .optional()
      .meta({
        ...onSheet("update", "appendOrUpdate"),
        title: "Column to Match On",
        description: "A column name from the header row, or row_number. Each item needs a value",
      }),
    lookupColumn: z
      .string()
      .optional()
      .meta({
        ...onSheet("getRows"),
        title: "Filter Column",
        description: "Give only the rows where this column has the filter value",
      }),
    lookupValue: z
      .string()
      .optional()
      .meta({ ...onSheet("getRows"), title: "Filter Value" }),
    dataMode: z
      .enum(["autoMapInputData", "defineBelow"])
      .default("autoMapInputData")
      .meta({
        ...onSheet(...WRITE_ROWS),
        title: "Data Mode",
        labels: {
          autoMapInputData: "Auto-Map Input Data",
          defineBelow: "Map Each Column Manually",
        },
        hints: {
          autoMapInputData: "The keys of each input item are the column names",
          defineBelow: "Set the value of each column, with expressions",
        },
      }),
    columns: z
      .record(z.string(), z.unknown())
      .optional()
      .meta({
        showWhen: { resource: ["sheet"], operation: WRITE_ROWS, dataMode: ["defineBelow"] },
        title: "Columns",
        ui: "fields",
        description: "Column names and their values. A value can read the item with $item",
      }),
    addNewColumns: z
      .boolean()
      .default(false)
      .meta({
        ...onSheet(...WRITE_ROWS),
        title: "Add New Columns",
        description: "Add a key that is not in the header row as a new column. Else skip it",
      }),
    valueInputOption: z
      .enum(["USER_ENTERED", "RAW"])
      .default("USER_ENTERED")
      .meta({
        ...onSheet(...WRITE_ROWS),
        title: "Value Input",
        labels: { USER_ENTERED: "User Entered", RAW: "Raw" },
        hints: {
          USER_ENTERED: "Read values as typed in the UI: formulas, numbers, and dates",
          RAW: "Keep values as text, without changes",
        },
      }),
    valueRenderOption: z
      .enum(["FORMATTED_VALUE", "UNFORMATTED_VALUE", "FORMULA"])
      .default("FORMATTED_VALUE")
      .meta({
        ...onSheet("getRows"),
        title: "Value Render",
        labels: {
          FORMATTED_VALUE: "Formatted Value",
          UNFORMATTED_VALUE: "Unformatted Value",
          FORMULA: "Formula",
        },
        hints: {
          FORMATTED_VALUE: "Values as text, as the UI shows them",
          UNFORMATTED_VALUE: "Numbers and booleans without the format",
          FORMULA: "The formula of a cell, not its result",
        },
      }),
    dateTimeRenderOption: z
      .enum(["SERIAL_NUMBER", "FORMATTED_STRING"])
      .default("FORMATTED_STRING")
      .meta({
        showWhen: {
          resource: ["sheet"],
          operation: ["getRows"],
          valueRenderOption: ["UNFORMATTED_VALUE", "FORMULA"],
        },
        title: "Date Render",
        labels: { SERIAL_NUMBER: "Serial Number", FORMATTED_STRING: "Formatted String" },
        hints: {
          SERIAL_NUMBER: "Days since 30 December 1899, as a number",
          FORMATTED_STRING: "Dates as text, in the format of the cell",
        },
      }),
    startRow: z
      .number()
      .int()
      .min(1)
      .optional()
      .meta({
        ...onSheet("deleteRows"),
        title: "Start Row",
        description: "The row number of the first row to delete",
      }),
    numberOfRows: z
      .number()
      .int()
      .min(1)
      .default(1)
      .meta({ ...onSheet("deleteRows"), title: "Number of Rows" }),
    timeoutMs: z.number().int().min(1).max(300_000).default(30_000),
  })
  .superRefine((config, context) => {
    const operations: readonly string[] = OPERATIONS_OF[config.resource];
    if (!operations.includes(config.operation)) {
      context.addIssue({
        code: "custom",
        path: ["operation"],
        message: `"${config.operation}" is not an operation of "${config.resource}"`,
      });
    }
  });

export type SheetsConfig = z.output<typeof sheetsConfig>;
