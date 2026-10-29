// SPDX-License-Identifier: AGPL-3.0-only
import assert from "node:assert/strict";
import { afterEach, describe, it, mock } from "node:test";
import type { NodeDefinition } from "@zerodot/node-sdk";
import { callSlack, formBody, SlackError } from "./api";
import { slackConfig } from "./config";
import { credentialTypes, nodes } from "./index";
import { buildRequest, parseBlocks } from "./request";
import { checkSlackEvent, slackSignature, triggerConfig, verifySlackRequest } from "./trigger";

const signal = new AbortController().signal;
const options = { signal, timeoutMs: 5_000 };
type Cred = { type: string; data: Record<string, unknown> };
const credential: Cred = {
  type: "slack.bot",
  data: { accessToken: "xoxb-secret", signingSecret: "shh" },
};

const def = (type: string): NodeDefinition => {
  const found = nodes.find((entry) => entry.type === type);
  if (!found) throw new Error(`no node ${type}`);
  return found;
};

type Call = { url: string; init: RequestInit };
type Answer = { body?: unknown; status?: number; headers?: Record<string, string> };

/** Answers the calls in order. */
function mockFetch(answers: Answer[], calls: Call[] = []) {
  mock.method(globalThis, "fetch", async (url: URL | string, init: RequestInit) => {
    calls.push({ url: String(url), init });
    const answer = answers[calls.length - 1] ?? { body: { ok: true } };
    return new Response(JSON.stringify(answer.body ?? {}), {
      status: answer.status ?? 200,
      headers: answer.headers,
    });
  });
  return calls;
}

const formOf = (call: Call | undefined) =>
  Object.fromEntries(new URLSearchParams(String(call?.init.body)));

const run = async (config: Record<string, unknown>, input: unknown = null) => {
  const definition = def("slack.api");
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

const build = (config: Record<string, unknown>) => buildRequest(slackConfig.parse(config));

afterEach(() => mock.restoreAll());

describe("slack config", () => {
  it("checks that the operation belongs to the resource", () => {
    assert.equal(slackConfig.safeParse({ resource: "user", operation: "send" }).success, false);
    assert.equal(slackConfig.safeParse({ resource: "user", operation: "list" }).success, true);
  });

  it("has a label and a hint for each option of each select", () => {
    const shape = slackConfig.shape;
    for (const key of ["resource", "operation", "channelTypes"] as const) {
      const field = shape[key];
      const meta = field.meta() as { labels?: Record<string, string>; hints?: object };
      const options =
        key === "channelTypes"
          ? ["public_channel", "private_channel", "mpim", "im"]
          : key === "resource"
            ? ["message", "channel", "user", "reaction", "file"]
            : Object.keys(meta.labels ?? {});
      for (const option of options) {
        assert.ok(meta.labels?.[option], `${key}.${option} label`);
        assert.ok((meta.hints as Record<string, string>)?.[option], `${key}.${option} hint`);
      }
    }
  });

  it("validates the credential fields", () => {
    const fields = credentialTypes[0]?.fields.strict();
    assert.equal(fields?.safeParse({ accessToken: "xoxb-1" }).success, true);
    assert.equal(fields?.safeParse({ accessToken: "" }).success, false);
  });
});

describe("slack request builder", () => {
  it("sends a message with blocks and options", () => {
    const request = build({
      operation: "send",
      channelId: " C1 ",
      text: "hi",
      blocks: '{"blocks":[{"type":"divider"}]}',
      threadTs: "1.2",
      messageOptions: { unfurl_links: false },
    });
    assert.deepEqual(request, {
      method: "chat.postMessage",
      args: {
        channel: "C1",
        text: "hi",
        blocks: [{ type: "divider" }],
        thread_ts: "1.2",
        unfurl_links: false,
      },
    });
  });

  it("needs text or blocks, and a channel", () => {
    assert.throws(() => build({ operation: "send", channelId: "C1" }), /"text" or "blocks"/);
    assert.throws(() => build({ operation: "send", text: "x" }), /channelId/);
    assert.throws(() => parseBlocks("{"), /must be JSON/);
    assert.throws(() => parseBlocks('{"a":1}'), /JSON array/);
  });

  it("maps every operation to its Web API method", () => {
    const cases: [Record<string, unknown>, string][] = [
      [{ operation: "update", channelId: "C", messageTs: "1", text: "t" }, "chat.update"],
      [{ operation: "delete", channelId: "C", messageTs: "1" }, "chat.delete"],
      [{ operation: "getPermalink", channelId: "C", messageTs: "1" }, "chat.getPermalink"],
      [{ resource: "channel", operation: "list" }, "conversations.list"],
      [{ resource: "channel", operation: "get", channelId: "C" }, "conversations.info"],
      [{ resource: "channel", operation: "create", channelName: "x" }, "conversations.create"],
      [{ resource: "channel", operation: "archive", channelId: "C" }, "conversations.archive"],
      [{ resource: "channel", operation: "join", channelId: "C" }, "conversations.join"],
      [
        { resource: "channel", operation: "invite", channelId: "C", userIds: "U1" },
        "conversations.invite",
      ],
      [{ resource: "user", operation: "get", userId: "U1" }, "users.info"],
      [{ resource: "user", operation: "list" }, "users.list"],
      [{ resource: "user", operation: "getByEmail", email: "a@b.c" }, "users.lookupByEmail"],
      [
        {
          resource: "reaction",
          operation: "add",
          channelId: "C",
          messageTs: "1",
          reactionName: "x",
        },
        "reactions.add",
      ],
      [
        {
          resource: "reaction",
          operation: "remove",
          channelId: "C",
          messageTs: "1",
          reactionName: "x",
        },
        "reactions.remove",
      ],
    ];
    for (const [config, method] of cases) assert.equal(build(config).method, method);
  });

  it("cleans lists and emoji names", () => {
    assert.equal(
      build({ resource: "channel", operation: "invite", channelId: "C", userIds: "U1, ,U2" }).args
        .users,
      "U1,U2",
    );
    assert.equal(
      build({
        resource: "reaction",
        operation: "add",
        channelId: "C",
        messageTs: "1",
        reactionName: ":thumbsup:",
      }).args.name,
      "thumbsup",
    );
    assert.deepEqual(
      build({ resource: "channel", operation: "list", channelTypes: ["public_channel", "im"] }),
      {
        method: "conversations.list",
        args: { types: "public_channel,im", exclude_archived: true },
        itemsKey: "channels",
      },
    );
  });

  it("puts objects in the form as JSON and leaves out empty values", () => {
    const form = formBody({ a: "x", b: undefined, c: "", d: [1], e: false, f: 2 });
    assert.equal(form.toString(), "a=x&d=%5B1%5D&e=false&f=2");
  });
});

describe("slack api errors", () => {
  it("maps ok:false to an error with the code and a hint", async () => {
    mockFetch([{ body: { ok: false, error: "not_in_channel" } }]);
    await assert.rejects(
      callSlack({ token: "xoxb-secret" }, "chat.postMessage", {}, options),
      (error: unknown) => {
        assert.ok(error instanceof SlackError);
        assert.equal(error.code, "not_in_channel");
        assert.match(error.message, /chat\.postMessage failed: not_in_channel/);
        assert.match(error.message, /Add the app to the channel/);
        assert.doesNotMatch(error.message, /xoxb/);
        return true;
      },
    );
  });

  it("names the missing scope", async () => {
    mockFetch([{ body: { ok: false, error: "missing_scope", needed: "channels:join" } }]);
    await assert.rejects(
      callSlack({ token: "t" }, "conversations.join", {}, options),
      /scope "channels:join"/,
    );
  });

  it("maps HTTP 429 with Retry-After", async () => {
    mockFetch([{ status: 429, headers: { "retry-after": "12" }, body: {} }]);
    await assert.rejects(callSlack({ token: "t" }, "users.list", {}, options), (error: unknown) => {
      assert.ok(error instanceof SlackError);
      assert.equal(error.code, "ratelimited");
      assert.equal(error.status, 429);
      assert.equal(error.retryAfter, 12);
      assert.match(error.message, /12 seconds/);
      return true;
    });
  });

  it("maps an answer that is not JSON", async () => {
    mock.method(globalThis, "fetch", async () => new Response("oops", { status: 502 }));
    await assert.rejects(callSlack({ token: "t" }, "auth.test", {}, options), /HTTP status 502/);
  });
});

describe("slack node", () => {
  it("posts a form with the bearer token and drops ok from the output", async () => {
    const calls = mockFetch([{ body: { ok: true, channel: "C1", ts: "9.9" } }]);
    const result = await run({ operation: "send", channelId: "C1", text: "hello" });
    assert.deepEqual(result, { port: "out", data: { channel: "C1", ts: "9.9" } });
    assert.equal(calls[0]?.url, "https://slack.com/api/chat.postMessage");
    assert.equal(calls[0]?.init.method, "POST");
    const headers = calls[0]?.init.headers as Record<string, string>;
    assert.equal(headers.authorization, "Bearer xoxb-secret");
    assert.match(headers["content-type"] ?? "", /x-www-form-urlencoded/);
    assert.deepEqual(formOf(calls[0]), { channel: "C1", text: "hello" });
  });

  it("gives success for an answer with only ok", async () => {
    mockFetch([{ body: { ok: true } }]);
    const result = await run({ resource: "channel", operation: "archive", channelId: "C1" });
    assert.deepEqual(result, { port: "out", data: { success: true } });
  });

  it("follows cursors until the limit", async () => {
    const calls = mockFetch([
      {
        body: {
          ok: true,
          members: [{ id: "U1" }, { id: "U2" }],
          response_metadata: { next_cursor: "n2" },
        },
      },
      {
        body: {
          ok: true,
          members: [{ id: "U3" }, { id: "U4" }],
          response_metadata: { next_cursor: "n3" },
        },
      },
    ]);
    const result = await run({ resource: "user", operation: "list", limit: 3 });
    assert.deepEqual(result, { port: "out", data: [{ id: "U1" }, { id: "U2" }, { id: "U3" }] });
    assert.equal(calls.length, 2);
    assert.equal(formOf(calls[0]).limit, "3");
    assert.equal(formOf(calls[1]).cursor, "n2");
    assert.equal(formOf(calls[1]).limit, "1");
  });

  it("uploads a file in three steps", async () => {
    const calls = mockFetch([
      { body: { ok: true, upload_url: "https://files.slack.com/upload/v1/abc", file_id: "F1" } },
      { body: {} },
      { body: { ok: true, files: [{ id: "F1", title: "Report" }] } },
    ]);
    const input = {
      binary: { data: { data: Buffer.from("hello").toString("base64"), fileName: "a.txt" } },
    };
    const result = await run(
      {
        resource: "file",
        operation: "upload",
        channelId: "C1",
        title: "Report",
        initialComment: "here",
      },
      input,
    );
    assert.deepEqual(result, { port: "out", data: { id: "F1", title: "Report" } });
    assert.equal(calls[0]?.url, "https://slack.com/api/files.getUploadURLExternal");
    assert.deepEqual(formOf(calls[0]), { filename: "a.txt", length: "5" });
    assert.equal(calls[1]?.url, "https://files.slack.com/upload/v1/abc");
    const uploadHeaders = calls[1]?.init.headers as Record<string, string>;
    assert.equal(uploadHeaders.authorization, undefined);
    assert.equal(calls[2]?.url, "https://slack.com/api/files.completeUploadExternal");
    assert.deepEqual(formOf(calls[2]), {
      files: JSON.stringify([{ id: "F1", title: "Report" }]),
      channel_id: "C1",
      initial_comment: "here",
    });
  });

  it("uploads text content without binary data", async () => {
    const calls = mockFetch([
      { body: { ok: true, upload_url: "https://files.slack.com/u", file_id: "F2" } },
      { body: {} },
      { body: { ok: true, files: [{ id: "F2" }] } },
    ]);
    await run({
      resource: "file",
      operation: "upload",
      binaryData: false,
      fileContent: "abc",
      fileName: "n.txt",
    });
    assert.equal(formOf(calls[0]).length, "3");
    assert.equal(formOf(calls[2]).channel_id, undefined);
  });

  it("needs a Slack credential", async () => {
    const definition = def("slack.api");
    await assert.rejects(
      async () =>
        definition.run({
          config: definition.config.parse({ operation: "send", channelId: "C", text: "x" }),
          input: null,
          credential: null,
          signal,
        } as never),
      /Slack bot credential/,
    );
  });
});

describe("slack credential test", () => {
  it("calls auth.test, and rejects a token that is not a bot token", async () => {
    const test = credentialTypes[0]?.test;
    assert.ok(test);
    const calls = mockFetch([
      { body: { ok: true } },
      { body: { ok: false, error: "invalid_auth" } },
    ]);
    await test(credential as never);
    assert.equal(calls[0]?.url, "https://slack.com/api/auth.test");
    await assert.rejects(test(credential as never), /did not accept the token/);
    await assert.rejects(
      test({ type: "slack.bot", data: { accessToken: "xoxp-1" } } as never),
      /bot token/,
    );
  });
});

describe("slack trigger", () => {
  const now = 1_700_000_000;
  const rawBody = JSON.stringify({ type: "event_callback", event: { type: "message" } });
  const signed = (secret: string, ts: number, body = rawBody) => ({
    headers: {
      "x-slack-request-timestamp": String(ts),
      "x-slack-signature": slackSignature(secret, String(ts), body),
    },
    rawBody: body,
  });

  it("verifies the signature and the age", () => {
    assert.equal(verifySlackRequest("shh", signed("shh", now), now), true);
    assert.equal(verifySlackRequest("shh", signed("other", now), now), false);
    assert.equal(verifySlackRequest("shh", { ...signed("shh", now), rawBody: "x" }, now), false);
    assert.equal(verifySlackRequest("shh", signed("shh", now - 301), now), false);
    assert.equal(verifySlackRequest("shh", signed("shh", now + 301), now), false);
    assert.equal(verifySlackRequest("shh", { headers: {}, rawBody }, now), false);
  });

  it("matches the example of the Slack docs", () => {
    const body =
      "token=xyzz0WbapA4vBCDEFasx0q6G&team_id=T1DC2JH3J&team_domain=testteamnow&channel_id=G8PSS9T3V&channel_name=foobar&user_id=U2CERLKJA&user_name=roadrunner&command=%2Fwebhook-collect&text=&response_url=https%3A%2F%2Fhooks.slack.com%2Fcommands%2FT1DC2JH3J%2F397700885554%2F96rGlfmibIGlgcZRskXaIFfN&trigger_id=398738663015.47445629121.803a0bc887a14d10d2c447fce8b6703c";
    assert.equal(
      slackSignature("8f742231b10e8888abcd99yyyzzz85a5", "1531420618", body),
      "v0=a2114d57b48eac39b9ad189dd8316235a7b4a8d21a10bd27519666489c69b503",
    );
  });

  const receive = async (request: Record<string, unknown>, cred: Cred | null = credential) => {
    const webhook = def("trigger.slack").webhook;
    assert.ok(webhook);
    return await webhook.receive({
      config: { events: ["message"] },
      credential: cred,
      url: "https://z.example/hooks/abc",
      workflow: { id: "w", name: "" },
      node: { id: "n", name: "" },
      state: undefined,
      signal,
      request: { method: "POST", query: {}, ...request },
    } as never);
  };

  it("answers the url_verification challenge after the signature check", async () => {
    const body = { type: "url_verification", challenge: "abc123" };
    const text = JSON.stringify(body);
    const request = { ...signed("shh", Math.floor(Date.now() / 1000), text), body };
    assert.deepEqual(await receive(request), {
      verdict: "ignore",
      response: { status: 200, body: { challenge: "abc123" } },
    });
    assert.equal((await receive({ ...request, headers: {} })).verdict, "forbidden");
    assert.equal((await receive(request, null)).verdict, "forbidden");
  });

  it("accepts a signed event", async () => {
    const body = {
      type: "event_callback",
      team_id: "T1",
      event_id: "E1",
      event: { type: "message", channel: "C1", text: "hi" },
    };
    const text = JSON.stringify(body);
    const verdict = await receive({ ...signed("shh", Math.floor(Date.now() / 1000), text), body });
    assert.equal(verdict.verdict, "accept");
    assert.ok(verdict.verdict === "accept");
    assert.deepEqual(verdict.input, {
      type: "message",
      event: body.event,
      teamId: "T1",
      appId: null,
      eventId: "E1",
      eventTime: null,
      retry: 0,
    });
  });

  it("filters by event type, channel, and bots", () => {
    const config = (extra: Record<string, unknown>) =>
      triggerConfig.parse({ events: ["message"], ...extra });
    const wrap = (event: Record<string, unknown>) => ({ type: "event_callback", event });
    assert.equal(
      checkSlackEvent(config({}), wrap({ type: "app_mention" }), undefined).verdict,
      "ignore",
    );
    assert.equal(
      checkSlackEvent(config({}), wrap({ type: "message", bot_id: "B1" }), undefined).verdict,
      "ignore",
    );
    assert.equal(
      checkSlackEvent(
        config({ additionalFields: { includeBotMessages: true } }),
        wrap({ type: "message", bot_id: "B1" }),
        undefined,
      ).verdict,
      "accept",
    );
    const onlyC2 = config({ additionalFields: { channelIds: "C2, C3" } });
    assert.equal(
      checkSlackEvent(onlyC2, wrap({ type: "message", channel: "C1" }), undefined).verdict,
      "ignore",
    );
    assert.equal(
      checkSlackEvent(onlyC2, wrap({ type: "message", channel: "C3" }), "1").verdict,
      "accept",
    );
    assert.equal(
      checkSlackEvent(
        triggerConfig.parse({ events: ["*"] }),
        wrap({ type: "reaction_added", item: { channel: "C1" } }),
        undefined,
      ).verdict,
      "accept",
    );
  });

  it("checks the credential on activate", async () => {
    const webhook = def("trigger.slack").webhook;
    const calls = mockFetch([{ body: { ok: true, team_id: "T9" } }]);
    const context = {
      config: {},
      url: "",
      workflow: { id: "", name: "" },
      node: { id: "", name: "" },
      state: null,
      signal,
    };
    assert.deepEqual(await webhook?.activate?.({ ...context, credential } as never), {
      teamId: "T9",
    });
    assert.equal(calls[0]?.url, "https://slack.com/api/auth.test");
    await assert.rejects(
      async () =>
        webhook?.activate?.({
          ...context,
          credential: { type: "slack.bot", data: { accessToken: "xoxb-1" } },
        } as never),
      /signingSecret/,
    );
  });
});
