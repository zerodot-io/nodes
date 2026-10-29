// SPDX-License-Identifier: AGPL-3.0-only
import assert from "node:assert/strict";
import { afterEach, describe, it, mock } from "node:test";
import type { NodeDefinition } from "@zerodot/node-sdk";
import { linearConfig } from "./config";
import { linearOAuth2 } from "./credential";
import { credentialTypes, nodes } from "./index";
import { buildRequest } from "./request";
import { linearSecret, linearSignature, verifyLinearRequest } from "./trigger";

const signal = new AbortController().signal;
type Cred = { type: string; data: Record<string, unknown> };
const apiKey: Cred = { type: "linear.apiKey", data: { apiKey: "lin_api_secret" } };

const def = (type: string): NodeDefinition => {
  const found = nodes.find((entry) => entry.type === type);
  if (!found) throw new Error(`no node ${type}`);
  return found;
};

type Call = { url: string; init: RequestInit };

/** Answers the calls in order with a GraphQL answer. */
function mockFetch(answers: { body?: unknown; status?: number }[], calls: Call[] = []) {
  mock.method(globalThis, "fetch", async (url: URL | string, init: RequestInit) => {
    calls.push({ url: String(url), init });
    const answer = answers[calls.length - 1] ?? {};
    return new Response(JSON.stringify(answer.body ?? { data: {} }), {
      status: answer.status ?? 200,
    });
  });
  return calls;
}

const auth = (call: Call | undefined) =>
  (call?.init.headers as Record<string, string> | undefined)?.authorization;

const sent = (call: Call | undefined) =>
  JSON.parse(String(call?.init.body)) as { query: string; variables: Record<string, unknown> };

const run = async (type: string, config: Record<string, unknown>, credential: Cred = apiKey) => {
  const definition = def(type);
  return await definition.run({
    config: definition.config.parse(config),
    input: null,
    credential,
    signal,
    scope: {},
    tables: null,
    sandbox: null,
  } as never);
};

afterEach(() => mock.restoreAll());

describe("linear config and request", () => {
  it("checks that the operation belongs to the resource", () => {
    assert.equal(linearConfig.safeParse({ resource: "team", operation: "create" }).success, false);
    assert.equal(linearConfig.safeParse({ resource: "issue", operation: "archive" }).success, true);
  });

  it("builds the create call of an issue", () => {
    const request = buildRequest(
      linearConfig.parse({
        resource: "issue",
        operation: "create",
        teamId: "t1",
        title: "T",
        priority: "2",
        labelIds: "a, b",
      }),
    );
    assert.deepEqual(request.variables, {
      input: { teamId: "t1", title: "T", priority: 2, labelIds: ["a", "b"] },
    });
    assert.equal(request.result, "issueCreate.issue");
  });

  it("needs a title and a team to create an issue", () => {
    assert.throws(
      () => buildRequest(linearConfig.parse({ resource: "issue", operation: "create" })),
      /teamId/,
    );
  });

  it("builds the filter of a list of issues", () => {
    const request = buildRequest(
      linearConfig.parse({
        resource: "issue",
        operation: "getAll",
        teamId: "t1",
        search: "bug",
        filter: '{"labels":{"name":{"eq":"x"}}}',
      }),
    );
    assert.equal(request.connection, "issues");
    assert.deepEqual(request.variables, {
      filter: {
        team: { id: { eq: "t1" } },
        title: { containsIgnoreCase: "bug" },
        labels: { name: { eq: "x" } },
      },
    });
  });

  it("rejects a filter that is not a JSON object", () => {
    assert.throws(
      () =>
        buildRequest(linearConfig.parse({ resource: "issue", operation: "getAll", filter: "[]" })),
      /JSON object/,
    );
  });

  it("builds the calls of the other resources", () => {
    const parse = (c: Record<string, unknown>) => buildRequest(linearConfig.parse(c));
    assert.equal(
      parse({ resource: "comment", operation: "getAll", issueId: "ENG-1" }).connection,
      "issue.comments",
    );
    assert.equal(parse({ resource: "team", operation: "getAll" }).connection, "teams");
    assert.equal(parse({ resource: "user", operation: "getAll" }).connection, "users");
    assert.deepEqual(parse({ resource: "cycle", operation: "getAll", teamId: "t1" }).variables, {
      filter: { team: { id: { eq: "t1" } } },
    });
    assert.deepEqual(
      parse({ resource: "project", operation: "create", name: "P", teamIds: "a,b" }).variables,
      { input: { name: "P", teamIds: ["a", "b"] } },
    );
  });
});

describe("linear node", () => {
  it("sends an API key as it is", async () => {
    const calls = mockFetch([{ body: { data: { issue: { id: "i1" } } } }]);
    const out = await run("linear.api", { resource: "issue", operation: "get", issueId: "ENG-1" });
    assert.deepEqual(out, { port: "out", data: { id: "i1" } });
    assert.equal(calls[0]?.url, "https://api.linear.app/graphql");
    assert.equal(auth(calls[0]), "lin_api_secret");
    assert.deepEqual(sent(calls[0]).variables, { id: "ENG-1" });
  });

  it("sends an OAuth2 token with Bearer", async () => {
    const calls = mockFetch([{ body: { data: { teams: { nodes: [], pageInfo: {} } } } }]);
    await run(
      "linear.api",
      { authentication: "oAuth2", resource: "team", operation: "getAll" },
      { type: "linear.oauth2", data: { accessToken: "tok" } },
    );
    assert.equal(auth(calls[0]), "Bearer tok");
  });

  it("follows the cursors of a list", async () => {
    const calls = mockFetch([
      {
        body: {
          data: {
            teams: {
              nodes: [{ id: 1 }, { id: 2 }],
              pageInfo: { hasNextPage: true, endCursor: "c1" },
            },
          },
        },
      },
      { body: { data: { teams: { nodes: [{ id: 3 }], pageInfo: { hasNextPage: false } } } } },
    ]);
    const out = await run("linear.api", { resource: "team", operation: "getAll", returnAll: true });
    assert.deepEqual(out, { port: "out", data: [{ id: 1 }, { id: 2 }, { id: 3 }] });
    assert.equal(calls.length, 2);
    assert.equal(sent(calls[0]).variables.after, null);
    assert.equal(sent(calls[1]).variables.after, "c1");
  });

  it("stops at the limit", async () => {
    const calls = mockFetch([
      {
        body: {
          data: {
            teams: {
              nodes: [{ id: 1 }, { id: 2 }],
              pageInfo: { hasNextPage: true, endCursor: "c1" },
            },
          },
        },
      },
    ]);
    const out = await run("linear.api", { resource: "team", operation: "getAll", limit: 1 });
    assert.deepEqual(out, { port: "out", data: [{ id: 1 }] });
    assert.equal(calls.length, 1);
    assert.equal(sent(calls[0]).variables.first, 1);
  });

  it("lists the comments of an issue through the nested path", async () => {
    mockFetch([
      { body: { data: { issue: { comments: { nodes: [{ id: "c" }], pageInfo: {} } } } } },
    ]);
    const out = await run("linear.api", { resource: "comment", operation: "getAll", issueId: "i" });
    assert.deepEqual(out, { port: "out", data: [{ id: "c" }] });
  });

  it("returns success for archive and delete", async () => {
    mockFetch([{ body: { data: { issueArchive: { success: true } } } }]);
    assert.deepEqual(
      await run("linear.api", { resource: "issue", operation: "archive", issueId: "i" }),
      { port: "out", data: { success: true } },
    );
    mockFetch([{ body: { data: { issueDelete: { success: true } } } }]);
    assert.deepEqual(
      await run("linear.api", {
        resource: "issue",
        operation: "delete",
        issueId: "i",
        permanent: true,
      }),
      { port: "out", data: { success: true } },
    );
  });

  it("shows GraphQL errors without the key", async () => {
    mockFetch([
      { body: { errors: [{ message: "Entity not found" }] }, status: 200 },
      { body: { errors: [{ message: "slow", extensions: { code: "RATELIMITED" } }] }, status: 400 },
    ]);
    const get = { resource: "issue", operation: "get", issueId: "x" };
    await assert.rejects(run("linear.api", get), (error: Error) => {
      assert.match(error.message, /Entity not found/);
      assert.ok(!error.message.includes("lin_api_secret"));
      return true;
    });
    await assert.rejects(run("linear.api", get), /rate limit/);
  });

  it("needs a Linear credential", async () => {
    await assert.rejects(
      run("linear.api", { resource: "team", operation: "getAll" }, { type: "other", data: {} }),
      /needs a Linear credential/,
    );
    await assert.rejects(
      run(
        "linear.api",
        { resource: "team", operation: "getAll" },
        { type: "linear.apiKey", data: {} },
      ),
      /apiKey/,
    );
  });
});

describe("linear credentials", () => {
  it("has OAuth2 settings for Linear", () => {
    assert.deepEqual(linearOAuth2({}), {
      authUrl: "https://linear.app/oauth/authorize",
      tokenUrl: "https://api.linear.app/oauth/token",
      scopes: ["read", "write"],
      authentication: "body",
      pkce: true,
    });
    assert.deepEqual(linearOAuth2({ scope: "read,issues:create" }).scopes, [
      "read",
      "issues:create",
    ]);
  });

  it("tests a credential with the viewer query", async () => {
    const calls = mockFetch([{ body: { data: { viewer: { id: "u" } } } }]);
    const credential = credentialTypes.find((entry) => entry.type === "linear.apiKey");
    await credential?.test?.({ ...apiKey, id: "c", name: "n" } as never);
    assert.match(sent(calls[0]).query, /viewer/);
  });
});

describe("linear trigger", () => {
  const url = "https://zerodot.example/hooks/abc";
  const trigger = def("trigger.linear");
  const webhook = trigger.webhook as Required<NonNullable<NodeDefinition["webhook"]>>;
  const body = (extra: Record<string, unknown> = {}) => ({
    action: "create",
    type: "Issue",
    data: { id: "i1" },
    webhookTimestamp: Date.now(),
    ...extra,
  });
  const receive = async (
    payload: Record<string, unknown>,
    config: Record<string, unknown> = {},
    signature?: string,
  ) => {
    const rawBody = JSON.stringify(payload);
    return await webhook.receive({
      config: trigger.config.parse(config),
      request: {
        rawBody,
        body: payload,
        headers: {
          "linear-signature": signature ?? linearSignature(url, rawBody),
          "linear-delivery": "d1",
        },
      },
      url,
    } as never);
  };

  it("verifies the signature and the timestamp", () => {
    const raw = JSON.stringify(body());
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const signature = linearSignature(url, raw);
    const now = Number(parsed.webhookTimestamp);
    assert.equal(verifyLinearRequest(url, raw, signature, parsed, now), true);
    assert.equal(verifyLinearRequest(url, raw, signature, parsed, now + 61_000), false);
    assert.equal(verifyLinearRequest(url, raw, "00", parsed, now), false);
    assert.equal(verifyLinearRequest(url, raw, undefined, parsed, now), false);
    assert.equal(verifyLinearRequest(url, `${raw} `, signature, parsed, now), false);
    assert.notEqual(linearSecret(url), linearSecret(`${url}x`));
  });

  it("accepts a signed event", async () => {
    const result = await receive(body());
    assert.equal(result?.verdict, "accept");
    if (result?.verdict === "accept") {
      assert.deepEqual(
        { ...(result.input as Record<string, unknown>), body: undefined },
        { event: "Issue", action: "create", delivery: "d1", body: undefined },
      );
    }
  });

  it("rejects a bad signature and an old timestamp", async () => {
    assert.deepEqual(await receive(body(), {}, "abc"), { verdict: "forbidden", status: 403 });
    assert.deepEqual(await receive(body({ webhookTimestamp: Date.now() - 120_000 })), {
      verdict: "forbidden",
      status: 403,
    });
  });

  it("ignores other types and actions", async () => {
    assert.deepEqual(await receive(body({ type: "Comment" })), { verdict: "ignore" });
    assert.deepEqual(await receive(body(), { actions: ["remove"] }), { verdict: "ignore" });
    assert.equal(
      (await receive(body({ type: "Comment" }), { resourceTypes: ["Comment"] }))?.verdict,
      "accept",
    );
  });

  it("makes a webhook for all public teams", async () => {
    const calls = mockFetch([
      { body: { data: { webhooks: { nodes: [{ id: "w0", url: "https://other" }] } } } },
      { body: { data: { webhookCreate: { success: true, webhook: { id: "w1" } } } } },
    ]);
    const state = await webhook.activate({
      config: trigger.config.parse({ resourceTypes: ["Issue", "Comment"] }),
      credential: apiKey,
      url,
      signal,
    } as never);
    assert.deepEqual(state, { hookId: "w1" });
    const input = sent(calls[1]).variables.input as Record<string, unknown>;
    assert.equal(input.url, url);
    assert.equal(input.allPublicTeams, true);
    assert.equal(input.secret, linearSecret(url));
    assert.deepEqual(input.resourceTypes, ["Issue", "Comment"]);
  });

  it("updates a webhook that has this address", async () => {
    const calls = mockFetch([
      { body: { data: { webhooks: { nodes: [{ id: "w9", url }] } } } },
      { body: { data: { webhookUpdate: { success: true } } } },
    ]);
    const state = await webhook.activate({
      config: trigger.config.parse({ teamId: "t1" }),
      credential: apiKey,
      url,
      signal,
    } as never);
    assert.deepEqual(state, { hookId: "w9" });
    assert.equal(sent(calls[1]).variables.id, "w9");
  });

  it("removes the webhook, and allows one that is gone", async () => {
    const calls = mockFetch([{ body: { data: { webhookDelete: { success: true } } } }]);
    await webhook.deactivate({
      config: trigger.config.parse({}),
      credential: apiKey,
      url,
      state: { hookId: "w1" },
      signal,
    } as never);
    assert.equal(sent(calls[0]).variables.id, "w1");
    mockFetch([{ body: { errors: [{ message: "Entity not found" }] } }]);
    assert.equal(
      await webhook.deactivate({
        config: trigger.config.parse({}),
        credential: apiKey,
        url,
        state: { hookId: "w1" },
        signal,
      } as never),
      null,
    );
  });
});
