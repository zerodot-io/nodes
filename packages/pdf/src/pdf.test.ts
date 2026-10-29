// SPDX-License-Identifier: AGPL-3.0-only
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { PDFDocument, StandardFonts } from "@cantoo/pdf-lib";
import type { NodeResult } from "@zerodot/node-sdk";
import { nodes } from "./index";
import { parsePages } from "./pages";

const node = nodes.find((entry) => entry.type === "file.pdf");

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

async function makePdf(pages: number, label = "Page") {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 1; i <= pages; i++) {
    doc.addPage().drawText(`${label} ${i}`, { x: 50, y: 700, size: 24, font });
  }
  return Buffer.from(await doc.save()).toString("base64");
}

const file = (data: string, fileName = "a.pdf") => ({
  data,
  mimeType: "application/pdf",
  fileName,
});

type Binary = Record<string, { data: string; fileName: string; mimeType: string }>;
const pageCount = async (data: string) =>
  (await PDFDocument.load(Buffer.from(data, "base64"))).getPageCount();

describe("parsePages", () => {
  it("reads ranges", () => {
    assert.deepEqual(parsePages("1-3, 5", 6), [0, 1, 2, 4]);
    assert.deepEqual(parsePages("4-", 6), [3, 4, 5]);
    assert.deepEqual(parsePages("-2", 6), [0, 1]);
  });
  it("refuses bad ranges", () => {
    assert.throws(() => parsePages("7", 6), /outside the file/);
    assert.throws(() => parsePages("3-1", 6), /outside the file/);
    assert.throws(() => parsePages("x", 6), /not a page range/);
    assert.throws(() => parsePages(" ", 6), /Add the pages/);
  });
});

describe("PDF", () => {
  it("gives the page count", async () => {
    const input = { binary: { data: file(await makePdf(3)) } };
    const out = (await run({ operation: "info" }, input)).data as { pages: number };
    assert.equal(out.pages, 3);
  });

  it("extracts text", async () => {
    const input = { binary: { data: file(await makePdf(2)) } };
    const out = (await run({ operation: "text" }, input)).data as {
      text: string;
      pages: string[];
      totalPages: number;
    };
    assert.equal(out.totalPages, 2);
    assert.match(out.pages[0] ?? "", /Page 1/);
    assert.match(out.text, /Page 2/);
  });

  it("merges files in order", async () => {
    const input = {
      binary: { a: file(await makePdf(2)), b: file(await makePdf(3)) },
    };
    const res = await run({ operation: "merge", properties: "a, b" }, input);
    const binary = (res.data as { binary: Binary }).binary;
    assert.equal(await pageCount(binary.data?.data ?? ""), 5);
    await assert.rejects(run({ operation: "merge", properties: "a" }, input), /at least two/);
  });

  it("picks pages", async () => {
    const input = { binary: { data: file(await makePdf(5)) } };
    const res = await run({ operation: "pages", pages: "2-3, 5" }, input);
    const binary = (res.data as { binary: Binary }).binary;
    assert.equal(await pageCount(binary.data?.data ?? ""), 3);
    assert.equal(binary.data?.fileName, "a.pdf");
    await assert.rejects(run({ operation: "pages", pages: "9" }, input), /outside the file/);
  });

  it("splits a file", async () => {
    const input = { binary: { data: file(await makePdf(5)) } };
    const res = await run({ operation: "split", pagesPerFile: 2 }, input);
    const out = res.data as { binary: Binary; files: number };
    assert.equal(out.files, 3);
    assert.equal(await pageCount(out.binary.data_3?.data ?? ""), 1);
    assert.equal(out.binary.data_1?.fileName, "a-1.pdf");
  });

  it("rotates pages", async () => {
    const input = { binary: { data: file(await makePdf(2)) } };
    const res = await run({ operation: "rotate", pages: "1", degrees: "90" }, input);
    const binary = (res.data as { binary: Binary }).binary;
    const doc = await PDFDocument.load(Buffer.from(binary.data?.data ?? "", "base64"));
    assert.equal(doc.getPage(0).getRotation().angle, 90);
    assert.equal(doc.getPage(1).getRotation().angle, 0);
  });

  it("adds a password, reads with it, and removes it", async () => {
    const input = { binary: { data: file(await makePdf(2)) } };
    const locked = (
      (await run({ operation: "protect", newPassword: "s3cret" }, input)).data as {
        binary: Binary;
      }
    ).binary;
    const lockedInput = { binary: { data: file(locked.data?.data ?? "") } };
    await assert.rejects(run({ operation: "info" }, lockedInput), /needs a password/);
    await assert.rejects(
      run({ operation: "info", password: "wrong" }, lockedInput),
      /needs a password/,
    );
    await assert.rejects(run({ operation: "text" }, lockedInput), /needs a password/);
    const text = (await run({ operation: "text", password: "s3cret" }, lockedInput)).data as {
      text: string;
    };
    assert.match(text.text, /Page 1/);
    const open = (
      (await run({ operation: "unlock", password: "s3cret" }, lockedInput)).data as {
        binary: Binary;
      }
    ).binary;
    assert.equal(await pageCount(open.data?.data ?? ""), 2);
    const plain = { binary: { data: file(open.data?.data ?? "") } };
    assert.equal(((await run({ operation: "info" }, plain)).data as { pages: number }).pages, 2);
    await assert.rejects(run({ operation: "protect" }, input), /Add a new password/);
  });

  it("sets the information", async () => {
    const input = { binary: { data: file(await makePdf(1)) } };
    const res = await run(
      { operation: "metadata", title: "Report", author: "MC", keywords: "a, b" },
      input,
    );
    const next = { binary: (res.data as { binary: Binary }).binary };
    const out = (await run({ operation: "info" }, next)).data as {
      title: string;
      author: string;
    };
    assert.equal(out.title, "Report");
    assert.equal(out.author, "MC");
  });

  it("adds a watermark and page numbers", async () => {
    const input = { binary: { data: file(await makePdf(2)) } };
    const marked = await run({ operation: "watermark", text: "DRAFT", pages: "1" }, input);
    const numbered = await run(
      { operation: "numbers" },
      { binary: (marked.data as { binary: Binary }).binary },
    );
    const text = (
      await run({ operation: "text" }, { binary: (numbered.data as { binary: Binary }).binary })
    ).data as { pages: string[] };
    assert.match(text.pages[0] ?? "", /DRAFT/);
    assert.match(text.pages[0] ?? "", /1 \/ 2/);
    assert.match(text.pages[1] ?? "", /2 \/ 2/);
    assert.doesNotMatch(text.pages[1] ?? "", /DRAFT/);
    await assert.rejects(run({ operation: "watermark" }, input), /text of the watermark/);
  });

  it("creates a PDF from text", async () => {
    const content = Array.from({ length: 120 }, (_, i) => `Line ${i + 1}`).join("\n");
    const result = await run({ operation: "create", title: "Report", author: "MC", content }, {});
    const { binary } = result.data as { binary: Binary };
    const data = binary.data?.data ?? "";
    assert.ok((await pageCount(data)) > 1);
    const doc = await PDFDocument.load(Buffer.from(data, "base64"));
    assert.equal(doc.getTitle(), "Report");
    assert.equal(doc.getAuthor(), "MC");
    const read = (await run({ operation: "text" }, { binary })).data as { text: string };
    assert.match(read.text, /Report/);
    assert.match(read.text, /Line 120/);
  });

  it("creates a PDF from text with long words and unknown characters", async () => {
    const content = `${"x".repeat(400)}\n\n日本語 ok`;
    const result = await run({ operation: "create", content, pageSize: "letter" });
    const { binary } = result.data as { binary: Binary };
    assert.equal(await pageCount(binary.data?.data ?? ""), 1);
    await assert.rejects(run({ operation: "create" }), /content of the file/);
  });

  it("refuses data that is not a PDF", async () => {
    const input = { binary: { data: file(Buffer.from("not a pdf").toString("base64")) } };
    await assert.rejects(run({ operation: "info" }, input), /not a PDF/);
    await assert.rejects(run({ operation: "text" }, input), /not a PDF/);
  });
});
