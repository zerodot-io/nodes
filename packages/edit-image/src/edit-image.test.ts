// SPDX-License-Identifier: AGPL-3.0-only
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { NodeResult } from "@zerodot/node-sdk";
import { nodes } from "./index";

const node = nodes.find((entry) => entry.type === "file.edit_image");

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

describe("Edit Image", () => {
  const png = async (width: number, height: number) => {
    const { default: sharp } = await import("sharp");
    const bytes = await sharp({
      create: { width, height, channels: 3, background: { r: 200, g: 10, b: 10 } },
    })
      .png()
      .toBuffer();
    return {
      binary: {
        data: { data: bytes.toString("base64"), mimeType: "image/png", fileName: "a.png" },
      },
    };
  };
  const info = async (data: unknown) => {
    const out = (await run({ operation: "info" }, data)).data as {
      width: number;
      height: number;
      format: string;
    };
    return { width: out.width, height: out.height, format: out.format };
  };

  it("gives the size and format", async () => {
    assert.deepEqual(await info(await png(40, 20)), {
      width: 40,
      height: 20,
      format: "png",
    });
  });

  it("resizes, crops, rotates, and converts", async () => {
    const input = await png(40, 20);
    const resized = await run({ operation: "resize", width: 20 }, input);
    assert.deepEqual(await info(resized.data), { width: 20, height: 10, format: "png" });
    const cropped = await run({ operation: "crop", left: 5, top: 5, width: 10, height: 10 }, input);
    assert.deepEqual(await info(cropped.data), { width: 10, height: 10, format: "png" });
    const rotated = await run({ operation: "rotate", degrees: 90 }, input);
    assert.deepEqual(await info(rotated.data), { width: 20, height: 40, format: "png" });
    const converted = await run({ operation: "convert", format: "jpeg" }, input);
    assert.deepEqual(await info(converted.data), { width: 40, height: 20, format: "jpeg" });
    const file = (converted.data as { binary: { data: { fileName: string; mimeType: string } } })
      .binary.data;
    assert.equal(file.fileName, "a.jpg");
    assert.equal(file.mimeType, "image/jpeg");
  });

  it("refuses bad input", async () => {
    const input = await png(40, 20);
    await assert.rejects(
      run({ operation: "crop", left: 30, width: 20, height: 10 }, input),
      /outside the image/,
    );
    await assert.rejects(run({ operation: "resize" }, input), /width or a height/);
    await assert.rejects(
      run(
        { operation: "info" },
        {
          binary: { data: { data: Buffer.from("not an image").toString("base64") } },
        },
      ),
      /not an image/,
    );
  });
});
