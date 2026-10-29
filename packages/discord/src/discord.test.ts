// SPDX-License-Identifier: AGPL-3.0-only
import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import { afterEach, describe, it, mock } from "node:test";
import type { NodeDefinition } from "@zerodot/node-sdk";
import { callDiscord, parseWebhookUrl } from "./api";
import { discordConfig } from "./config";
import { discordBotCredential, discordWebhookCredential } from "./credential";
import { nodes } from "./index";
import { buildRequest, emojiOf } from "./request";
import { checkInteraction, triggerConfig, verifyDiscordSignature } from "./trigger";

const signal = new AbortController().signal;
type Cred = { type: string; data: Record<string, unknown> };
const bot: Cred = { type: "discord.bot", data: { botToken: "B0T" } };
const hook: Cred = {
  type: "discord.webhook",
  data: { webhookUrl: "https://discord.com/api/webhooks/123/S3CRET" },
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
    const answer = answers[calls.length - 1] ?? {};
    const status = answer.status ?? 200;
    return new Response(status === 204 ? null : JSON.stringify(answer.body ?? {}), {
      status,
      headers: answer.headers,
    });
  });
  return calls;
}

const run = async (
  config: Record<string, unknown>,
  credential: Cred = bot,
  input: unknown = null,
) => {
  const definition = def("discord.api");
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

const parse = (config: Record<string, unknown>) => discordConfig.parse(config);

afterEach(() => mock.restoreAll());

describe("discord config", () => {
  it("checks that the operation belongs to the resource", () => {
    assert.equal(discordConfig.safeParse({ resource: "guild", operation: "send" }).success, false);
    assert.equal(discordConfig.safeParse({ resource: "member", operation: "kick" }).success, true);
  });

  it("allows only webhook operations with a webhook credential", () => {
    assert.equal(
      discordConfig.safeParse({ authentication: "webhook", resource: "message" }).success,
      false,
    );
    assert.equal(
      discordConfig.safeParse({
        authentication: "webhook",
        resource: "webhook",
        operation: "execute",
      }).success,
      true,
    );
  });

  it("gives labels and hints to each option of each select", () => {
    const shape = discordConfig.shape;
    for (const [key, field] of Object.entries(shape)) {
      const inner = "unwrap" in field ? field.unwrap() : field;
      const options = (inner as { options?: unknown }).options;
      if (!Array.isArray(options)) continue;
      const meta = field.meta() as {
        labels?: Record<string, string>;
        hints?: Record<string, string>;
      };
      for (const option of options as string[]) {
        assert.ok(meta.labels?.[option], `${key}.${option} label`);
        assert.ok(meta.hints?.[option], `${key}.${option} hint`);
      }
    }
  });
});

describe("discord request", () => {
  it("builds a message with embeds, mentions, and a reply", () => {
    assert.deepEqual(
      buildRequest(
        parse({
          channelId: "9",
          content: "hi",
          embeds: '{"title":"T"}',
          mentions: "none",
          replyTo: "5",
        }),
      ),
      {
        method: "POST",
        path: "/channels/9/messages",
        body: {
          content: "hi",
          embeds: [{ title: "T" }],
          allowed_mentions: { parse: [] },
          message_reference: { message_id: "5", fail_if_not_exists: false },
        },
      },
    );
  });

  it("needs content or embeds, and valid JSON", () => {
    assert.throws(() => buildRequest(parse({ channelId: "9" })), /content/);
    assert.throws(() => buildRequest(parse({ content: "x" })), /channelId/);
    assert.throws(() => buildRequest(parse({ channelId: "9", embeds: "{" })), /valid JSON/);
    assert.throws(() => buildRequest(parse({ channelId: "9", content: "x".repeat(2001) })), /2000/);
  });

  it("escapes the emoji of a reaction", () => {
    assert.equal(emojiOf("<a:party:123>"), "party:123");
    assert.equal(
      buildRequest(
        parse({
          resource: "message",
          operation: "react",
          channelId: "1",
          messageId: "2",
          emoji: "👍",
        }),
      ).path,
      `/channels/1/messages/2/reactions/${encodeURIComponent("👍")}/@me`,
    );
  });

  it("builds channel, member, and server calls", () => {
    assert.deepEqual(
      buildRequest(
        parse({
          resource: "channel",
          operation: "create",
          guildId: "7",
          channelName: "news",
          channelType: "announcement",
          reason: "why",
        }),
      ),
      {
        method: "POST",
        path: "/guilds/7/channels",
        reason: "why",
        body: { name: "news", type: 5 },
      },
    );
    const role = buildRequest(
      parse({
        resource: "member",
        operation: "removeRole",
        guildId: "7",
        userId: "8",
        roleId: "3",
      }),
    );
    assert.equal(role.method, "DELETE");
    assert.equal(role.path, "/guilds/7/members/8/roles/3");
    assert.deepEqual(buildRequest(parse({ resource: "guild", operation: "get", guildId: "7" })), {
      method: "GET",
      path: "/guilds/7",
      query: { with_counts: true },
    });
  });

  it("reads a webhook address", () => {
    assert.deepEqual(parseWebhookUrl("https://discordapp.com/api/v10/webhooks/1/a-b_c"), {
      id: "1",
      token: "a-b_c",
    });
    assert.equal(parseWebhookUrl("https://evil.example/api/webhooks/1/x"), null);
    assert.equal(parseWebhookUrl("http://discord.com/api/webhooks/1/x"), null);
  });
});

describe("discord node", () => {
  it("sends a message with the bot token", async () => {
    const calls = mockFetch([{ body: { id: "m1" } }]);
    const result = await run({ channelId: "9", content: "hi" });
    assert.deepEqual(result, { port: "out", data: { id: "m1" } });
    const headers = calls[0]?.init.headers as Record<string, string>;
    assert.equal(calls[0]?.url, "https://discord.com/api/v10/channels/9/messages");
    assert.equal(headers.authorization, "Bot B0T");
    assert.match(headers["user-agent"] ?? "", /^DiscordBot \(/);
    assert.deepEqual(JSON.parse(String(calls[0]?.init.body)), { content: "hi" });
  });

  it("gives success for a 204 answer and sends the audit log reason", async () => {
    const calls = mockFetch([{ status: 204 }]);
    const result = await run({
      resource: "member",
      operation: "kick",
      guildId: "1",
      userId: "2",
      reason: "spam & ads",
    });
    assert.deepEqual(result, { port: "out", data: { success: true } });
    const headers = calls[0]?.init.headers as Record<string, string>;
    assert.equal(headers["x-audit-log-reason"], "spam%20%26%20ads");
    assert.equal(calls[0]?.init.method, "DELETE");
  });

  it("executes a webhook without a bot token", async () => {
    const calls = mockFetch([{ body: { id: "m2" } }]);
    await run(
      {
        authentication: "webhook",
        resource: "webhook",
        operation: "execute",
        content: "hello",
        username: "Robot",
        avatarUrl: "https://x/a.png",
      },
      hook,
    );
    assert.equal(calls[0]?.url, "https://discord.com/api/v10/webhooks/123/S3CRET?wait=true");
    const headers = calls[0]?.init.headers as Record<string, string>;
    assert.equal(headers.authorization, undefined);
    assert.deepEqual(JSON.parse(String(calls[0]?.init.body)), {
      content: "hello",
      username: "Robot",
      avatar_url: "https://x/a.png",
    });
  });

  it("uploads files as a multipart form", async () => {
    const calls = mockFetch([{ body: { id: "m3" } }]);
    const input = {
      binary: {
        data: {
          data: Buffer.from("hello").toString("base64"),
          mimeType: "text/plain",
          fileName: "a.txt",
        },
      },
    };
    await run({ channelId: "9", content: "file", binaryData: true }, bot, input);
    const form = calls[0]?.init.body as FormData;
    assert.deepEqual(JSON.parse(String(form.get("payload_json"))), {
      content: "file",
      attachments: [{ id: 0, filename: "a.txt" }],
    });
    const file = form.get("files[0]") as File;
    assert.equal(file.name, "a.txt");
    assert.equal(await file.text(), "hello");
    const headers = calls[0]?.init.headers as Record<string, string>;
    assert.equal(headers["content-type"], undefined);
  });

  it("pages through messages with before", async () => {
    const page = (from: number, count: number) =>
      Array.from({ length: count }, (_, index) => ({ id: String(from - index) }));
    const calls = mockFetch([{ body: page(500, 100) }, { body: page(400, 20) }]);
    const result = await run({
      resource: "message",
      operation: "list",
      channelId: "9",
      returnAll: true,
    });
    assert.equal((result.data as unknown[]).length, 120);
    assert.equal(calls.length, 2);
    assert.match(calls[1]?.url ?? "", /limit=100&before=401/);
  });
});

describe("discord errors and rate limits", () => {
  const options = { signal, timeoutMs: 5_000 };

  it("waits retry_after on 429 and tries again", async () => {
    const calls = mockFetch([
      { status: 429, body: { message: "You are being rate limited.", retry_after: 0.01 } },
      { body: { id: "ok" } },
    ]);
    const data = await callDiscord("T", { method: "GET", path: "/users/@me" }, options);
    assert.deepEqual(data, { id: "ok" });
    assert.equal(calls.length, 2);
  });

  it("fails on a long rate limit, without the webhook token", async () => {
    mockFetch([{ status: 429, body: { retry_after: 120, global: true } }]);
    await assert.rejects(
      callDiscord(null, { method: "POST", path: "/webhooks/1/S3CRET", body: {} }, options),
      (error: Error) =>
        /rate limit.*120 s.*global/.test(error.message) && !error.message.includes("S3CRET"),
    );
  });

  it("stops after some tries", async () => {
    const calls = mockFetch(
      Array.from({ length: 5 }, () => ({ status: 429, body: { retry_after: 0.001 } })),
    );
    await assert.rejects(callDiscord("T", { method: "GET", path: "/x" }, options), /rate limit/);
    assert.equal(calls.length, 4);
  });

  it("shows the message, code, and first detail of an error", async () => {
    mockFetch([
      {
        status: 400,
        body: {
          code: 50035,
          message: "Invalid Form Body",
          errors: { embeds: { 0: { title: { _errors: [{ message: "Too long" }] } } } },
        },
      },
    ]);
    await assert.rejects(
      callDiscord("T", { method: "POST", path: "/channels/1/messages" }, options),
      /failed \(400\): Invalid Form Body \[code 50035\] \(embeds\.0\.title: Too long\)/,
    );
  });

  it("gives a hint for a missing permission", async () => {
    mockFetch([{ status: 403, body: { message: "Missing Permissions", code: 50013 } }]);
    await assert.rejects(
      callDiscord("T", { method: "DELETE", path: "/channels/1" }, options),
      /permission/,
    );
  });
});

describe("discord credentials", () => {
  it("tests a bot token with GET /users/@me", async () => {
    const calls = mockFetch([{ body: { id: "1" } }, { status: 401, body: { message: "401" } }]);
    await discordBotCredential.test?.({ ...bot, id: "c" } as never);
    assert.equal(calls[0]?.url, "https://discord.com/api/v10/users/@me");
    await assert.rejects(
      discordBotCredential.test?.({ ...bot, id: "c" } as never) ?? Promise.resolve(),
      /did not accept/,
    );
  });

  it("tests a webhook address", async () => {
    mockFetch([{ status: 404 }]);
    await assert.rejects(
      discordWebhookCredential.test?.({ ...hook, id: "c" } as never) ?? Promise.resolve(),
      /does not know/,
    );
  });
});

describe("discord trigger", () => {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const keyHex = publicKey.export({ format: "der", type: "spki" }).subarray(-32).toString("hex");
  const now = 1_700_000_000_000;
  const timestamp = String(now / 1000);

  const signed = (body: unknown, time = timestamp) => {
    const rawBody = JSON.stringify(body);
    const signature = sign(null, Buffer.from(time + rawBody), privateKey).toString("hex");
    return {
      headers: { "x-signature-ed25519": signature, "x-signature-timestamp": time },
      rawBody,
      body,
    };
  };
  const config = triggerConfig.parse({});

  it("verifies the signature", () => {
    const request = signed({ type: 1 });
    const base = {
      publicKey: keyHex,
      signature: request.headers["x-signature-ed25519"],
      timestamp,
      rawBody: request.rawBody,
      now,
    };
    assert.equal(verifyDiscordSignature(base), true);
    assert.equal(verifyDiscordSignature({ ...base, rawBody: '{"type":2}' }), false);
    assert.equal(verifyDiscordSignature({ ...base, signature: "00".repeat(64) }), false);
    assert.equal(verifyDiscordSignature({ ...base, signature: undefined }), false);
    assert.equal(verifyDiscordSignature({ ...base, now: now + 600_000 }), false);
    assert.equal(verifyDiscordSignature({ ...base, publicKey: "zz" }), false);
  });

  it("answers 401 for a bad signature", () => {
    const request = signed({ type: 1 });
    request.rawBody = '{"type":1 }';
    assert.deepEqual(checkInteraction(config, keyHex, request, now), {
      verdict: "forbidden",
      status: 401,
    });
  });

  it("answers PING with PONG", () => {
    assert.deepEqual(checkInteraction(config, keyHex, signed({ type: 1 }), now), {
      verdict: "ignore",
      response: { status: 200, body: { type: 1 } },
    });
  });

  it("starts the workflow for a slash command and defers", () => {
    const interaction = {
      id: "i1",
      type: 2,
      application_id: "app",
      token: "tok",
      channel_id: "c",
      member: { user: { id: "u" } },
      data: { name: "deploy", options: [{ name: "env", value: "prod" }] },
    };
    const verdict = checkInteraction(config, keyHex, signed(interaction), now);
    assert.equal(verdict.verdict, "accept");
    if (verdict.verdict !== "accept") return;
    assert.deepEqual(verdict.response, { status: 200, body: { type: 5 } });
    assert.equal(verdict.input.commandName, "deploy");
    assert.equal(verdict.input.applicationId, "app");
    assert.equal(verdict.input.token, "tok");
    assert.deepEqual(verdict.input.user, { id: "u" });
  });

  it("filters by type and name, and answers a button with a deferred update", () => {
    const only = triggerConfig.parse({ commandNames: "deploy", response: "deferredUpdate" });
    const other = signed({ type: 2, data: { name: "ping" } });
    assert.equal(checkInteraction(only, keyHex, other, now).verdict, "ignore");
    const modal = signed({ type: 5, data: { custom_id: "deploy" } });
    assert.equal(checkInteraction(only, keyHex, modal, now).verdict, "ignore");
    const button = checkInteraction(
      only,
      keyHex,
      signed({ type: 3, data: { custom_id: "deploy" } }),
      now,
    );
    assert.equal(button.verdict, "accept");
    if (button.verdict === "accept") assert.deepEqual(button.response.body, { type: 6 });
  });

  it("answers at once with a fixed private message", () => {
    const reply = triggerConfig.parse({
      response: "message",
      replyContent: "On it",
      ephemeral: true,
    });
    const verdict = checkInteraction(reply, keyHex, signed({ type: 2, data: { name: "x" } }), now);
    assert.equal(verdict.verdict, "accept");
    if (verdict.verdict === "accept") {
      assert.deepEqual(verdict.response.body, { type: 4, data: { content: "On it", flags: 64 } });
    }
  });

  const url = "https://z.example/hooks/abc";
  const credential = { ...bot, data: { ...bot.data, publicKey: keyHex } };
  const ctxOf = (config: Record<string, unknown>, state: unknown = null) =>
    ({
      config,
      credential,
      url,
      workflow: { id: "w", name: "w" },
      node: { id: "n", name: "n" },
      state,
      signal,
    }) as never;

  it("does not change the application by default", async () => {
    const trigger = def("trigger.discord");
    const calls = mockFetch([]);
    assert.equal(await trigger.webhook?.activate?.(ctxOf({})), null);
    assert.equal(await trigger.webhook?.deactivate?.(ctxOf({})), null);
    assert.equal(calls.length, 0);
  });

  it("sets the endpoint, and clears it only when this node set it", async () => {
    const trigger = def("trigger.discord");
    const calls = mockFetch([
      { body: {} },
      { body: { interactions_endpoint_url: url } },
      { body: {} },
    ]);
    const state = await trigger.webhook?.activate?.(ctxOf({ setEndpoint: true }));
    assert.deepEqual(state, { endpointUrl: url });
    assert.equal(calls[0]?.url, "https://discord.com/api/v10/applications/@me");
    assert.equal(calls[0]?.init.method, "PATCH");
    assert.deepEqual(JSON.parse(String(calls[0]?.init.body)), { interactions_endpoint_url: url });
    await trigger.webhook?.deactivate?.(ctxOf({ setEndpoint: true }, state));
    assert.equal(calls[1]?.init.method, "GET");
    assert.deepEqual(JSON.parse(String(calls[2]?.init.body)), { interactions_endpoint_url: null });
  });

  it("keeps an endpoint that the user changed", async () => {
    const trigger = def("trigger.discord");
    const calls = mockFetch([{ body: { interactions_endpoint_url: "https://other.example/x" } }]);
    await trigger.webhook?.deactivate?.(ctxOf({ setEndpoint: true }, { endpointUrl: url }));
    assert.equal(calls.length, 1);
    assert.equal(calls[0]?.init.method, "GET");
  });

  it("keeps an endpoint when no state says this node set it", async () => {
    const calls = mockFetch([]);
    await def("trigger.discord").webhook?.deactivate?.(ctxOf({ setEndpoint: true }));
    assert.equal(calls.length, 0);
  });
});
