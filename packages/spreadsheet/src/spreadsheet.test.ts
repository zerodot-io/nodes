// SPDX-License-Identifier: AGPL-3.0-only
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { NodeResult } from "@zerodot/node-sdk";
import writeXlsxFile from "write-excel-file/node";
import { columnLetters, parseRange } from "./grid";
import { nodes } from "./index";

const node = nodes.find((entry) => entry.type === "file.spreadsheet");

async function run(config: Record<string, unknown>, input: unknown = {}): Promise<NodeResult> {
  assert.ok(node);
  return await node.run({
    config: node.config.parse(config),
    input,
    credential: null,
    signal: new AbortController().signal,
    scope: {},
    sandbox: null,
    tables: null,
  });
}

type Binary = Record<string, { data: string; fileName: string; mimeType: string }>;
type Rows = { rows: Record<string, unknown>[]; columns: string[]; count: number };

const csv = (text: string, fileName = "a.csv") => ({
  binary: {
    data: { data: Buffer.from(text).toString("base64"), mimeType: "text/csv", fileName },
  },
});

async function xlsx(sheets: { sheet: string; data: (string | number | null)[][] }[]) {
  const buffer = await writeXlsxFile(sheets).toBuffer();
  return {
    binary: {
      data: {
        data: buffer.toString("base64"),
        mimeType: "application/octet-stream",
        fileName: "a.xlsx",
      },
    },
  };
}

const fileOf = (result: NodeResult, property = "data") => {
  const binary = (result.data as { binary: Binary }).binary[property];
  assert.ok(binary);
  return binary;
};
const text = (result: NodeResult) => Buffer.from(fileOf(result).data, "base64").toString("utf8");

describe("ranges", () => {
  it("reads ranges", () => {
    assert.deepEqual(parseRange("B2:D5"), { rowStart: 1, rowEnd: 4, colStart: 1, colEnd: 3 });
    assert.deepEqual(parseRange("A:C"), { rowStart: 0, rowEnd: undefined, colStart: 0, colEnd: 2 });
    assert.equal(parseRange(" "), null);
  });
  it("refuses bad ranges", () => {
    assert.throws(() => parseRange("A1"), /not a range/);
    assert.throws(() => parseRange("D1:A1"), /ends before/);
    assert.throws(() => parseRange("A0:B2"), /count from 1/);
  });
  it("names columns", () => {
    assert.deepEqual([0, 25, 26, 27].map(columnLetters), ["A", "Z", "AA", "AB"]);
  });
});

describe("Spreadsheet File: read", () => {
  it("reads a CSV file with a header", async () => {
    const out = (await run({}, csv("name,age,ok\nAnn,30,true\nBob,007,false\n"))).data as Rows;
    assert.deepEqual(out.columns, ["name", "age", "ok"]);
    assert.deepEqual(out.rows, [
      { name: "Ann", age: 30, ok: true },
      { name: "Bob", age: "007", ok: false },
    ]);
    assert.equal(out.count, 2);
  });

  it("handles quotes, a BOM, and other delimiters", async () => {
    const input = csv('﻿a;b\n"x;1";"he said ""hi"""\n');
    const out = (await run({ delimiter: ";" }, input)).data as Rows;
    assert.deepEqual(out.rows, [{ a: "x;1", b: 'he said "hi"' }]);
  });

  it("keeps text when parsing is off", async () => {
    const out = (await run({ parseValues: false }, csv("a\n12\n"))).data as Rows;
    assert.deepEqual(out.rows, [{ a: "12" }]);
  });

  it("names the columns when there is no header", async () => {
    const out = (await run({ hasHeader: false }, csv("1,2\n3,4\n"))).data as Rows;
    assert.deepEqual(out.rows, [
      { A: 1, B: 2 },
      { A: 3, B: 4 },
    ]);
  });

  it("fixes empty and repeated header names", async () => {
    const out = (await run({}, csv("a,a,,b\n1,2,3,4\n"))).data as Rows;
    assert.deepEqual(out.columns, ["a", "a_2", "column_3", "b"]);
  });

  it("skips empty rows and limits the rows", async () => {
    const input = csv("a\n1\n\n  \n2\n3\n");
    assert.equal(((await run({}, input)).data as Rows).count, 3);
    assert.equal(((await run({ skipEmpty: false }, input)).data as Rows).count, 5);
    assert.equal(((await run({ maxRows: 2 }, input)).data as Rows).count, 2);
  });

  it("reads a range", async () => {
    const input = csv("a,b,c\n1,2,3\n4,5,6\n7,8,9\n");
    const out = (await run({ range: "B1:C3" }, input)).data as Rows;
    assert.deepEqual(out.rows, [
      { b: 2, c: 3 },
      { b: 5, c: 6 },
    ]);
    const bare = (await run({ range: "B2:C3", hasHeader: false }, input)).data as Rows;
    assert.deepEqual(bare.rows[0], { B: 2, C: 3 });
  });

  it("reads an XLSX file and a named sheet", async () => {
    const input = await xlsx([
      { sheet: "One", data: [["x"], [1]] },
      {
        sheet: "Two",
        data: [
          ["name", "qty"],
          ["pen", 3],
          [null, null],
          ["ink", 5],
        ],
      },
    ]);
    const first = (await run({}, input)).data as Rows;
    assert.deepEqual(first.rows, [{ x: 1 }]);
    const second = (await run({ sheet: "Two" }, input)).data as Rows;
    assert.deepEqual(second.rows, [
      { name: "pen", qty: 3 },
      { name: "ink", qty: 5 },
    ]);
    await assert.rejects(run({ sheet: "Nope" }, input), /no sheet "Nope".*One, Two/);
  });

  it("detects XLSX with no file name", async () => {
    const input = await xlsx([{ sheet: "S", data: [["a"], [1]] }]);
    input.binary.data.fileName = "";
    const out = (await run({}, input)).data as Rows;
    assert.deepEqual(out.rows, [{ a: 1 }]);
  });

  it("refuses bad input", async () => {
    await assert.rejects(run({}, {}), /no binary data/);
    await assert.rejects(run({}, csv("")), /empty/);
    await assert.rejects(run({}, csv("a,b", "old.xls")), /XLS format/);
    await assert.rejects(run({ format: "xlsx" }, csv("a,b\n1,2")), /not an XLSX/);
  });
});

describe("Spreadsheet File: write", () => {
  const items = [
    { name: "Ann", age: 30, tags: ["a", "b"] },
    { name: "Bob, Jr.", age: null, extra: true },
  ];

  it("writes CSV from items", async () => {
    const result = await run({ operation: "write" }, items);
    assert.equal(fileOf(result).fileName, "data.csv");
    assert.equal(fileOf(result).mimeType, "text/csv");
    assert.equal(text(result), 'name,age,tags,extra\nAnn,30,"[""a"",""b""]",\n"Bob, Jr.",,,true\n');
  });

  it("orders the columns, and can skip the header and change the delimiter", async () => {
    const result = await run(
      { operation: "write", columns: "age, name", writeHeader: false, delimiter: ";" },
      items,
    );
    assert.equal(text(result), "30;Ann\n;Bob, Jr.\n");
  });

  it("takes the rows from a field and drops binary", async () => {
    const input = { rows: [{ a: 1, binary: {} }], other: 1 };
    const result = await run({ operation: "write", rowsProperty: "rows", fileName: "out" }, input);
    assert.equal(fileOf(result).fileName, "out.csv");
    assert.equal(text(result), "a\n1\n");
    await assert.rejects(run({ operation: "write", rowsProperty: "x" }, input), /no list of rows/);
  });

  it("writes XLSX that reads back", async () => {
    const written = await run(
      { operation: "write", outputFormat: "xlsx", sheet: "People" },
      items.slice(0, 1),
    );
    assert.equal(fileOf(written).fileName, "data.xlsx");
    const back = (await run({ sheet: "People" }, { binary: { data: fileOf(written) } }))
      .data as Rows;
    assert.deepEqual(back.rows, [{ name: "Ann", age: 30, tags: '["a","b"]' }]);
  });

  it("refuses bad input", async () => {
    await assert.rejects(run({ operation: "write" }, []), /no rows/);
    await assert.rejects(
      run({ operation: "write", outputFormat: "xlsx", sheet: "a/b" }, items),
      /31 characters/,
    );
    await assert.rejects(run({ operation: "write" }, [{}]), /no fields/);
  });
});

describe("Spreadsheet File: convert and sheets", () => {
  it("converts CSV to XLSX and back", async () => {
    const toXlsx = await run({ operation: "convert" }, csv("a,b\n1,x\n", "t.csv"));
    assert.equal(fileOf(toXlsx).fileName, "t.xlsx");
    const middle = (await run({}, { binary: { data: fileOf(toXlsx) } })).data as Rows;
    assert.deepEqual(middle.rows, [{ a: 1, b: "x" }]);
    const toCsv = await run({ operation: "convert" }, { binary: { data: fileOf(toXlsx) } });
    assert.equal(fileOf(toCsv).fileName, "t.csv");
    assert.equal(text(toCsv), "a,b\n1,x\n");
  });

  it("converts with another delimiter", async () => {
    const out = await run(
      { operation: "convert", delimiter: ";" },
      await xlsx([
        {
          sheet: "S",
          data: [
            ["a", "b"],
            [1, 2],
          ],
        },
      ]),
    );
    assert.equal(text(out), "a;b\n1;2\n");
  });

  it("lists the sheets", async () => {
    const input = await xlsx([
      { sheet: "One", data: [["a"]] },
      { sheet: "Two", data: [["b"]] },
    ]);
    const out = (await run({ operation: "sheets" }, input)).data as {
      sheets: string[];
      count: number;
    };
    assert.deepEqual(out.sheets, ["One", "Two"]);
    assert.equal(out.count, 2);
    await assert.rejects(run({ operation: "sheets" }, csv("a\n1")), /no sheets/);
  });
});
