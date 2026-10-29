// SPDX-License-Identifier: AGPL-3.0-only
import assert from "node:assert/strict";
import { afterEach, describe, it, mock } from "node:test";
import type { NodeDefinition } from "@zerodot/node-sdk";
import { feedbackjarAccess } from "./api";
import { feedbackjarConfig } from "./config";
import { feedbackjarCredential } from "./credential";
import { credentialTypes, nodes } from "./index";
import { buildRequest } from "./request";
import { feedbackjarSignature, signatureValid } from "./trigger";

const signal = new AbortController().signal;
type Cred = { type: string; data: Record<string, unknown> };
const project: Cred = { type: "feedbackjar.token", data: { apiToken: "fj_live_secret" } };
const account: Cred = {
  type: "feedbackjar.token",
  data: { apiToken: "fj_user_secret", organizationId: "org1" },
};

const def = (type: string): NodeDefinition => {
  const found = nodes.find((entry) => entry.type === type);
  if (!found) throw new Error(`no node ${type}`);
  return found;
};

type Call = { url: string; init: RequestInit };

/** Answers the calls in order. */
function mockFetch(answers: { body?: unknown; status?: number }[], calls: Call[] = []) {
  mock.method(globalThis, "fetch", async (url: URL | string, init: RequestInit) => {
    calls.push({ url: String(url), init });
    const answer = answers[calls.length - 1] ?? {};
    return new Response(answer.status === 204 ? null : JSON.stringify(answer.body ?? {}), {
      status: answer.status ?? 200,
    });
  });
  return calls;
}

const run = async (config: Record<string, unknown>, credential: Cred = project) => {
  const definition = def("feedbackjar.api");
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

const parse = (c: Record<string, unknown>) => feedbackjarConfig.parse(c);

describe("feedbackjar package", () => {
  it("exports the nodes and the credential", () => {
    assert.deepEqual(nodes.map((node) => node.type).sort(), [
      "feedbackjar.api",
      "trigger.feedbackjar",
    ]);
    assert.equal(credentialTypes[0]?.type, "feedbackjar.token");
  });
});

describe("feedbackjar config and request", () => {
  it("checks that the operation belongs to the resource", () => {
    assert.equal(
      feedbackjarConfig.safeParse({ resource: "vote", operation: "getAll" }).success,
      false,
    );
    assert.equal(
      feedbackjarConfig.safeParse({ resource: "tag", operation: "getAll" }).success,
      true,
    );
  });

  it("builds the calls of posts", () => {
    assert.deepEqual(
      buildRequest(
        parse({
          resource: "post",
          operation: "create",
          boardId: "b1",
          title: "T",
          content: "C",
          postType: "BUG",
          onBehalfOfEmail: "a@b.co",
          notifyAuthor: false,
        }),
      ),
      {
        method: "POST",
        path: "/posts",
        body: {
          boardId: "b1",
          title: "T",
          content: "C",
          type: "BUG",
          onBehalfOfEmail: "a@b.co",
          notifyAuthor: false,
        },
      },
    );
    assert.deepEqual(buildRequest(parse({ resource: "post", operation: "get", postId: "p/1" })), {
      method: "GET",
      path: "/posts/p%2F1",
    });
    assert.deepEqual(
      buildRequest(
        parse({ resource: "post", operation: "updateStatus", postId: "p1", status: "COMPLETED" }),
      ),
      { method: "PATCH", path: "/posts/p1/status", body: { status: "COMPLETED" } },
    );
    assert.deepEqual(
      buildRequest(parse({ resource: "post", operation: "setTags", postId: "p1", tagIds: "a, b" })),
      { method: "PUT", path: "/posts/p1/tags", body: { tagIds: ["a", "b"] } },
    );
    assert.deepEqual(
      buildRequest(parse({ resource: "post", operation: "merge", postId: "p1", targetId: "p2" })),
      { method: "POST", path: "/posts/p1/merge", body: { targetId: "p2" } },
    );
    assert.deepEqual(
      buildRequest(parse({ resource: "post", operation: "search", query: "dark", searchLimit: 5 })),
      { method: "GET", path: "/posts/search", query: { q: "dark", limit: 5 } },
    );
  });

  it("sends notifyAuthor only when it is false and a person is set", () => {
    const request = buildRequest(
      parse({
        resource: "post",
        operation: "create",
        boardId: "b",
        title: "T",
        content: "C",
        notifyAuthor: false,
      }),
    );
    assert.equal("notifyAuthor" in (request.body ?? {}), false);
  });

  it("builds the calls of comments, votes, boards, tags, and organizations", () => {
    assert.deepEqual(
      buildRequest(
        parse({ resource: "comment", operation: "create", postId: "p1", content: "Hi" }),
      ),
      { method: "POST", path: "/posts/p1/comments", body: { content: "Hi" } },
    );
    assert.deepEqual(
      buildRequest(parse({ resource: "comment", operation: "getAll", postId: "p1" })),
      {
        method: "GET",
        path: "/posts/p1/comments",
      },
    );
    assert.deepEqual(
      buildRequest(parse({ resource: "vote", operation: "create", postId: "p1", email: "a@b.co" })),
      { method: "POST", path: "/posts/p1/votes", body: { email: "a@b.co" } },
    );
    assert.equal(buildRequest(parse({ resource: "board", operation: "getAll" })).path, "/boards");
    assert.equal(buildRequest(parse({ resource: "tag", operation: "getAll" })).path, "/tags");
    assert.equal(
      buildRequest(parse({ resource: "organization", operation: "getAll" })).path,
      "/organizations",
    );
  });

  it("names a missing field", () => {
    assert.throws(
      () => buildRequest(parse({ resource: "post", operation: "get" })),
      /"postId" is needed to post.get/,
    );
    assert.throws(
      () => buildRequest(parse({ resource: "post", operation: "update", postId: "p1" })),
      /field to change/,
    );
  });
});

describe("feedbackjar.api", () => {
  it("sends the token and gives the answer", async () => {
    const calls = mockFetch([{ body: { id: "p1", title: "T" } }]);
    const result = await run({ resource: "post", operation: "get", postId: "p1" });
    assert.deepEqual(result, { port: "out", data: { id: "p1", title: "T" } });
    assert.equal(calls[0]?.url, "https://api.feedbackjar.com/api/v1/posts/p1");
    const headers = calls[0]?.init.headers as Record<string, string>;
    assert.equal(headers.authorization, "Bearer fj_live_secret");
    assert.equal(headers["x-organization-id"], undefined);
  });

  it("sends the project ID of an account token", async () => {
    const calls = mockFetch([{ body: [] }]);
    await run({ resource: "board", operation: "getAll" }, account);
    const headers = calls[0]?.init.headers as Record<string, string>;
    assert.equal(headers["x-organization-id"], "org1");
  });

  it("needs a project ID for an account token, but not to list projects", async () => {
    const bare: Cred = { type: "feedbackjar.token", data: { apiToken: "fj_user_x" } };
    await assert.rejects(run({ resource: "board", operation: "getAll" }, bare), /organizationId/);
    const calls = mockFetch([{ body: [{ id: "org1" }] }]);
    const result = await run({ resource: "organization", operation: "getAll" }, bare);
    assert.deepEqual(result, { port: "out", data: [{ id: "org1" }] });
    assert.equal(calls[0]?.url, "https://api.feedbackjar.com/api/v1/organizations");
  });

  it("sends a JSON body", async () => {
    const calls = mockFetch([{ status: 201, body: { id: "p9" } }]);
    await run({
      resource: "post",
      operation: "create",
      boardId: "b1",
      title: "T",
      content: "C",
    });
    assert.equal(calls[0]?.init.method, "POST");
    assert.deepEqual(JSON.parse(String(calls[0]?.init.body)), {
      boardId: "b1",
      title: "T",
      content: "C",
    });
  });

  it("follows the cursor and stops at the limit", async () => {
    const calls = mockFetch([
      { body: { items: [{ id: 1 }, { id: 2 }], nextCursor: "c2" } },
      { body: { items: [{ id: 3 }, { id: 4 }], nextCursor: null } },
    ]);
    const result = (await run({
      resource: "post",
      operation: "getAll",
      filterStatus: "OPEN",
      returnAll: true,
    })) as { data: unknown[] };
    assert.equal(result.data.length, 4);
    assert.equal(calls.length, 2);
    const first = new URL(calls[0]?.url ?? "");
    assert.equal(first.searchParams.get("status"), "OPEN");
    assert.equal(first.searchParams.get("limit"), "100");
    assert.equal(new URL(calls[1]?.url ?? "").searchParams.get("cursor"), "c2");

    mock.restoreAll();
    mockFetch([{ body: { items: [{ id: 1 }, { id: 2 }, { id: 3 }], nextCursor: "x" } }]);
    const limited = (await run({ resource: "post", operation: "getAll", limit: 2 })) as {
      data: unknown[];
    };
    assert.equal(limited.data.length, 2);
  });

  it("gives an error text without the token", async () => {
    mockFetch([{ status: 403, body: { error: "Missing permission: posts:write" } }]);
    await assert.rejects(
      run({ resource: "post", operation: "merge", postId: "a", targetId: "b" }),
      (error: Error) =>
        /failed \(403\): Missing permission: posts:write/.test(error.message) &&
        !error.message.includes("fj_live_secret"),
    );
  });
});

describe("feedbackjar credential", () => {
  it("reads the token, the project ID, and the address", () => {
    assert.throws(() => feedbackjarAccess(null), /needs a FeedbackJar credential/);
    assert.deepEqual(
      feedbackjarAccess({
        type: "feedbackjar.token",
        data: { apiToken: "fj_live_x", server: "http://localhost:3000/api/v1/" },
      }),
      { token: "fj_live_x", baseUrl: "http://localhost:3000/api/v1", organizationId: undefined },
    );
  });

  it("tests the token", async () => {
    const calls = mockFetch([{ body: [] }]);
    await feedbackjarCredential.test?.({ ...project, id: "c", name: "c" } as never);
    assert.equal(calls[0]?.url, "https://api.feedbackjar.com/api/v1/boards");
    mockFetch([{ status: 401 }]);
    await assert.rejects(
      feedbackjarCredential.test?.({ ...project, id: "c", name: "c" } as never) ??
        Promise.resolve(),
      /did not accept/,
    );
  });
});

describe("trigger.feedbackjar", () => {
  const url = "https://zerodot.example/hooks/tok123";
  const secret = "whsec_test";
  const config = { events: ["post.created", "comment.created"] };
  const receive = (
    body: unknown,
    headers: Record<string, string>,
    options: { signed?: boolean; credential?: Cred | null } = {},
  ) => {
    const rawBody = JSON.stringify(body);
    const now = Math.floor(Date.now() / 1000);
    return def("trigger.feedbackjar").webhook?.receive({
      config,
      credential: (options.credential === undefined
        ? { type: "feedbackjar.token", data: { apiToken: "t", signingSecret: secret } }
        : options.credential) as never,
      url,
      workflow: { id: "w", name: "w" },
      node: { id: "n", name: "n" },
      state: null,
      signal,
      request: {
        method: "POST",
        headers: {
          ...(options.signed === false
            ? {}
            : { "x-feedbackjar-signature": feedbackjarSignature(secret, now, rawBody) }),
          ...headers,
        },
        query: {},
        body,
        rawBody,
      },
    });
  };
  const created = {
    event: "post.created",
    createdAt: "2026-07-04T10:00:00.000Z",
    data: { postId: "p1", title: "Dark mode", status: "OPEN", boardId: "b1" },
  };

  it("accepts a signed event of the list", async () => {
    assert.deepEqual(await receive(created, { "x-feedbackjar-event": "post.created" }), {
      verdict: "accept",
      input: { event: "post.created", createdAt: created.createdAt, data: created.data },
    });
  });

  it("refuses a missing, wrong, or old signature", async () => {
    const headers = { "x-feedbackjar-event": "post.created" };
    assert.deepEqual(await receive(created, headers, { signed: false }), {
      verdict: "forbidden",
      status: 403,
    });
    assert.deepEqual(
      await receive(created, { ...headers, "x-feedbackjar-signature": "t=1,v1=00" }),
      { verdict: "forbidden", status: 403 },
    );
    const body = JSON.stringify(created);
    const old = Math.floor(Date.now() / 1000) - 3600;
    assert.equal(signatureValid(secret, body, feedbackjarSignature(secret, old, body)), false);
  });

  it("skips the check when the credential has no secret", async () => {
    const result = await receive(
      created,
      { "x-feedbackjar-event": "post.created" },
      { signed: false, credential: { type: "feedbackjar.token", data: { apiToken: "t" } } },
    );
    assert.equal(result?.verdict, "accept");
  });

  it("ignores other events and answers a test event", async () => {
    assert.deepEqual(
      await receive({ event: "tag.created" }, { "x-feedbackjar-event": "tag.created" }),
      {
        verdict: "ignore",
      },
    );
    assert.deepEqual(
      await receive({ event: "webhook.test" }, { "x-feedbackjar-event": "webhook.test" }),
      { verdict: "ignore", response: { status: 200, body: { ok: true } } },
    );
  });

  const hookContext = (state: unknown = null) =>
    ({
      config,
      credential: project,
      url,
      workflow: { id: "w", name: "w" },
      node: { id: "n", name: "n" },
      state,
      signal,
    }) as never;

  it("makes the webhook and keeps the secret", async () => {
    const calls = mockFetch([
      {
        body: [
          { id: "old", url },
          { id: "other", url: "https://x.example/a" },
        ],
      },
      { body: { success: true } },
      { status: 201, body: { id: "h1", url, secret: "whsec_new" } },
    ]);
    const state = await def("trigger.feedbackjar").webhook?.activate?.(hookContext());
    assert.deepEqual(state, { hookId: "h1", secret: "whsec_new" });
    assert.deepEqual(
      calls.map((call) => `${call.init.method} ${new URL(call.url).pathname}`),
      ["GET /api/v1/webhooks", "DELETE /api/v1/webhooks/old", "POST /api/v1/webhooks"],
    );
    assert.deepEqual(JSON.parse(String(calls[2]?.init.body)), {
      url,
      description: "zerodot",
      events: ["post.created", "comment.created"],
      signatureVerificationEnabled: true,
    });
  });

  it("sends every event for All Events", async () => {
    const calls = mockFetch([{ body: [] }, { status: 201, body: { id: "h1", secret: "s" } }]);
    await def("trigger.feedbackjar").webhook?.activate?.({
      ...(hookContext() as object),
      config: { events: ["*"] },
    } as never);
    const events = JSON.parse(String(calls[1]?.init.body)).events as string[];
    assert.equal(events.length, 9);
    assert.ok(!events.includes("*"));
  });

  it("removes the webhook, and a missing one is fine", async () => {
    const calls = mockFetch([{ status: 404, body: { error: "not found" } }]);
    const result = await def("trigger.feedbackjar").webhook?.deactivate?.(
      hookContext({ hookId: "h1", secret: "s" }),
    );
    assert.equal(result, null);
    assert.equal(calls[0]?.init.method, "DELETE");
  });

  it("checks the signature with the secret that activate kept", async () => {
    const body = { event: "post.created", createdAt: "2026-07-04T10:00:00.000Z", data: {} };
    const rawBody = JSON.stringify(body);
    const now = Math.floor(Date.now() / 1000);
    const send = (key: string) =>
      def("trigger.feedbackjar").webhook?.receive({
        ...(hookContext({ hookId: "h1", secret: "whsec_new" }) as object),
        credential: project,
        request: {
          method: "POST",
          headers: {
            "x-feedbackjar-event": "post.created",
            "x-feedbackjar-signature": feedbackjarSignature(key, now, rawBody),
          },
          query: {},
          body,
          rawBody,
        },
      } as never);
    assert.equal((await send("whsec_new"))?.verdict, "accept");
    assert.equal((await send("whsec_other"))?.verdict, "forbidden");
  });
});
