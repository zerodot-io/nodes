// SPDX-License-Identifier: AGPL-3.0-only
import assert from "node:assert/strict";
import { afterEach, describe, it, mock } from "node:test";
import type { NodeDefinition } from "@zerodot/node-sdk";
import { callGraph, formBody, GraphError } from "./api";
import { metaConfig } from "./config";
import { nodes } from "./index";
import {
  buildContainerStatus,
  buildCreateContainer,
  buildCreateThreadsContainer,
  buildFacebookPublish,
  buildPublishContainer,
  buildQuota,
} from "./request";
import { checkMetaWebhook, metaSignature, triggerConfig, verifyMetaRequest } from "./trigger";

const signal = new AbortController().signal;
const options = { signal, timeoutMs: 5_000 };
type Cred = { type: string; data: Record<string, unknown> };
const credential: Cred = {
  type: "meta.api",
  data: { accessToken: "EAAG-secret", appSecret: "shh" },
};
const pageCredential: Cred = {
  type: "meta.api",
  data: { accessToken: "EAAP-page-token" },
};

const def = (type: string): NodeDefinition => {
  const found = nodes.find((entry) => entry.type === type);
  if (!found) throw new Error(`no node ${type}`);
  return found;
};

type Call = { url: string; init: RequestInit };
type Answer = { body?: unknown; status?: number };

/** Answers the calls in order. */
function mockFetch(answers: Answer[], calls: Call[] = []) {
  mock.method(globalThis, "fetch", async (url: URL | string, init: RequestInit) => {
    calls.push({ url: String(url), init });
    const answer = answers[calls.length - 1] ?? { body: {} };
    return new Response(JSON.stringify(answer.body ?? {}), {
      status: answer.status ?? 200,
    });
  });
  return calls;
}

const bodyOf = (call: Call | undefined) =>
  Object.fromEntries(new URLSearchParams(String(call?.init.body)));

/** The call at the index, or a failure. */
const callOf = (calls: Call[], index: number): Call => {
  const call = calls[index];
  assert.ok(call);
  return call;
};

const run = async (config: Record<string, unknown>, cred: Cred = credential) => {
  const definition = def("meta.api");
  return await definition.run({
    config: definition.config.parse(config),
    input: null,
    credential: cred,
    signal,
    scope: {},
    tables: null,
    sandbox: null,
  } as never);
};

const build = (config: Record<string, unknown>) => buildCreateContainer(metaConfig.parse(config));

afterEach(() => mock.restoreAll());

describe("meta config", () => {
  it("checks that the operation belongs to the resource", () => {
    assert.equal(
      metaConfig.safeParse({ resource: "facebook", operation: "getQuota" }).success,
      false,
    );
    assert.equal(
      metaConfig.safeParse({ resource: "facebook", operation: "publish" }).success,
      true,
    );
  });

  it("has a label and a hint for each option of each select", () => {
    const shape = metaConfig.shape;
    for (const key of [
      "resource",
      "operation",
      "instagramMediaType",
      "facebookMediaType",
      "threadsMediaType",
    ] as const) {
      const meta = (
        shape[key] as {
          meta: () => { labels?: Record<string, string>; hints?: Record<string, string> };
        }
      ).meta();
      const options = Object.keys(meta.labels ?? {});
      assert.ok(options.length > 0, `${key} options`);
      for (const option of options) {
        assert.ok(meta.labels?.[option], `${key}.${option} label`);
        assert.ok(meta.hints?.[option], `${key}.${option} hint`);
      }
    }
  });
});

describe("meta requests", () => {
  it("builds a reel container", () => {
    const request = build({
      resource: "instagram",
      operation: "publish",
      instagramUserId: "17841400000000",
      instagramMediaType: "reel",
      mediaUrl: "https://example.com/video.mp4",
      caption: "Hello",
      shareToFeed: true,
    });
    assert.equal(request.path, "/17841400000000/media");
    assert.equal(request.params.media_type, "REELS");
    assert.equal(request.params.video_url, "https://example.com/video.mp4");
    assert.equal(request.params.share_to_feed, true);
  });

  it("rejects a reel without a media URL", () => {
    assert.throws(
      () =>
        build({
          resource: "instagram",
          operation: "publish",
          instagramUserId: "1",
          instagramMediaType: "reel",
        }),
      /mediaUrl/,
    );
  });

  it("builds a carousel with children", () => {
    const request = build({
      resource: "instagram",
      operation: "publish",
      instagramUserId: "1",
      instagramMediaType: "carousel",
      childrenUrls: "https://a/1.jpg, https://b/2.jpg",
      caption: "Round",
    });
    assert.equal(request.params.media_type, "CAROUSEL_ALBUM");
    assert.equal(request.params.children, "https://a/1.jpg,https://b/2.jpg");
  });

  it("rejects a carousel with one item", () => {
    assert.throws(() =>
      build({
        resource: "instagram",
        operation: "publish",
        instagramUserId: "1",
        instagramMediaType: "carousel",
        childrenUrls: "https://a/1.jpg",
      }),
    );
  });

  it("builds a Threads text container", () => {
    const request = buildCreateThreadsContainer(
      metaConfig.parse({
        resource: "threads",
        operation: "publish",
        threadsUserId: "123",
        threadsMediaType: "text",
        text: "Hello",
      }),
    );
    assert.equal(request.host, "graph.threads.net");
    assert.equal(request.path, "/123/threads");
    assert.equal(request.params.media_type, "TEXT");
  });

  it("builds a Facebook photo post", () => {
    const request = buildFacebookPublish(
      metaConfig.parse({
        resource: "facebook",
        operation: "publish",
        pageId: "112233",
        facebookMediaType: "photo",
        mediaUrl: "https://example.com/pic.jpg",
        caption: "Look",
      }),
    );
    assert.equal(request.path, "/112233/photos");
    assert.equal(request.params.url, "https://example.com/pic.jpg");
  });

  it("rejects a Facebook text post without text", () => {
    assert.throws(
      () =>
        buildFacebookPublish(
          metaConfig.parse({
            resource: "facebook",
            operation: "publish",
            pageId: "112233",
            facebookMediaType: "text",
          }),
        ),
      /text/,
    );
  });

  it("builds the status and the publish calls", () => {
    const c = metaConfig.parse({
      resource: "instagram",
      operation: "checkContainer",
      apiVersion: "v23.0",
      instagramUserId: "17841400000000",
    });
    const status = buildContainerStatus(c, "12345");
    assert.equal(status.path, "/12345");
    assert.equal(status.params.fields, "id,status_code,status");
    const publish = buildPublishContainer(c, "12345");
    assert.equal(publish.path, "/17841400000000/media_publish");
    assert.equal(publish.params.creation_id, "12345");
    const quota = buildQuota(
      metaConfig.parse({ resource: "instagram", operation: "getQuota", instagramUserId: "1" }),
    );
    assert.equal(quota.path, "/1/content_publishing_limit");
  });
});

describe("meta api", () => {
  it("sends the token in the body of a POST", async () => {
    const calls = mockFetch([{ body: { id: "1" } }]);
    await callGraph(
      { token: "secret" },
      {
        host: "graph.facebook.com",
        version: "v23.0",
        path: "/1/media",
        method: "POST",
        params: { media_type: "IMAGE" },
      },
      options,
    );
    const url = new URL(callOf(calls, 0).url);
    assert.equal(url.host, "graph.facebook.com");
    assert.equal(url.pathname, "/v23.0/1/media");
    assert.ok(!url.href.includes("secret"));
    assert.equal(bodyOf(callOf(calls, 0)).access_token, "secret");
  });

  it("sends the token in the query of a GET", async () => {
    const calls = mockFetch([{ body: { id: "1" } }]);
    await callGraph(
      { token: "secret" },
      {
        host: "graph.facebook.com",
        version: "v23.0",
        path: "/me",
        method: "GET",
        params: { fields: "id" },
      },
      options,
    );
    assert.ok(calls[0]?.url.includes("access_token=secret"));
  });

  it("throws a GraphError with a hint for a bad token", async () => {
    mockFetch([
      {
        status: 401,
        body: {
          error: { message: "Invalid OAuth access token", type: "OAuthException", code: 190 },
        },
      },
    ]);
    await assert.rejects(
      callGraph(
        { token: "bad" },
        { host: "graph.facebook.com", version: "v23.0", path: "/me", method: "GET", params: {} },
        options,
      ),
      (error: unknown) => {
        assert.ok(error instanceof GraphError);
        assert.equal(error.code, "190");
        assert.match(error.message, /long-lived token/);
        return true;
      },
    );
  });

  it("leaves empty params out of the form", () => {
    const form = formBody({ a: "1", b: undefined, c: "", d: true });
    assert.equal(form.get("a"), "1");
    assert.equal(form.get("b"), null);
    assert.equal(form.get("c"), null);
    assert.equal(form.get("d"), "true");
  });
});

describe("meta node", () => {
  it("publishes a reel in three steps", async () => {
    const calls = mockFetch([
      { body: { id: "container-1" } },
      { body: { id: "container-1", status_code: "IN_PROGRESS" } },
      { body: { id: "container-1", status_code: "FINISHED" } },
      { body: { id: "post-1" } },
    ]);
    const result = await run({
      resource: "instagram",
      operation: "publish",
      instagramUserId: "17841400000000",
      instagramMediaType: "reel",
      mediaUrl: "https://example.com/video.mp4",
      pollIntervalMs: 1000,
      maxWaitMs: 10_000,
    });
    assert.deepEqual(result, { port: "out", data: { containerId: "container-1", id: "post-1" } });
    assert.equal(calls.length, 4);
    assert.match(callOf(calls, 0).url, /\/v23\.0\/17841400000000\/media/);
    assert.match(callOf(calls, 1).url, /\/container-1\?/);
    assert.match(callOf(calls, 3).url, /\/media_publish/);
    assert.equal(bodyOf(callOf(calls, 3)).creation_id, "container-1");
  });

  it("stops on a failed container", async () => {
    mockFetch([
      { body: { id: "container-2" } },
      { body: { id: "container-2", status_code: "ERROR" } },
    ]);
    await assert.rejects(
      run({
        resource: "instagram",
        operation: "publish",
        instagramUserId: "1",
        instagramMediaType: "reel",
        mediaUrl: "https://example.com/video.mp4",
      }),
      /failed with status "ERROR"/,
    );
  });

  it("publishes a text to a Facebook Page", async () => {
    const calls = mockFetch([{ body: { id: "99_11" } }]);
    const result = await run(
      {
        resource: "facebook",
        operation: "publish",
        pageId: "112233",
        facebookMediaType: "text",
        text: "Hello world",
      },
      pageCredential,
    );
    assert.deepEqual(result, { port: "out", data: { id: "99_11" } });
    assert.equal(bodyOf(callOf(calls, 0)).message, "Hello world");
  });

  it("publishes a Threads text post in two steps", async () => {
    const calls = mockFetch([{ body: { id: "t-container" } }, { body: { id: "t-post" } }]);
    const result = await run({
      resource: "threads",
      operation: "publish",
      threadsUserId: "123",
      threadsMediaType: "text",
      text: "Hello",
    });
    assert.deepEqual(result, { port: "out", data: { containerId: "t-container", id: "t-post" } });
    assert.match(callOf(calls, 1).url, /graph\.threads\.net/);
    assert.equal(bodyOf(callOf(calls, 1)).creation_id, "t-container");
  });

  it("gets the quota", async () => {
    const calls = mockFetch([{ body: { config: {}, quota_total: 50, quota_usage: 10 } }]);
    const result = await run({
      resource: "instagram",
      operation: "getQuota",
      instagramUserId: "17841400000000",
    });
    assert.equal((result.data as Record<string, unknown>).quota_total, 50);
    assert.match(callOf(calls, 0).url, /content_publishing_limit/);
  });
});

describe("meta trigger", () => {
  const secret = "app-secret";
  const rawBody = JSON.stringify({
    object: "instagram",
    entry: [{ id: "17841400000000", changes: [{ field: "comments", value: { text: "Nice" } }] }],
  });
  const signed = (body: string) => ({
    headers: { "x-hub-signature-256": metaSignature(secret, body) },
    rawBody: body,
  });
  const config = triggerConfig.parse({ object: "instagram", fields: ["comments"] });

  it("signs the body the way Meta does", () => {
    assert.match(metaSignature(secret, "hello"), /^sha256=[0-9a-f]{64}$/);
    assert.equal(verifyMetaRequest(secret, signed("hello")), true);
    assert.equal(verifyMetaRequest("other", signed("hello")), false);
  });

  it("accepts a signed event", () => {
    const verdict = checkMetaWebhook(config, JSON.parse(rawBody));
    assert.equal(verdict.verdict, "accept");
    if (verdict.verdict === "accept") {
      const input = verdict.input as { object: string; entry: unknown[] };
      assert.equal(input.object, "instagram");
      assert.equal(input.entry.length, 1);
    }
  });

  it("rejects a wrong signature", () => {
    assert.equal(verifyMetaRequest("wrong", signed("hello")), false);
  });

  it("ignores another object and other fields", () => {
    const body = JSON.parse(rawBody);
    assert.equal(checkMetaWebhook(config, { ...body, object: "page" }).verdict, "ignore");
    const mentions = {
      object: "instagram",
      entry: [{ changes: [{ field: "mentions" }] }],
    };
    assert.equal(checkMetaWebhook(config, mentions).verdict, "ignore");
    const all = triggerConfig.parse({ object: "instagram", fields: ["*"] });
    assert.equal(checkMetaWebhook(all, mentions).verdict, "accept");
  });

  it("answers the challenge only with the right verify token", async () => {
    const trigger = def("trigger.meta");
    const ask = async (query: Record<string, string>) => {
      const verdict = await trigger.webhook?.receive({
        config,
        credential,
        url: "https://example/hooks/abc",
        workflow: { id: "1", name: "w" },
        node: { id: "1", name: "n" },
        state: null,
        signal,
        request: { method: "GET", headers: {}, query, body: null, rawBody: "" },
      } as never);
      assert.ok(verdict);
      return verdict;
    };
    const good = await ask({
      "hub.mode": "subscribe",
      "hub.challenge": "1234",
      "hub.verify_token": "shh",
    });
    if (good.verdict !== "ignore") throw new Error(`wrong verdict ${good.verdict}`);
    assert.deepEqual((good.response as { body: string }).body, "1234");
    const bad = await ask({
      "hub.mode": "subscribe",
      "hub.challenge": "1234",
      "hub.verify_token": "wrong",
    });
    assert.equal(bad.verdict, "forbidden");
  });

  it("accepts a messaging event as the messages field", () => {
    const body = {
      object: "instagram",
      entry: [{ id: "1", messaging: { sender: { id: "2" } } }],
    };
    const messages = triggerConfig.parse({ object: "instagram", fields: ["messages"] });
    assert.equal(checkMetaWebhook(messages, body).verdict, "accept");
  });
});
