// SPDX-License-Identifier: AGPL-3.0-only
import assert from "node:assert/strict";
import { createVerify, generateKeyPairSync } from "node:crypto";
import { afterEach, beforeEach, describe, it, mock } from "node:test";
import type { NodeDefinition } from "@zerodot/node-sdk";
import { z } from "zod";
import {
  clearTokenCache,
  parseServiceAccountKey,
  SHEETS_SCOPE,
  serviceAccountToken,
  sheetsError,
  signJwt,
  TOKEN_URL,
} from "./api";
import { sheetsConfig } from "./config";
import { credentialTypes, nodes } from "./index";
import {
  a1Range,
  columnIndex,
  columnLetter,
  gidOf,
  parseSpreadsheetId,
  planWrite,
  rangeStart,
  tableObjects,
  toTable,
} from "./request";

const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const PEM = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
const KEY = {
  client_email: "bot@p.iam.gserviceaccount.com",
  private_key: PEM,
  private_key_id: "k1",
};
const KEY_JSON = JSON.stringify({ type: "service_account", ...KEY });

const signal = new AbortController().signal;
type Cred = { type: string; data: Record<string, unknown> };
const oauth: Cred = { type: "google_sheets.oauth2", data: { accessToken: "ya29.secret" } };
const ID = "1AbC-d_E";

type Call = { url: string; init: RequestInit };
type Answer = { body?: unknown; status?: number };

/** Answers the calls in order. */
function mockFetch(answers: Answer[], calls: Call[] = []) {
  mock.method(globalThis, "fetch", async (url: URL | string, init: RequestInit) => {
    calls.push({ url: String(url), init });
    const answer = answers[calls.length - 1] ?? {};
    return new Response(JSON.stringify(answer.body ?? {}), { status: answer.status ?? 200 });
  });
  return calls;
}

const bodyOf = (call: Call | undefined): Record<string, unknown> =>
  JSON.parse(String(call?.init.body));

const node = (): NodeDefinition => {
  const found = nodes.find((entry) => entry.type === "google_sheets.api");
  if (!found) throw new Error("no node");
  return found;
};

const run = async (config: Record<string, unknown>, input: unknown = null, credential = oauth) => {
  const definition = node();
  return await definition.run({
    config: definition.config.parse(config),
    input,
    credential,
    signal,
    scope: {},
    tables: null,
    sandbox: null,
  } as never);
};

beforeEach(() => clearTokenCache());
afterEach(() => mock.restoreAll());

const decode = (part: string | undefined) =>
  JSON.parse(Buffer.from(part ?? "", "base64url").toString("utf8"));

describe("service account", () => {
  it("signs an RS256 JWT with the right claims", () => {
    const jwt = signJwt(KEY, 1_700_000_000_000);
    const [header, claims, signature] = jwt.split(".");
    assert.deepEqual(decode(header), { alg: "RS256", typ: "JWT", kid: "k1" });
    assert.deepEqual(decode(claims), {
      iss: KEY.client_email,
      scope: SHEETS_SCOPE,
      aud: TOKEN_URL,
      iat: 1_700_000_000,
      exp: 1_700_003_600,
    });
    const valid = createVerify("RSA-SHA256")
      .update(`${header}.${claims}`)
      .verify(publicKey, Buffer.from(signature ?? "", "base64url"));
    assert.equal(valid, true);
  });

  it("rejects a key without the fields", () => {
    assert.throws(() => parseServiceAccountKey("{}"), /client_email/);
    assert.throws(() => parseServiceAccountKey("nope"), /not valid JSON/);
    assert.equal(parseServiceAccountKey(KEY_JSON).client_email, KEY.client_email);
  });

  it("exchanges the JWT and caches the token until near its end", async () => {
    const calls = mockFetch([
      { body: { access_token: "t1", expires_in: 3600 } },
      { body: { access_token: "t2", expires_in: 3600 } },
    ]);
    let now = 1_000_000;
    const clock = { now: () => now };
    assert.equal(await serviceAccountToken(KEY, clock), "t1");
    now += 3_000_000;
    assert.equal(await serviceAccountToken(KEY, clock), "t1");
    assert.equal(calls.length, 1);
    assert.equal(calls[0]?.url, TOKEN_URL);
    const form = new URLSearchParams(String(calls[0]?.init.body));
    assert.equal(form.get("grant_type"), "urn:ietf:params:oauth:grant-type:jwt-bearer");
    assert.equal(form.get("assertion")?.split(".").length, 3);
    // Less than a minute is left: a new token.
    now += 560_000;
    assert.equal(await serviceAccountToken(KEY, clock), "t2");
    assert.equal(calls.length, 2);
  });

  it("gives the error of the token endpoint", async () => {
    mockFetch([{ status: 400, body: { error: "invalid_grant", error_description: "Bad JWT" } }]);
    await assert.rejects(serviceAccountToken(KEY), /\(400\): Bad JWT/);
  });

  it("runs the node with the token of the service account", async () => {
    const calls = mockFetch([
      { body: { access_token: "sa-token", expires_in: 3600 } },
      { body: { spreadsheetId: ID } },
    ]);
    await run(
      {
        authentication: "serviceAccount",
        resource: "spreadsheet",
        operation: "get",
        spreadsheetId: ID,
      },
      null,
      { type: "google_sheets.service_account", data: { serviceAccountKey: KEY_JSON } },
    );
    const headers = calls[1]?.init.headers as Record<string, string>;
    assert.equal(headers.authorization, "Bearer sa-token");
  });
});

describe("credentials", () => {
  it("has a Google OAuth2 preset with offline access", () => {
    const oauth2 = credentialTypes[0]?.oauth2;
    assert.ok(oauth2 && typeof oauth2 === "object");
    assert.deepEqual(oauth2.scopes, [SHEETS_SCOPE]);
    assert.equal(oauth2.authQuery?.access_type, "offline");
  });

  it("checks the service account key", () => {
    const fields = credentialTypes[1]?.fields;
    assert.equal(fields?.safeParse({ serviceAccountKey: KEY_JSON }).success, true);
    assert.equal(fields?.safeParse({ serviceAccountKey: "{}" }).success, false);
  });
});

describe("helpers", () => {
  it("reads the spreadsheet ID from a URL or an ID", () => {
    const url = `https://docs.google.com/spreadsheets/d/${ID}/edit#gid=42`;
    assert.equal(parseSpreadsheetId(url), ID);
    assert.equal(parseSpreadsheetId(` ${ID} `), ID);
    assert.equal(gidOf(url), 42);
    assert.equal(gidOf(ID), undefined);
    assert.throws(() => parseSpreadsheetId("https://example.com/x y"), /not a spreadsheet/);
    assert.throws(() => parseSpreadsheetId(""), /spreadsheetId/);
  });

  it("writes A1 ranges and columns", () => {
    assert.equal(a1Range("Q1 'data'"), "'Q1 ''data'''");
    assert.equal(a1Range("Tab", "A1:C"), "'Tab'!A1:C");
    assert.equal(a1Range("Tab", "Other!B2"), "Other!B2");
    assert.equal(columnLetter(0), "A");
    assert.equal(columnLetter(27), "AB");
    assert.equal(columnLetter(columnIndex("ZZZ")), "ZZZ");
    assert.deepEqual(rangeStart("'A!b'!$C$7:F9"), { row: 7, column: 2 });
    assert.deepEqual(rangeStart("Tab!B:D"), { row: 1, column: 1 });
  });

  it("maps rows to objects by the header row", () => {
    const table = toTable(
      {
        range: "Tab!A2:C10",
        values: [["skip"], ["id", "name", ""], [1, "Ann", "x"], [], [2, "Bo"]],
      },
      3,
    );
    assert.deepEqual(tableObjects(table), [
      { row_number: 4, id: 1, name: "Ann" },
      { row_number: 6, id: 2, name: "Bo" },
    ]);
    assert.deepEqual(tableObjects(table, { column: "name", value: "Bo" }), [
      { row_number: 6, id: 2, name: "Bo" },
    ]);
    assert.throws(() => toTable({ range: "Tab!A5:B6" }, 1), /above the range/);
  });

  it("plans append-or-update per cell, and joins new rows with the same key", () => {
    const table = toTable(
      {
        range: "T!B1:D3",
        values: [
          ["id", "name", "n"],
          ["a", "Ann", 1],
        ],
      },
      1,
    );
    const plan = planWrite(
      table,
      table.headers,
      [
        { id: "a", n: 5 },
        { id: "b", name: "Bo" },
        { id: "b", n: 7 },
      ],
      { matchColumn: "id", mode: "appendOrUpdate", sheetTitle: "T" },
    );
    assert.deepEqual(plan.updates, [{ range: "'T'!D2", values: [[5]] }]);
    assert.deepEqual(plan.appends, [["b", "Bo", 7]]);
    assert.deepEqual(plan.targets, [{ rowNumber: 2 }, { append: 0 }, { append: 0 }]);
    assert.throws(
      () =>
        planWrite(table, table.headers, [{ id: "z" }], {
          matchColumn: "id",
          mode: "update",
          sheetTitle: "T",
        }),
      /No row has "id" = "z"/,
    );
  });

  it("maps Google errors", () => {
    const error = sheetsError(
      403,
      {
        error: {
          code: 403,
          message: "The caller does not have permission",
          status: "PERMISSION_DENIED",
        },
      },
      "read the rows",
    );
    assert.match(error.message, /could not read the rows \(403 PERMISSION_DENIED\): The caller/);
    assert.match(error.message, /Share the spreadsheet/);
    assert.match(sheetsError(500, null, "x").message, /\(500\): no message/);
  });
});

describe("config", () => {
  it("checks that the operation belongs to the resource", () => {
    assert.equal(
      sheetsConfig.safeParse({ resource: "spreadsheet", operation: "append" }).success,
      false,
    );
    assert.equal(sheetsConfig.safeParse({ resource: "sheet", operation: "create" }).success, true);
  });

  it("has a label and a hint for each option of each select", () => {
    for (const [name, field] of Object.entries(sheetsConfig.shape)) {
      let inner: z.ZodType = field;
      const meta = field.meta() ?? {};
      while (inner instanceof z.ZodDefault || inner instanceof z.ZodOptional) {
        inner = inner.unwrap() as z.ZodType;
      }
      if (!(inner instanceof z.ZodEnum)) continue;
      const labels = (meta.labels ?? {}) as Record<string, string>;
      const hints = (meta.hints ?? {}) as Record<string, string>;
      for (const option of inner.options) {
        assert.ok(labels[String(option)], `${name}.${String(option)} has no label`);
        assert.ok(hints[String(option)], `${name}.${String(option)} has no hint`);
      }
    }
  });
});

describe("node", () => {
  it("gets rows as objects with the render options", async () => {
    const calls = mockFetch([
      {
        body: {
          range: "'Leads'!A1:B3",
          values: [
            ["email", "age"],
            ["a@x.io", 30],
          ],
        },
      },
    ]);
    const result = await run({
      operation: "getRows",
      spreadsheetId: ID,
      sheetName: "Leads",
      valueRenderOption: "UNFORMATTED_VALUE",
      dateTimeRenderOption: "SERIAL_NUMBER",
    });
    assert.deepEqual(result, { port: "out", data: [{ row_number: 2, email: "a@x.io", age: 30 }] });
    const url = new URL(calls[0]?.url ?? "");
    assert.equal(url.pathname, `/v4/spreadsheets/${ID}/values/'Leads'`);
    assert.equal(url.searchParams.get("valueRenderOption"), "UNFORMATTED_VALUE");
    assert.equal(url.searchParams.get("dateTimeRenderOption"), "SERIAL_NUMBER");
    const headers = calls[0]?.init.headers as Record<string, string>;
    assert.equal(headers.authorization, "Bearer ya29.secret");
  });

  it("uses the tab of the gid when no tab name is set", async () => {
    const calls = mockFetch([
      {
        body: {
          sheets: [
            { properties: { sheetId: 0, title: "A" } },
            { properties: { sheetId: 9, title: "B" } },
          ],
        },
      },
      { body: { range: "B!A1", values: [] } },
    ]);
    await run({
      operation: "getRows",
      spreadsheetId: `https://docs.google.com/spreadsheets/d/${ID}/edit#gid=9`,
    });
    assert.match(calls[1]?.url ?? "", /values\/'B'/);
  });

  it("appends items in the order of the header row", async () => {
    const calls = mockFetch([
      { body: { range: "'T'!A1:C1", values: [["id", "name", "note"]] } },
      { body: { updates: { updatedRange: "'T'!A5:C6" } } },
    ]);
    const result = await run(
      { operation: "append", spreadsheetId: ID, sheetName: "T", valueInputOption: "RAW" },
      [
        { name: "Ann", id: 1, extra: "skip" },
        { id: 2, note: { a: 1 } },
      ],
    );
    assert.match(calls[0]?.url ?? "", /values\/'T'!1%3A1\?/);
    const url = new URL(calls[1]?.url ?? "");
    assert.equal(url.pathname, `/v4/spreadsheets/${ID}/values/'T'!A1:append`);
    assert.equal(url.searchParams.get("valueInputOption"), "RAW");
    assert.deepEqual(bodyOf(calls[1]).values, [
      [1, "Ann", ""],
      [2, "", '{"a":1}'],
    ]);
    assert.deepEqual(result, {
      port: "out",
      data: [
        { name: "Ann", id: 1, extra: "skip", row_number: 5 },
        { id: 2, note: { a: 1 }, row_number: 6 },
      ],
    });
  });

  it("writes the header row first when the tab is empty", async () => {
    const calls = mockFetch([
      { body: { range: "'T'!A1:Z1" } },
      { body: {} },
      { body: { updates: { updatedRange: "'T'!A2:B2" } } },
    ]);
    await run({ operation: "append", spreadsheetId: ID, sheetName: "T" }, [{ a: 1, b: 2 }]);
    assert.deepEqual(bodyOf(calls[1]).data, [{ range: "'T'!A1", values: [["a", "b"]] }]);
    assert.deepEqual(bodyOf(calls[2]).values, [[1, 2]]);
  });

  it("appends or updates by the key column", async () => {
    const calls = mockFetch([
      {
        body: {
          range: "'T'!A1:B3",
          values: [
            ["sku", "qty"],
            ["x", 1],
            ["y", 2],
          ],
        },
      },
      { body: {} },
      { body: { updates: { updatedRange: "'T'!A4:B4" } } },
    ]);
    const result = await run(
      { operation: "appendOrUpdate", spreadsheetId: ID, sheetName: "T", matchColumn: "sku" },
      [
        { sku: "y", qty: 9 },
        { sku: "z", qty: 3 },
      ],
    );
    assert.equal(
      new URL(calls[0]?.url ?? "").searchParams.get("valueRenderOption"),
      "UNFORMATTED_VALUE",
    );
    assert.match(calls[1]?.url ?? "", /values:batchUpdate$/);
    assert.deepEqual(bodyOf(calls[1]), {
      valueInputOption: "USER_ENTERED",
      data: [{ range: "'T'!B3", values: [[9]] }],
    });
    assert.deepEqual(bodyOf(calls[2]).values, [["z", 3]]);
    assert.deepEqual(result, {
      port: "out",
      data: [
        { sku: "y", qty: 9, row_number: 3 },
        { sku: "z", qty: 3, row_number: 4 },
      ],
    });
  });

  it("maps columns by hand with expressions", async () => {
    const calls = mockFetch([
      { body: { range: "'T'!A1:B1", values: [["full", "n"]] } },
      { body: { updates: { updatedRange: "'T'!A2:B2" } } },
    ]);
    await run(
      {
        operation: "append",
        spreadsheetId: ID,
        sheetName: "T",
        dataMode: "defineBelow",
        columns: { full: "{{ $item.first }} {{ $item.last }}", n: "{{ $index }}" },
      },
      [{ first: "Ann", last: "Lee" }],
    );
    const values = bodyOf(calls[1]).values as unknown[][];
    assert.equal(values[0]?.[0], "Ann Lee");
    assert.equal(String(values[0]?.[1]), "0");
  });

  it("deletes rows in the tab by its ID", async () => {
    const calls = mockFetch([
      { body: { sheets: [{ properties: { sheetId: 77, title: "T" } }] } },
      { body: { replies: [{}] } },
    ]);
    await run({
      operation: "deleteRows",
      spreadsheetId: ID,
      sheetName: "T",
      startRow: 4,
      numberOfRows: 2,
    });
    assert.match(calls[0]?.url ?? "", /fields=sheets.properties/);
    assert.deepEqual(bodyOf(calls[1]).requests, [
      {
        deleteDimension: { range: { sheetId: 77, dimension: "ROWS", startIndex: 3, endIndex: 5 } },
      },
    ]);
  });

  it("creates a spreadsheet with tabs, and a tab", async () => {
    const calls = mockFetch([
      { body: { spreadsheetId: "new" } },
      { body: { replies: [{ addSheet: { properties: { sheetId: 5, title: "Q2" } } }] } },
    ]);
    await run({ resource: "spreadsheet", operation: "create", title: "Plan", sheetTitles: "A, B" });
    assert.deepEqual(bodyOf(calls[0]), {
      properties: { title: "Plan" },
      sheets: [{ properties: { title: "A" } }, { properties: { title: "B" } }],
    });
    const tab = await run({ operation: "create", spreadsheetId: ID, title: "Q2" });
    assert.deepEqual(tab, { port: "out", data: { sheetId: 5, title: "Q2" } });
  });

  it("throws the Google error without the token", async () => {
    mockFetch([
      {
        status: 404,
        body: {
          error: { code: 404, message: "Requested entity was not found.", status: "NOT_FOUND" },
        },
      },
    ]);
    await assert.rejects(
      run({ operation: "clear", spreadsheetId: ID, sheetName: "T" }),
      (error: Error) =>
        /clear the range \(404 NOT_FOUND\): Requested entity/.test(error.message) &&
        !error.message.includes("ya29"),
    );
  });

  it("needs a credential", async () => {
    await assert.rejects(
      run({ operation: "getRows", spreadsheetId: ID }, null, { type: "other", data: {} }),
      /needs a Google Sheets credential/,
    );
  });
});
