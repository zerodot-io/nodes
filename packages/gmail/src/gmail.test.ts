// SPDX-License-Identifier: AGPL-3.0-only
import assert from "node:assert/strict";
import { createVerify, generateKeyPairSync } from "node:crypto";
import { afterEach, beforeEach, describe, it, mock } from "node:test";
import type { NodeDefinition } from "@zerodot/node-sdk";
import {
  clearTokenCache,
  GMAIL_SCOPE,
  gmailError,
  parseServiceAccountKey,
  serviceAccountToken,
  signJwt,
  TOKEN_URL,
} from "./api";
import { gmailConfig } from "./config";
import { credentialTypes, nodes } from "./index";
import {
  addressOf,
  replyTarget,
  resolveLabelIds,
  searchText,
  splitAddresses,
  toMailItem,
} from "./request";
import { isCursor, nextCursor } from "./trigger";

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
const oauth: Cred = { type: "gmail.oauth2", data: { accessToken: "ya29.secret" } };

type Call = { url: string; init: RequestInit };
type Answer = { body?: unknown; status?: number };

/** Answers the calls in order. */
function mockFetch(answers: Answer[], calls: Call[] = []) {
  mock.method(globalThis, "fetch", async (url: URL | string, init: RequestInit) => {
    calls.push({ url: String(url), init });
    const answer = answers[calls.length - 1] ?? {};
    const status = answer.status ?? 200;
    return new Response(status === 204 ? null : JSON.stringify(answer.body ?? {}), { status });
  });
  return calls;
}

const bodyOf = (call: Call | undefined): Record<string, unknown> =>
  JSON.parse(String(call?.init.body));

const authOf = (call: Call | undefined): string | undefined =>
  (call?.init.headers as Record<string, string> | undefined)?.authorization;

const find = (type: string): NodeDefinition => {
  const found = nodes.find((entry) => entry.type === type);
  if (!found) throw new Error("no node");
  return found;
};

const run = async (config: Record<string, unknown>, input: unknown = null, credential = oauth) => {
  const definition = find("gmail.api");
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

const b64 = (value: string) => Buffer.from(value).toString("base64url");

const decodeRaw = (call: Call | undefined) =>
  Buffer.from(String(bodyOf(call).raw), "base64url").toString("utf8");

/** A Gmail message with a text part, an html part, and a file. */
const MESSAGE = {
  id: "m1",
  threadId: "t1",
  labelIds: ["INBOX", "UNREAD"],
  snippet: "Hi Bob",
  internalDate: "1761472800000",
  payload: {
    mimeType: "multipart/mixed",
    headers: [
      { name: "From", value: "Ann <ann@example.com>" },
      { name: "To", value: "bob@example.com, Cy <cy@example.com>" },
      { name: "Cc", value: '"Doe, Dan" <dan@example.com>' },
      { name: "Subject", value: "Hello" },
      { name: "Message-ID", value: "<1@example.com>" },
      { name: "References", value: "<0@example.com>" },
    ],
    body: { size: 0 },
    parts: [
      {
        mimeType: "multipart/alternative",
        filename: "",
        body: { size: 0 },
        parts: [
          { mimeType: "text/plain", filename: "", body: { size: 6, data: b64("Hi Bob") } },
          { mimeType: "text/html", filename: "", body: { size: 10, data: b64("<p>Hi Bob</p>") } },
        ],
      },
      {
        mimeType: "text/csv",
        filename: "a.csv",
        headers: [{ name: "Content-ID", value: "<c1>" }],
        body: { size: 8, attachmentId: "att1" },
      },
    ],
  },
};

beforeEach(() => clearTokenCache());
afterEach(() => mock.restoreAll());

describe("service account", () => {
  it("signs an RS256 JWT with the user to act as", () => {
    const jwt = signJwt(KEY, 1_700_000_000_000, "me@example.com");
    const [header, claims, signature] = jwt.split(".");
    const decode = (part: string | undefined) =>
      JSON.parse(Buffer.from(part ?? "", "base64url").toString("utf8"));
    assert.deepEqual(decode(header), { alg: "RS256", typ: "JWT", kid: "k1" });
    assert.deepEqual(decode(claims), {
      iss: KEY.client_email,
      sub: "me@example.com",
      scope: GMAIL_SCOPE,
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

  it("caches the token for each user", async () => {
    const calls = mockFetch([
      { body: { access_token: "t1", expires_in: 3600 } },
      { body: { access_token: "t2", expires_in: 3600 } },
    ]);
    assert.equal(await serviceAccountToken(KEY, "a@example.com"), "t1");
    assert.equal(await serviceAccountToken(KEY, "a@example.com"), "t1");
    assert.equal(await serviceAccountToken(KEY, "b@example.com"), "t2");
    assert.equal(calls.length, 2);
  });

  it("gives the error of the token endpoint", async () => {
    mockFetch([{ status: 400, body: { error: "invalid_grant", error_description: "Bad JWT" } }]);
    await assert.rejects(serviceAccountToken(KEY, "a@example.com"), /\(400\): Bad JWT/);
  });

  it("runs the node with the token of the service account", async () => {
    const calls = mockFetch([
      { body: { access_token: "sa-token", expires_in: 3600 } },
      { body: { labels: [] } },
    ]);
    await run({ authentication: "serviceAccount", resource: "label", operation: "getMany" }, null, {
      type: "gmail.service_account",
      data: { serviceAccountKey: KEY_JSON, impersonatedUser: "me@example.com" },
    });
    assert.equal(calls[1]?.url, "https://gmail.googleapis.com/gmail/v1/users/me/labels");
    assert.equal(authOf(calls[1]), "Bearer sa-token");
  });

  it("needs the user to act as", async () => {
    await assert.rejects(
      run({ resource: "label", operation: "getMany" }, null, {
        type: "gmail.service_account",
        data: { serviceAccountKey: KEY_JSON },
      }),
      /impersonatedUser/,
    );
  });
});

describe("credentials", () => {
  const fields = (type: string) => credentialTypes.find((entry) => entry.type === type)?.fields;

  it("has an OAuth2 and a service account type", () => {
    assert.deepEqual(credentialTypes.map((entry) => entry.type).sort(), [
      "gmail.oauth2",
      "gmail.service_account",
    ]);
    const oauth2 = credentialTypes.find((entry) => entry.type === "gmail.oauth2")?.oauth2;
    assert.ok(oauth2 && typeof oauth2 === "object");
    assert.deepEqual(oauth2.scopes, [GMAIL_SCOPE]);
  });

  it("checks the service account fields", () => {
    const schema = fields("gmail.service_account");
    assert.equal(
      schema?.safeParse({ serviceAccountKey: KEY_JSON, impersonatedUser: "me@example.com" })
        .success,
      true,
    );
    assert.equal(schema?.safeParse({ serviceAccountKey: KEY_JSON }).success, false);
    assert.equal(
      schema?.safeParse({ serviceAccountKey: "{}", impersonatedUser: "me@example.com" }).success,
      false,
    );
  });
});

describe("config", () => {
  it("rejects an operation of another resource", () => {
    assert.equal(gmailConfig.safeParse({ resource: "label", operation: "send" }).success, false);
    assert.equal(gmailConfig.safeParse({ resource: "message", operation: "send" }).success, true);
  });

  it("is in the package with a trigger", () => {
    assert.deepEqual(nodes.map((node) => node.type).sort(), ["gmail.api", "gmail.trigger"]);
  });
});

describe("helpers", () => {
  it("builds the search text", () => {
    assert.equal(searchText({}), undefined);
    assert.equal(
      searchText({
        query: "has:attachment",
        sender: "ann@example.com",
        readStatus: "unread",
        after: 10.7,
      }),
      "has:attachment from:(ann@example.com) is:unread after:10",
    );
  });

  it("reads the address of a name and splits a list", () => {
    assert.equal(addressOf("Ann <ANN@example.com>"), "ann@example.com");
    assert.deepEqual(splitAddresses('a@x.com, "Doe, Dan" <d@x.com>'), [
      "a@x.com",
      '"Doe, Dan" <d@x.com>',
    ]);
  });

  it("finds label IDs and loads the labels only for a name", async () => {
    let loads = 0;
    const load = async () => {
      loads += 1;
      return [{ id: "Label_5", name: "Invoices" }];
    };
    assert.deepEqual(await resolveLabelIds(["INBOX", "Label_9"], load), ["INBOX", "Label_9"]);
    assert.equal(loads, 0);
    assert.deepEqual(await resolveLabelIds(["invoices"], load), ["Label_5"]);
    await assert.rejects(resolveLabelIds(["nope"], load), /does not exist/);
  });

  it("parses a message", () => {
    const item = toMailItem(MESSAGE);
    assert.equal(item.subject, "Hello");
    assert.equal(item.text, "Hi Bob");
    assert.equal(item.html, "<p>Hi Bob</p>");
    assert.equal(item.internalDate, new Date(1761472800000).toISOString());
    assert.deepEqual(item.attachments, [
      { attachmentId: "att1", fileName: "a.csv", mimeType: "text/csv", size: 8, contentId: "c1" },
    ]);
  });

  it("decodes the charset of a part", () => {
    const item = toMailItem({
      payload: {
        mimeType: "text/plain",
        headers: [{ name: "Content-Type", value: 'text/plain; charset="iso-8859-1"' }],
        body: { size: 1, data: Buffer.from([0xe9]).toString("base64url") },
      },
    });
    assert.equal(item.text, "é");
  });

  it("makes a reply target", () => {
    const one = replyTarget(MESSAGE, false);
    assert.equal(one.to, "Ann <ann@example.com>");
    assert.equal(one.cc, "");
    assert.equal(one.subject, "Re: Hello");
    assert.equal(one.inReplyTo, "<1@example.com>");
    assert.equal(one.references, "<0@example.com> <1@example.com>");
    assert.equal(one.threadId, "t1");
    const all = replyTarget(MESSAGE, true, "bob@example.com");
    assert.equal(all.cc, 'Cy <cy@example.com>, "Doe, Dan" <dan@example.com>');
    assert.equal(
      replyTarget(
        {
          ...MESSAGE,
          payload: { ...MESSAGE.payload, headers: [{ name: "Subject", value: "RE: x" }] },
        },
        false,
      ).subject,
      "RE: x",
    );
  });

  it("makes a clear error", () => {
    const error = gmailError(
      403,
      { error: { message: "Denied", status: "PERMISSION_DENIED" } },
      "send the message",
    );
    assert.match(
      error.message,
      /Gmail could not send the message \(403 PERMISSION_DENIED\): Denied\./,
    );
    assert.match(error.message, /Gmail API/);
  });
});

describe("message", () => {
  it("sends html with cc, bcc, and an attachment from binary data", async () => {
    const calls = mockFetch([{ body: { id: "m9", threadId: "t9", labelIds: ["SENT"] } }]);
    const out = await run(
      {
        resource: "message",
        operation: "send",
        to: "bob@example.com",
        ccEmail: "cc@example.com",
        bccEmail: "bcc@example.com",
        subject: "Héllo",
        html: "<p>Hi</p>",
        attachments: "data",
      },
      {
        binary: {
          data: {
            data: Buffer.from("x,y\n").toString("base64"),
            mimeType: "text/csv",
            fileName: "a.csv",
          },
        },
      },
    );
    assert.deepEqual(out, { port: "out", data: { id: "m9", threadId: "t9", labelIds: ["SENT"] } });
    assert.equal(calls[0]?.url, "https://gmail.googleapis.com/gmail/v1/users/me/messages/send");
    assert.equal(calls[0]?.init.method, "POST");
    assert.equal(authOf(calls[0]), "Bearer ya29.secret");
    const mime = decodeRaw(calls[0]);
    assert.match(mime, /^To: bob@example\.com/m);
    assert.match(mime, /^Cc: cc@example\.com/m);
    assert.match(mime, /^Bcc: bcc@example\.com/m);
    assert.match(mime, /^Subject: =\?UTF-8\?/m);
    assert.match(mime, /Content-Type: text\/html/);
    assert.match(mime, /filename="?a\.csv"?/);
    assert.match(mime, /Content-ID: <data>/i);
  });

  it("sends text and html together", async () => {
    const calls = mockFetch([{ body: { id: "m9" } }]);
    await run({
      resource: "message",
      operation: "send",
      to: "a@example.com",
      emailFormat: "both",
      text: "plain",
      html: "<b>rich</b>",
    });
    assert.match(decodeRaw(calls[0]), /multipart\/alternative/);
  });

  it("needs a recipient and a binary property that exists", async () => {
    await assert.rejects(run({ resource: "message", operation: "send", html: "x" }), /recipient/);
    await assert.rejects(
      run({ resource: "message", operation: "send", to: "a@example.com", attachments: "nope" }, {}),
      /nope/,
    );
  });

  it("replies in the thread with the mail headers", async () => {
    const calls = mockFetch([{ body: MESSAGE }, { body: { id: "m10", threadId: "t1" } }]);
    await run({ resource: "message", operation: "reply", messageId: "m1", html: "<p>Thanks</p>" });
    const first = new URL(calls[0]?.url ?? "");
    assert.equal(first.pathname, "/gmail/v1/users/me/messages/m1");
    assert.equal(first.searchParams.get("format"), "metadata");
    assert.ok(first.searchParams.getAll("metadataHeaders").includes("Message-ID"));
    assert.equal(bodyOf(calls[1]).threadId, "t1");
    const mime = decodeRaw(calls[1]);
    assert.match(mime, /^To: Ann <ann@example\.com>/m);
    assert.match(mime, /^Subject: Re: Hello/m);
    assert.match(mime, /^In-Reply-To: <1@example\.com>/m);
    assert.match(mime, /^References: <0@example\.com> <1@example\.com>/m);
  });

  it("replies to all without the own address", async () => {
    const calls = mockFetch([
      { body: MESSAGE },
      { body: { emailAddress: "bob@example.com" } },
      { body: { id: "m10" } },
    ]);
    await run({
      resource: "message",
      operation: "reply",
      messageId: "m1",
      replyAll: true,
      emailFormat: "text",
      text: "ok",
    });
    const mime = decodeRaw(calls[2]);
    assert.match(mime, /^Cc: .*cy@example\.com/m);
    assert.doesNotMatch(mime, /bob@example\.com/);
  });

  it("gets a message and downloads the attachment as binary data", async () => {
    const calls = mockFetch([
      { body: MESSAGE },
      { body: { size: 8, data: Buffer.from("x,y\n1,2\n").toString("base64url") } },
    ]);
    const out = (await run({
      resource: "message",
      operation: "get",
      messageId: "m1",
      downloadAttachments: true,
    })) as {
      data: {
        subject: string;
        binary: Record<string, { data: string; fileName: string; mimeType: string }>;
      };
    };
    assert.equal(out.data.subject, "Hello");
    assert.equal(out.data.binary.attachment_0?.fileName, "a.csv");
    assert.equal(out.data.binary.attachment_0?.mimeType, "text/csv");
    assert.equal(
      Buffer.from(out.data.binary.attachment_0?.data ?? "", "base64").toString(),
      "x,y\n1,2\n",
    );
    assert.match(calls[1]?.url ?? "", /messages\/m1\/attachments\/att1$/);
  });

  it("returns the full answer of Gmail when simplify is off", async () => {
    mockFetch([{ body: MESSAGE }]);
    const out = (await run({
      resource: "message",
      operation: "get",
      messageId: "m1",
      simplify: false,
    })) as { data: unknown };
    assert.deepEqual(out.data, MESSAGE);
  });

  it("searches with a query and labels, and gets each message", async () => {
    const calls = mockFetch([
      { body: { labels: [{ id: "Label_5", name: "Invoices" }] } },
      { body: { messages: [{ id: "m1" }, { id: "m2" }] } },
      { body: MESSAGE },
      { body: { ...MESSAGE, id: "m2" } },
    ]);
    const out = (await run({
      resource: "message",
      operation: "getMany",
      query: "from:ann",
      labelIds: "INBOX, Invoices",
      limit: 2,
      includeSpamTrash: true,
    })) as { data: { id: string }[] };
    assert.deepEqual(
      out.data.map((mail) => mail.id),
      ["m1", "m2"],
    );
    const list = new URL(calls[1]?.url ?? "");
    assert.equal(list.searchParams.get("q"), "from:ann");
    assert.equal(list.searchParams.get("includeSpamTrash"), "true");
    assert.equal(list.searchParams.get("maxResults"), "2");
    assert.deepEqual(list.searchParams.getAll("labelIds"), ["INBOX", "Label_5"]);
  });

  it("follows the pages of a search up to the limit", async () => {
    const calls = mockFetch([
      { body: { messages: [{ id: "m1" }], nextPageToken: "p2" } },
      { body: { messages: [{ id: "m2" }, { id: "m3" }] } },
      { body: MESSAGE },
      { body: MESSAGE },
    ]);
    const out = (await run({ resource: "message", operation: "getMany", limit: 2 })) as {
      data: unknown[];
    };
    assert.equal(out.data.length, 2);
    assert.equal(new URL(calls[1]?.url ?? "").searchParams.get("pageToken"), "p2");
  });

  it("marks as read and unread with the UNREAD label", async () => {
    const calls = mockFetch([{ body: { id: "m1" } }, { body: { id: "m1" } }]);
    await run({ resource: "message", operation: "markAsRead", messageId: "m1" });
    await run({ resource: "message", operation: "markAsUnread", messageId: "m1" });
    assert.deepEqual(bodyOf(calls[0]), { addLabelIds: [], removeLabelIds: ["UNREAD"] });
    assert.deepEqual(bodyOf(calls[1]), { addLabelIds: ["UNREAD"], removeLabelIds: [] });
    assert.match(calls[0]?.url ?? "", /messages\/m1\/modify$/);
  });

  it("adds and removes labels by name", async () => {
    const calls = mockFetch([
      { body: { labels: [{ id: "Label_5", name: "Invoices" }] } },
      { body: { id: "m1" } },
      { body: { id: "m1" } },
    ]);
    await run({
      resource: "message",
      operation: "addLabels",
      messageId: "m1",
      labelIds: "Invoices, STARRED",
    });
    assert.deepEqual(bodyOf(calls[1]), { addLabelIds: ["Label_5", "STARRED"], removeLabelIds: [] });
    await run({
      resource: "message",
      operation: "removeLabels",
      messageId: "m1",
      labelIds: "INBOX",
    });
    assert.deepEqual(bodyOf(calls[2]), { addLabelIds: [], removeLabelIds: ["INBOX"] });
  });

  it("moves to the trash, restores, and deletes", async () => {
    const calls = mockFetch([{ body: { id: "m1" } }, { body: { id: "m1" } }, { status: 204 }]);
    await run({ resource: "message", operation: "trash", messageId: "m1" });
    await run({ resource: "message", operation: "untrash", messageId: "m1" });
    const out = await run({ resource: "message", operation: "delete", messageId: "m1" });
    assert.match(calls[0]?.url ?? "", /messages\/m1\/trash$/);
    assert.match(calls[1]?.url ?? "", /messages\/m1\/untrash$/);
    assert.equal(calls[2]?.init.method, "DELETE");
    assert.deepEqual(out, { port: "out", data: { success: true, id: "m1" } });
  });

  it("refuses an ID that is not safe for a path", async () => {
    await assert.rejects(
      run({ resource: "message", operation: "get", messageId: "../labels" }),
      /not a valid messageId/,
    );
    await assert.rejects(run({ resource: "message", operation: "get" }), /"messageId" is needed/);
  });

  it("hides the token in the error and gives a hint", async () => {
    mockFetch([
      {
        status: 401,
        body: { error: { message: "Invalid Credentials", status: "UNAUTHENTICATED" } },
      },
    ]);
    await assert.rejects(
      run({ resource: "message", operation: "get", messageId: "m1" }),
      (error: Error) =>
        /Gmail could not get the message \(401 UNAUTHENTICATED\)/.test(error.message) &&
        /Connect the credential again/.test(error.message) &&
        !error.message.includes("ya29"),
    );
  });
});

describe("draft", () => {
  it("creates a draft in a thread", async () => {
    const calls = mockFetch([{ body: { id: "d1", message: { id: "m1" } } }]);
    await run({
      resource: "draft",
      operation: "create",
      to: "a@example.com",
      subject: "Hi",
      html: "x",
      threadId: "t1",
    });
    assert.equal(calls[0]?.url, "https://gmail.googleapis.com/gmail/v1/users/me/drafts");
    const message = bodyOf(calls[0]).message as { raw: string; threadId: string };
    assert.equal(message.threadId, "t1");
    assert.match(Buffer.from(message.raw, "base64url").toString(), /^Subject: Hi/m);
  });

  it("gets a draft with its draft ID, lists drafts, and deletes", async () => {
    const calls = mockFetch([
      { body: { id: "d1", message: MESSAGE } },
      { body: { drafts: [{ id: "d2" }] } },
      { body: { id: "d2", message: MESSAGE } },
      { status: 204 },
    ]);
    const one = (await run({ resource: "draft", operation: "get", draftId: "d1" })) as {
      data: { draftId: string; id: string };
    };
    assert.equal(one.data.draftId, "d1");
    assert.equal(one.data.id, "m1");
    const many = (await run({ resource: "draft", operation: "getMany" })) as { data: unknown[] };
    assert.equal(many.data.length, 1);
    await run({ resource: "draft", operation: "delete", draftId: "d1" });
    assert.equal(calls[3]?.init.method, "DELETE");
  });
});

describe("label", () => {
  it("lists, creates, gets, and deletes labels", async () => {
    const calls = mockFetch([
      { body: { labels: [{ id: "A" }, { id: "B" }, { id: "C" }] } },
      { body: { id: "Label_1", name: "Invoices" } },
      { body: { id: "Label_1" } },
      { status: 204 },
    ]);
    const list = (await run({ resource: "label", operation: "getMany", limit: 2 })) as {
      data: unknown[];
    };
    assert.equal(list.data.length, 2);
    await run({ resource: "label", operation: "create", labelName: " Invoices " });
    assert.deepEqual(bodyOf(calls[1]), {
      name: "Invoices",
      labelListVisibility: "labelShow",
      messageListVisibility: "show",
    });
    await run({ resource: "label", operation: "get", labelId: "Label_1" });
    await run({ resource: "label", operation: "delete", labelId: "Label_1" });
    assert.equal(calls[3]?.init.method, "DELETE");
    assert.match(calls[3]?.url ?? "", /labels\/Label_1$/);
  });
});

describe("thread", () => {
  it("gets a thread with simple messages", async () => {
    mockFetch([{ body: { id: "t1", historyId: "9", messages: [MESSAGE, MESSAGE] } }]);
    const out = (await run({ resource: "thread", operation: "get", threadId: "t1" })) as {
      data: { id: string; historyId: string; messages: { subject: string }[] };
    };
    assert.equal(out.data.id, "t1");
    assert.equal(out.data.messages.length, 2);
    assert.equal(out.data.messages[0]?.subject, "Hello");
  });

  it("changes labels, trashes, and deletes a thread", async () => {
    const calls = mockFetch([
      { body: { id: "t1" } },
      { body: { id: "t1" } },
      { body: { id: "t1" } },
      { status: 204 },
    ]);
    await run({ resource: "thread", operation: "addLabels", threadId: "t1", labelIds: "STARRED" });
    await run({ resource: "thread", operation: "removeLabels", threadId: "t1", labelIds: "INBOX" });
    await run({ resource: "thread", operation: "trash", threadId: "t1" });
    await run({ resource: "thread", operation: "delete", threadId: "t1" });
    assert.match(calls[0]?.url ?? "", /threads\/t1\/modify$/);
    assert.deepEqual(bodyOf(calls[1]), { addLabelIds: [], removeLabelIds: ["INBOX"] });
    assert.match(calls[2]?.url ?? "", /threads\/t1\/trash$/);
    assert.equal(calls[3]?.init.method, "DELETE");
  });
});

describe("trigger", () => {
  const trigger = find("gmail.trigger");
  const poll = async (
    cursor: unknown,
    firstPoll: boolean,
    config: Record<string, unknown> = {},
  ) => {
    if (!trigger.poll) throw new Error("no poll");
    return await trigger.poll({
      config: trigger.config.parse(config),
      credential: oauth,
      cursor,
      firstPoll,
      workflow: { id: "w", name: "w" },
      node: { id: "n", name: "n" },
      signal,
    } as never);
  };
  const at = (id: string, millis: number) => ({ ...MESSAGE, id, internalDate: String(millis) });

  it("starts no runs on the first poll and keeps the time", async () => {
    const calls = mockFetch([]);
    const result = await poll(null, true);
    assert.deepEqual(result.items, []);
    assert.ok(isCursor(result.cursor));
    assert.equal(calls.length, 0);
  });

  it("returns only new mails, oldest first, and moves the cursor", async () => {
    const calls = mockFetch([
      { body: { messages: [{ id: "m3" }, { id: "m2" }, { id: "m1" }] } },
      { body: at("m3", 3_000_000) },
      { body: at("m1", 1_000_000) },
    ]);
    const result = await poll({ after: 2_000_000, ids: ["m2"] }, false, {
      query: "invoice",
      sender: "ann@example.com",
    });
    // m2 is known. m1 is before the cursor.
    assert.deepEqual(
      result.items.map((item) => item.key),
      ["m3"],
    );
    assert.deepEqual(result.cursor, { after: 3_000_000, ids: ["m3"] });
    const list = new URL(calls[0]?.url ?? "");
    assert.equal(list.searchParams.get("q"), "invoice from:(ann@example.com) is:unread after:1999");
  });

  it("limits the mails of one poll and starts the next poll after the last", async () => {
    mockFetch([
      { body: { messages: [{ id: "b" }, { id: "a" }] } },
      { body: at("b", 6_000_000) },
      { body: at("a", 5_000_000) },
    ]);
    const result = await poll({ after: 1_000_000, ids: [] }, false, { maxPerPoll: 1 });
    assert.deepEqual(
      result.items.map((item) => item.key),
      ["a"],
    );
    assert.deepEqual(result.cursor, { after: 5_000_000, ids: ["a"] });
  });

  it("marks the mails as read when asked", async () => {
    const calls = mockFetch([
      { body: { messages: [{ id: "m1" }] } },
      { body: at("m1", 5_000_000) },
      { body: { id: "m1" } },
    ]);
    await poll({ after: 1_000_000, ids: [] }, false, { postProcessAction: "read" });
    assert.match(calls[2]?.url ?? "", /messages\/m1\/modify$/);
    assert.deepEqual(bodyOf(calls[2]), { addLabelIds: [], removeLabelIds: ["UNREAD"] });
  });

  it("keeps the cursor when no mail is new, and passes the input through", async () => {
    const cursor = { after: 5, ids: ["x"] };
    assert.deepEqual(nextCursor(cursor, []), cursor);
    assert.deepEqual(await trigger.run({ input: { id: "m1" } } as never), {
      port: "out",
      data: { id: "m1" },
    });
  });
});
