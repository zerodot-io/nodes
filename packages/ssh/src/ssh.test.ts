// SPDX-License-Identifier: AGPL-3.0-only
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { credentialTypes, nodes } from "./index";
import { type RemoteFs, runRemoteOperation } from "./remote-files";
import { sshOptions } from "./ssh";

describe("FTP and SFTP operations", () => {
  const calls: string[] = [];
  const fs: RemoteFs = {
    async list(path, recursive) {
      calls.push(`list ${path} ${recursive}`);
      return [{ name: "a", path: `${path}/a`, type: "file", size: 1, modifiedAt: null }];
    },
    async download(path) {
      calls.push(`download ${path}`);
      return Buffer.from("body");
    },
    async upload(path, bytes) {
      calls.push(`upload ${path} ${bytes.length}`);
    },
    async remove(path, folder, recursive) {
      calls.push(`remove ${path} ${folder} ${recursive}`);
    },
    async rename(from, to) {
      calls.push(`rename ${from} ${to}`);
    },
    async close() {},
  };
  const base = {
    operation: "list",
    path: "/",
    property: "data",
    recursive: false,
    folder: false,
  } as const;
  const input = {
    binary: { data: { data: Buffer.from("xyz").toString("base64"), fileName: "f.txt" } },
  };

  it("lists, downloads, uploads, renames, and deletes", async () => {
    const listed = (await runRemoteOperation(fs, { ...base, path: "/d", recursive: true }, {})) as {
      items: unknown[];
    };
    assert.equal(listed.items.length, 1);
    const down = (await runRemoteOperation(
      fs,
      { ...base, operation: "download", path: "/d/a.txt" },
      {},
    )) as {
      binary: { data: { data: string; fileName: string } };
    };
    assert.equal(Buffer.from(down.binary.data.data, "base64").toString(), "body");
    assert.equal(down.binary.data.fileName, "a.txt");
    // A path with / at the end is a folder. The file keeps its name.
    assert.deepEqual(
      await runRemoteOperation(fs, { ...base, operation: "upload", path: "/in/" }, input),
      {
        path: "/in/f.txt",
        size: 3,
      },
    );
    await runRemoteOperation(fs, { ...base, operation: "rename", path: "/a", newPath: "/b" }, {});
    await runRemoteOperation(
      fs,
      { ...base, operation: "delete", path: "/b", folder: true, recursive: true },
      {},
    );
    assert.deepEqual(calls, [
      "list /d true",
      "download /d/a.txt",
      "upload /in/f.txt 3",
      "rename /a /b",
      "remove /b true true",
    ]);
    await assert.rejects(
      runRemoteOperation(fs, { ...base, operation: "rename", path: "/a" }, {}),
      /new path/,
    );
  });
});

describe("SSH credential", () => {
  it("builds the connection settings", () => {
    const password = sshOptions({ type: "ssh", data: { host: "h", username: "u", password: "p" } });
    assert.equal(password.port, 22);
    assert.equal(password.password, "p");
    const key = sshOptions({
      type: "ssh",
      data: {
        host: "h",
        port: "2222",
        username: "u",
        authType: "privateKey",
        privateKey: "K",
        passphrase: "x",
      },
    });
    assert.equal(key.port, 2222);
    assert.equal(key.privateKey, "K");
    assert.equal(key.passphrase, "x");
    assert.throws(
      () => sshOptions({ type: "ssh", data: { host: "h", username: "u", authType: "privateKey" } }),
      /privateKey/,
    );
    const check = (type: string, data: unknown) =>
      credentialTypes
        .find((entry) => entry.type === type)
        ?.fields.strict()
        .safeParse(data).success;
    assert.equal(check("ssh", { host: "h", username: "u" }), true);
    assert.equal(check("ftp", { host: "h" }), true);
    assert.equal(check("ssh", { host: "h" }), false);
  });
});

describe("ssh package", () => {
  it("has the SSH, FTP and SFTP nodes", () => {
    assert.deepEqual(nodes.map((node) => node.type).sort(), [
      "ftp.files",
      "sftp.files",
      "ssh.execute",
    ]);
    assert.deepEqual(credentialTypes.map((entry) => entry.type).sort(), ["ftp", "ssh"]);
  });
});
