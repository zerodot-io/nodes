// SPDX-License-Identifier: AGPL-3.0-only
import assert from "node:assert/strict";
import { createVerify, generateKeyPairSync } from "node:crypto";
import { afterEach, beforeEach, describe, it, mock } from "node:test";
import type { NodeDefinition } from "@zerodot/node-sdk";
import {
  clearTokenCache,
  DRIVE_SCOPE,
  driveError,
  multipartBody,
  parseServiceAccountKey,
  serviceAccountToken,
  signJwt,
  TOKEN_URL,
} from "./api";
import { driveConfig } from "./config";
import { credentialTypes, nodes } from "./index";
import {
  buildQuery,
  exportName,
  filesOf,
  parseFileId,
  parseParentId,
  quoteQ,
  shareRequest,
} from "./request";
import { itemKey, triggerFilter } from "./trigger";

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
const oauth: Cred = { type: "google_drive.oauth2", data: { accessToken: "ya29.secret" } };
const ID = "1AbC-d_E";

type Call = { url: string; init: RequestInit };
type Answer = { body?: unknown; status?: number; bytes?: Uint8Array };

/** Answers the calls in order. */
function mockFetch(answers: Answer[], calls: Call[] = []) {
  mock.method(globalThis, "fetch", async (url: URL | string, init: RequestInit) => {
    calls.push({ url: String(url), init });
    const answer = answers[calls.length - 1] ?? {};
    const body =
      answer.status === 204
        ? null
        : answer.bytes
          ? new Uint8Array(answer.bytes)
          : JSON.stringify(answer.body ?? {});
    return new Response(body, { status: answer.status ?? 200 });
  });
  return calls;
}

const bodyOf = (call: Call | undefined): Record<string, unknown> =>
  JSON.parse(String(call?.init.body));

const find = (type: string): NodeDefinition => {
  const found = nodes.find((entry) => entry.type === type);
  if (!found) throw new Error(`no node ${type}`);
  return found;
};

const run = async (config: Record<string, unknown>, input: unknown = null, credential = oauth) => {
  const definition = find("google_drive.api");
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

const authOf = (call: Call | undefined) =>
  (call?.init.headers as Record<string, string> | undefined)?.authorization;

const searchOf = (call: Call | undefined) => new URL(call?.url ?? "").searchParams;

beforeEach(() => clearTokenCache());
afterEach(() => mock.restoreAll());

const decode = (part: string | undefined) =>
  JSON.parse(Buffer.from(part ?? "", "base64url").toString("utf8"));

describe("service account", () => {
  it("signs an RS256 JWT with the Drive scope", () => {
    const jwt = signJwt(KEY, 1_700_000_000_000);
    const [header, claims, signature] = jwt.split(".");
    assert.deepEqual(decode(header), { alg: "RS256", typ: "JWT", kid: "k1" });
    assert.deepEqual(decode(claims), {
      iss: KEY.client_email,
      scope: DRIVE_SCOPE,
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
  });

  it("caches the token until near its end", async () => {
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
    now += 560_000;
    assert.equal(await serviceAccountToken(KEY, clock), "t2");
  });

  it("runs the node with the token of the service account", async () => {
    const calls = mockFetch([
      { body: { access_token: "sa-token", expires_in: 3600 } },
      { body: { files: [] } },
    ]);
    await run({ authentication: "serviceAccount", resource: "file", operation: "list" }, null, {
      type: "google_drive.service_account",
      data: { serviceAccountKey: KEY_JSON },
    });
    assert.equal(calls.length, 2);
    assert.equal(authOf(calls[1]), "Bearer sa-token");
  });
});

describe("IDs and queries", () => {
  it("reads the ID from a URL or a bare ID", () => {
    assert.equal(parseFileId(`https://drive.google.com/file/d/${ID}/view?usp=sharing`), ID);
    assert.equal(parseFileId(`https://drive.google.com/drive/folders/${ID}`), ID);
    assert.equal(parseFileId(`https://drive.google.com/open?id=${ID}`), ID);
    assert.equal(parseFileId(ID), ID);
    assert.throws(() => parseFileId(""), /"fileId" is needed/);
    assert.throws(() => parseFileId("a b/c"), /not a file URL or ID/);
    assert.equal(parseParentId("  "), undefined);
  });

  it("quotes text for the q parameter", () => {
    assert.equal(quoteQ("it's a \\ test"), "'it\\'s a \\\\ test'");
  });

  it("joins the filters and skips the trash by default", () => {
    assert.equal(buildQuery({}), "trashed = false");
    assert.equal(
      buildQuery({
        query: "starred = true",
        parentId: "F1",
        nameContains: "report",
        mimeType: "application/pdf",
      }),
      "(starred = true) and 'F1' in parents and name contains 'report' and mimeType = 'application/pdf' and trashed = false",
    );
    assert.equal(buildQuery({ includeTrashed: true }), undefined);
  });

  it("names an exported file with the extension", () => {
    assert.equal(exportName("Plan", "application/pdf"), "Plan.pdf");
    assert.equal(exportName("Plan.pdf", "application/pdf"), "Plan.pdf");
    assert.equal(exportName("Plan", "application/x-unknown"), "Plan");
  });

  it("reads files and the next page from a list answer", () => {
    assert.deepEqual(filesOf({ files: [{ id: "a" }, 3], nextPageToken: "n" }), {
      files: [{ id: "a" }],
      next: "n",
    });
    assert.deepEqual(filesOf(null), { files: [], next: undefined });
  });

  it("gives a clear error with the hint", () => {
    const error = driveError(
      403,
      { error: { message: "Forbidden", status: "PERMISSION_DENIED" } },
      "list the files",
    );
    assert.match(error.message, /could not list the files \(403 PERMISSION_DENIED\): Forbidden/);
    assert.match(error.message, /Share the file or folder/);
  });
});

describe("config", () => {
  it("checks that the operation belongs to the resource", () => {
    assert.equal(
      driveConfig.safeParse({ resource: "folder", operation: "download" }).success,
      false,
    );
    assert.equal(driveConfig.safeParse({ resource: "folder", operation: "create" }).success, true);
  });

  it("has credential types for both ways", () => {
    assert.deepEqual(
      credentialTypes.map((entry) => entry.type),
      ["google_drive.oauth2", "google_drive.service_account"],
    );
  });
});

describe("file operations", () => {
  it("lists files with the filters and the pages", async () => {
    const calls = mockFetch([
      { body: { files: [{ id: "a" }, { id: "b" }], nextPageToken: "p2" } },
      { body: { files: [{ id: "c" }] } },
    ]);
    const out = await run({
      operation: "list",
      parentId: "F1",
      nameContains: "inv",
      returnAll: true,
    });
    assert.deepEqual(out, { port: "out", data: [{ id: "a" }, { id: "b" }, { id: "c" }] });
    assert.equal(calls.length, 2);
    const first = searchOf(calls[0]);
    assert.equal(first.get("q"), "'F1' in parents and name contains 'inv' and trashed = false");
    assert.equal(first.get("supportsAllDrives"), "true");
    assert.equal(first.get("includeItemsFromAllDrives"), "true");
    assert.equal(searchOf(calls[1]).get("pageToken"), "p2");
    assert.equal(authOf(calls[0]), "Bearer ya29.secret");
  });

  it("stops a list at the limit", async () => {
    mockFetch([{ body: { files: [{ id: "a" }, { id: "b" }, { id: "c" }], nextPageToken: "x" } }]);
    const out = (await run({ operation: "list", limit: 2 })) as { data: unknown[] };
    assert.equal(out.data.length, 2);
  });

  it("gets a file by URL", async () => {
    const calls = mockFetch([{ body: { id: ID, name: "a.txt" } }]);
    const out = await run({
      operation: "get",
      fileId: `https://drive.google.com/file/d/${ID}/view`,
    });
    assert.deepEqual(out, { port: "out", data: { id: ID, name: "a.txt" } });
    assert.match(calls[0]?.url ?? "", new RegExp(`/drive/v3/files/${ID}\\?`));
  });

  it("downloads a binary file as binary data", async () => {
    const calls = mockFetch([
      { body: { id: ID, name: "a.txt", mimeType: "text/plain" } },
      { bytes: new TextEncoder().encode("hello") },
    ]);
    const out = (await run({ operation: "download", fileId: ID, binaryPropertyName: "file" })) as {
      data: { binary: { file: { data: string; mimeType: string; fileName: string } } };
    };
    assert.equal(searchOf(calls[1]).get("alt"), "media");
    const binary = out.data.binary.file;
    assert.equal(Buffer.from(binary.data, "base64").toString(), "hello");
    assert.equal(binary.mimeType, "text/plain");
    assert.equal(binary.fileName, "a.txt");
  });

  it("exports a Google Docs file as PDF", async () => {
    const calls = mockFetch([
      { body: { id: ID, name: "Plan", mimeType: "application/vnd.google-apps.document" } },
      { bytes: new TextEncoder().encode("%PDF") },
    ]);
    const out = (await run({ operation: "download", fileId: ID })) as {
      data: { binary: { data: { mimeType: string; fileName: string } } };
    };
    assert.match(calls[1]?.url ?? "", /\/files\/1AbC-d_E\/export\?mimeType=application%2Fpdf/);
    assert.equal(out.data.binary.data.fileName, "Plan.pdf");
  });

  it("does not download a folder", async () => {
    mockFetch([{ body: { id: ID, name: "F", mimeType: "application/vnd.google-apps.folder" } }]);
    await assert.rejects(run({ operation: "download", fileId: ID }), /A folder has no content/);
  });

  it("uploads binary data with a multipart body", async () => {
    const calls = mockFetch([{ body: { id: "new", name: "a.txt" } }]);
    const input = {
      binary: {
        data: {
          data: Buffer.from("hello").toString("base64"),
          mimeType: "text/plain",
          fileName: "a.txt",
        },
      },
    };
    const out = await run({ operation: "upload", parentId: "F1" }, input);
    assert.deepEqual(out, { port: "out", data: { id: "new", name: "a.txt" } });
    assert.match(
      calls[0]?.url ?? "",
      /^https:\/\/www\.googleapis\.com\/upload\/drive\/v3\/files\?/,
    );
    assert.equal(searchOf(calls[0]).get("uploadType"), "multipart");
    const headers = calls[0]?.init.headers as Record<string, string>;
    assert.match(headers["content-type"] ?? "", /^multipart\/related; boundary=/);
    const text = Buffer.from(calls[0]?.init.body as Uint8Array).toString();
    assert.match(text, /"name":"a\.txt","parents":\["F1"\]/);
    assert.match(text, /content-type: text\/plain\r\n\r\nhello\r\n--/);
  });

  it("needs the binary data to upload", async () => {
    mockFetch([]);
    await assert.rejects(run({ operation: "upload" }, {}));
  });

  it("creates a file from text", async () => {
    const calls = mockFetch([{ body: { id: "n" } }]);
    await run({ operation: "createFromText", name: "n.txt", content: "Hi" });
    const text = Buffer.from(calls[0]?.init.body as Uint8Array).toString();
    assert.match(text, /"name":"n\.txt"/);
    assert.match(text, /text\/plain\r\n\r\nHi\r\n/);
    await assert.rejects(run({ operation: "createFromText", content: "x" }), /"name" is needed/);
  });

  it("builds the multipart body", () => {
    const body = multipartBody(
      { name: "x" },
      { bytes: new Uint8Array([65]), mimeType: "text/plain" },
    );
    assert.match(
      body.toString(),
      /^--zerodot-drive-upload\r\n.*"name":"x".*\r\n\r\nA\r\n--zerodot-drive-upload--$/s,
    );
  });

  it("copies a file with a new name and folder", async () => {
    const calls = mockFetch([{ body: { id: "copy" } }]);
    await run({ operation: "copy", fileId: ID, name: "Copy", parentId: "F2" });
    assert.equal(calls[0]?.init.method, "POST");
    assert.match(calls[0]?.url ?? "", /\/files\/1AbC-d_E\/copy\?/);
    assert.deepEqual(bodyOf(calls[0]), { name: "Copy", parents: ["F2"] });
  });

  it("moves a file: adds the new parent and removes the old ones", async () => {
    const calls = mockFetch([{ body: { parents: ["P1", "P2"] } }, { body: { id: ID } }]);
    await run({ operation: "move", fileId: ID, parentId: "F2" });
    assert.equal(calls[1]?.init.method, "PATCH");
    assert.equal(searchOf(calls[1]).get("addParents"), "F2");
    assert.equal(searchOf(calls[1]).get("removeParents"), "P1,P2");
    await assert.rejects(run({ operation: "move", fileId: ID }), /"parentId" is needed/);
  });

  it("updates the name, and needs a change", async () => {
    const calls = mockFetch([{ body: { id: ID } }]);
    await run({ operation: "update", fileId: ID, name: "New" });
    assert.deepEqual(bodyOf(calls[0]), { name: "New" });
    await assert.rejects(run({ operation: "update", fileId: ID }), /"name" or "description"/);
  });

  it("moves to the trash, or deletes for good", async () => {
    const calls = mockFetch([{ body: { id: ID } }, { status: 204 }]);
    const trashed = await run({ operation: "delete", fileId: ID });
    assert.deepEqual(bodyOf(calls[0]), { trashed: true });
    assert.deepEqual(trashed, {
      port: "out",
      data: { success: true, id: ID, trashed: true, deleted: false },
    });
    const gone = await run({ operation: "delete", fileId: ID, permanently: true });
    assert.equal(calls[1]?.init.method, "DELETE");
    assert.deepEqual(gone, {
      port: "out",
      data: { success: true, id: ID, trashed: false, deleted: true },
    });
  });

  it("shows the error of Google without the token", async () => {
    mockFetch([
      { status: 404, body: { error: { message: "File not found", status: "NOT_FOUND" } } },
    ]);
    await assert.rejects(run({ operation: "get", fileId: ID }), (error: Error) => {
      assert.match(error.message, /could not get the file \(404 NOT_FOUND\): File not found/);
      assert.doesNotMatch(error.message, /ya29/);
      return true;
    });
  });

  it("needs a credential", async () => {
    await assert.rejects(
      run({ operation: "list" }, null, null as never),
      /needs a Google Drive credential/,
    );
  });
});

describe("folder and permission operations", () => {
  it("creates a folder in a parent folder", async () => {
    const calls = mockFetch([{ body: { id: "fo" } }]);
    await run({ resource: "folder", operation: "create", name: "Docs", parentId: "F1" });
    assert.deepEqual(bodyOf(calls[0]), {
      name: "Docs",
      mimeType: "application/vnd.google-apps.folder",
      parents: ["F1"],
    });
  });

  it("shares with a user", async () => {
    const calls = mockFetch([{ body: { id: "perm" } }]);
    await run({
      operation: "share",
      fileId: ID,
      role: "writer",
      shareType: "user",
      emailAddress: "ann@example.com",
      message: "Hi",
    });
    assert.match(calls[0]?.url ?? "", /\/files\/1AbC-d_E\/permissions\?/);
    assert.deepEqual(bodyOf(calls[0]), {
      role: "writer",
      type: "user",
      emailAddress: "ann@example.com",
    });
    assert.equal(searchOf(calls[0]).get("sendNotificationEmail"), "true");
    assert.equal(searchOf(calls[0]).get("emailMessage"), "Hi");
  });

  it("shares a folder with anyone, and checks the share inputs", async () => {
    const calls = mockFetch([{ body: { id: "perm" } }]);
    await run({ resource: "folder", operation: "share", fileId: ID, shareType: "anyone" });
    assert.deepEqual(bodyOf(calls[0]), { role: "reader", type: "anyone" });
    assert.equal(searchOf(calls[0]).get("sendNotificationEmail"), null);
    assert.throws(
      () => shareRequest(ID, { role: "reader", type: "user", sendNotification: true }),
      /"emailAddress" is needed/,
    );
    assert.throws(
      () => shareRequest(ID, { role: "reader", type: "domain", sendNotification: true }),
      /"domain" is needed/,
    );
  });

  it("lists and removes permissions", async () => {
    const calls = mockFetch([{ body: { permissions: [{ id: "p1" }] } }, { status: 204 }]);
    const list = await run({ resource: "permission", operation: "list", fileId: ID });
    assert.deepEqual(list, { port: "out", data: [{ id: "p1" }] });
    const removed = await run({
      resource: "permission",
      operation: "delete",
      fileId: ID,
      permissionId: "p1",
    });
    assert.match(calls[1]?.url ?? "", /\/files\/1AbC-d_E\/permissions\/p1\?/);
    assert.deepEqual(removed, {
      port: "out",
      data: { success: true, fileId: ID, permissionId: "p1" },
    });
    await assert.rejects(
      run({ resource: "permission", operation: "delete", fileId: ID }),
      /"permissionId" is needed/,
    );
  });
});

describe("trigger", () => {
  const trigger = find("trigger.google_drive");
  const poll = async (config: Record<string, unknown>, cursor: unknown, firstPoll: boolean) =>
    await trigger.poll?.({
      config: trigger.config.parse(config),
      credential: oauth,
      cursor,
      firstPoll,
      workflow: { id: "w", name: "w" },
      node: { id: "n", name: "n" },
      signal,
    } as never);

  it("passes the file on as the input", async () => {
    assert.deepEqual(await trigger.run({ input: { id: "a" } } as never), {
      port: "out",
      data: { id: "a" },
    });
  });

  it("starts at the newest file, with no runs", async () => {
    const calls = mockFetch([
      { body: { files: [{ id: "a", createdTime: "2026-10-01T00:00:00.000Z" }] } },
    ]);
    const result = await poll({}, null, true);
    assert.deepEqual(result, { items: [], cursor: "2026-10-01T00:00:00.000Z" });
    assert.equal(searchOf(calls[0]).get("orderBy"), "createdTime desc");
    assert.equal(searchOf(calls[0]).get("pageSize"), "1");
  });

  it("returns the files after the cursor, oldest first", async () => {
    const calls = mockFetch([
      {
        body: {
          files: [
            { id: "a", createdTime: "2026-10-02T00:00:00.000Z" },
            { id: "b", createdTime: "2026-10-03T00:00:00.000Z" },
          ],
        },
      },
    ]);
    const result = await poll(
      { folderId: "F1", fileTypes: "files" },
      "2026-10-01T00:00:00.000Z",
      false,
    );
    assert.deepEqual(
      result?.items.map((item) => item.key),
      ["a", "b"],
    );
    assert.equal(result?.cursor, "2026-10-03T00:00:00.000Z");
    const q = searchOf(calls[0]).get("q");
    assert.match(q ?? "", /'F1' in parents/);
    assert.match(q ?? "", /mimeType != 'application\/vnd\.google-apps\.folder'/);
    assert.match(q ?? "", /createdTime >= '2026-10-01T00:00:00\.000Z'/);
    assert.equal(searchOf(calls[0]).get("orderBy"), "createdTime asc");
  });

  it("keeps the cursor when there is nothing new", async () => {
    mockFetch([{ body: { files: [] } }]);
    const result = await poll({ event: "fileChanged" }, "2026-10-01T00:00:00.000Z", false);
    assert.deepEqual(result, { items: [], cursor: "2026-10-01T00:00:00.000Z" });
  });

  it("makes a new key for each change of a file", () => {
    const file = { id: "a", modifiedTime: "t1" };
    assert.equal(itemKey("fileCreated", file), "a");
    assert.equal(itemKey("fileChanged", file), "a:t1");
    assert.equal(
      triggerFilter({ folderId: "", fileTypes: "folders" }, null, "createdTime").query,
      "mimeType = 'application/vnd.google-apps.folder'",
    );
  });
});
