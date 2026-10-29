// SPDX-License-Identifier: AGPL-3.0-only
import { defineNode, isRecord, resolveConfig, toItems } from "@zerodot/node-sdk";
import {
  type CallOptions,
  callSheets,
  SHEETS_OAUTH2_CREDENTIAL,
  SHEETS_SERVICE_ACCOUNT_CREDENTIAL,
  type SheetsRequest,
  sheetsToken,
} from "./api";
import { type SheetsConfig, sheetsConfig } from "./config";
import { SHEETS_ICON } from "./icon";
import {
  a1Range,
  addTabRequest,
  appendValuesRequest,
  type Cell,
  clearValuesRequest,
  columnLetter,
  createSpreadsheetRequest,
  deleteRowsRequest,
  deleteTabRequest,
  getSpreadsheetRequest,
  gidOf,
  listTabsRequest,
  parseSpreadsheetId,
  pickTab,
  planWrite,
  quoteSheet,
  type Row,
  rangeStart,
  readValuesRequest,
  rowCells,
  type Table,
  tableObjects,
  tabsOf,
  toTable,
  updateValuesRequest,
  type ValueRange,
  withItemHeaders,
} from "./request";

type Call = (request: SheetsRequest) => Promise<unknown>;

const need = <T>(value: T | undefined, name: string, operation: string): T => {
  if (value === undefined || value === "" || (typeof value === "string" && !value.trim())) {
    throw new Error(`"${name}" is needed to ${operation}`);
  }
  return value;
};

/** The rows to write: the input items, or the mapped columns of each item. */
function rowsOf(config: SheetsConfig, input: unknown, scope: Record<string, unknown>): Row[] {
  const items = toItems(input);
  if (config.dataMode !== "defineBelow") return items;
  return items.map((item, index) => {
    const mapped = resolveConfig(config.columns ?? {}, {
      ...scope,
      $item: item,
      $json: item,
      $index: index,
    });
    return isRecord(mapped) ? mapped : {};
  });
}

/** The first row number in the `updatedRange` of an append answer. */
const appendedFrom = (answer: unknown): number | undefined => {
  const range = (answer as { updates?: { updatedRange?: unknown } } | null)?.updates?.updatedRange;
  return typeof range === "string" ? rangeStart(range).row : undefined;
};

async function writeRows(
  call: Call,
  config: SheetsConfig,
  id: string,
  title: string,
  items: Row[],
): Promise<Row[]> {
  const operation = config.operation;
  const input = config.valueInputOption;
  const range =
    operation === "append" ? `${config.headerRow}:${config.headerRow}` : (config.range ?? "");
  const table: Table = toTable(
    await call(readValuesRequest(id, a1Range(title, range), "UNFORMATTED_VALUE")),
    config.headerRow,
  );
  const { headers, changed } = withItemHeaders(table.headers, items, config.addNewColumns);
  if (headers.every((header) => header === "")) {
    throw new Error("The header row is empty, and the items have no keys");
  }
  const firstColumn = columnLetter(table.startColumn);
  const sheet = quoteSheet(title);
  const headerUpdate: ValueRange[] = changed
    ? [{ range: `${sheet}!${firstColumn}${config.headerRow}`, values: [headers] }]
    : [];
  const appendAt = `${sheet}!${firstColumn}${config.headerRow}`;

  const appendRows = async (rows: Cell[][]) =>
    rows.length === 0
      ? undefined
      : appendedFrom(await call(appendValuesRequest(id, appendAt, rows, input)));

  if (operation === "append") {
    if (headerUpdate.length > 0) await call(updateValuesRequest(id, headerUpdate, input));
    const first = await appendRows(items.map((item) => rowCells(item, headers)));
    return items.map((item, n) => ({
      ...item,
      row_number: first === undefined ? undefined : first + n,
    }));
  }

  const plan = planWrite(table, headers, items, {
    matchColumn: need(config.matchColumn, "matchColumn", operation),
    mode: operation === "update" ? "update" : "appendOrUpdate",
    sheetTitle: title,
  });
  const updates = [...headerUpdate, ...plan.updates];
  if (updates.length > 0) await call(updateValuesRequest(id, updates, input));
  const first = await appendRows(plan.appends);
  return items.map((item, n) => {
    const target = plan.targets[n];
    const rowNumber =
      target === undefined
        ? undefined
        : "rowNumber" in target
          ? target.rowNumber
          : first === undefined
            ? undefined
            : first + target.append;
    return { ...item, row_number: rowNumber };
  });
}

async function runSheet(
  call: Call,
  config: SheetsConfig,
  input: unknown,
  scope: Record<string, unknown>,
): Promise<unknown> {
  const { operation } = config;
  const id = parseSpreadsheetId(config.spreadsheetId);

  if (operation === "create") {
    const answer = await call(addTabRequest(id, need(config.title, "title", operation).trim()));
    const replies = (answer as { replies?: { addSheet?: { properties?: unknown } }[] } | null)
      ?.replies;
    return replies?.[0]?.addSheet?.properties ?? answer;
  }

  const tab = async () =>
    pickTab(tabsOf(await call(listTabsRequest(id))), config.sheetName, gidOf(config.spreadsheetId));
  const title = config.sheetName?.trim() || (await tab()).title;

  switch (operation) {
    case "getRows": {
      const answer = await call(
        readValuesRequest(
          id,
          a1Range(title, config.range),
          config.valueRenderOption,
          config.dateTimeRenderOption,
        ),
      );
      if (config.useHeaderRow) {
        const filter = config.lookupColumn
          ? { column: config.lookupColumn, value: config.lookupValue ?? "" }
          : undefined;
        return tableObjects(toTable(answer, config.headerRow), filter);
      }
      const { range, values } = (answer ?? {}) as { range?: string; values?: unknown[][] };
      const start = rangeStart(range).row;
      return (values ?? []).map((cells, n) => ({ row_number: start + n, values: cells }));
    }
    case "clear":
      return await call(clearValuesRequest(id, a1Range(title, config.range)));
    case "deleteRows": {
      const { sheetId } = await tab();
      const startRow = need(config.startRow, "startRow", operation);
      await call(deleteRowsRequest(id, sheetId, startRow, config.numberOfRows));
      return { success: true, startRow, numberOfRows: config.numberOfRows };
    }
    case "delete": {
      const found = await tab();
      await call(deleteTabRequest(id, found.sheetId));
      return { success: true, ...found };
    }
    case "append":
    case "update":
    case "appendOrUpdate": {
      const items = rowsOf(config, input, scope);
      if (items.length === 0) return [];
      return await writeRows(call, config, id, title, items);
    }
  }
  throw new Error(`"${operation}" is not an operation of "sheet"`);
}

export default defineNode({
  type: "google_sheets.api",
  label: "Google Sheets",
  description: "Read, append, and update rows in Google Sheets",
  category: "integration",
  app: "Google Sheets",
  // The names of the actions of the Google Sheets node.
  actions: [
    { label: "Create a spreadsheet", config: { resource: "spreadsheet", operation: "create" } },
    { label: "Get a spreadsheet", config: { resource: "spreadsheet", operation: "get" } },
    { label: "Get rows in a sheet", config: { resource: "sheet", operation: "getRows" } },
    { label: "Append rows to a sheet", config: { resource: "sheet", operation: "append" } },
    { label: "Update rows in a sheet", config: { resource: "sheet", operation: "update" } },
    {
      label: "Append or update rows in a sheet",
      config: { resource: "sheet", operation: "appendOrUpdate" },
    },
    { label: "Clear a sheet", config: { resource: "sheet", operation: "clear" } },
    { label: "Delete rows in a sheet", config: { resource: "sheet", operation: "deleteRows" } },
    { label: "Create a tab", config: { resource: "sheet", operation: "create" } },
    { label: "Delete a tab", config: { resource: "sheet", operation: "delete" } },
  ],
  icon: "Sheet",
  iconUrl: SHEETS_ICON,
  config: sheetsConfig,
  defaultConfig: {
    authentication: "oAuth2",
    resource: "sheet",
    operation: "getRows",
    spreadsheetId: "",
    useHeaderRow: true,
    headerRow: 1,
    dataMode: "autoMapInputData",
    addNewColumns: false,
    valueInputOption: "USER_ENTERED",
    valueRenderOption: "FORMATTED_VALUE",
    dateTimeRenderOption: "FORMATTED_STRING",
    numberOfRows: 1,
    timeoutMs: 30_000,
  },
  credentialTypes: [SHEETS_OAUTH2_CREDENTIAL, SHEETS_SERVICE_ACCOUNT_CREDENTIAL],
  // The Authentication field says which credential type the user picks.
  credentialRules: {
    [SHEETS_OAUTH2_CREDENTIAL]: { showWhen: { authentication: ["oAuth2"] } },
    [SHEETS_SERVICE_ACCOUNT_CREDENTIAL]: { showWhen: { authentication: ["serviceAccount"] } },
  },
  rawConfigKeys: ["columns"],
  ports: { in: ["in"], out: ["out"] },
  subtitle: (config) =>
    typeof config.operation === "string"
      ? `${String(config.resource ?? "sheet")}: ${config.operation}`
      : undefined,
  async run({ config, input, credential, scope, signal }) {
    const options: CallOptions = { signal, timeoutMs: config.timeoutMs };
    const token = await sheetsToken(credential, options);
    const call: Call = (request) => callSheets(token, request, options);

    if (config.resource === "spreadsheet") {
      if (config.operation === "create") {
        return {
          port: "out",
          data: await call(createSpreadsheetRequest(config.title, config.sheetTitles)),
        };
      }
      const id = parseSpreadsheetId(config.spreadsheetId);
      return { port: "out", data: await call(getSpreadsheetRequest(id)) };
    }
    return { port: "out", data: await runSheet(call, config, input, scope) };
  },
});
