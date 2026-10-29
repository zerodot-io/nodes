// SPDX-License-Identifier: AGPL-3.0-only
import assert from "node:assert/strict";
import { afterEach, describe, it, mock } from "node:test";
import type { NodeDefinition } from "@zerodot/node-sdk";
import {
  authHeader,
  callHiggsfield,
  callWithRetry,
  HiggsfieldError,
  outputUrls,
  waitForRequest,
} from "./api";
import { higgsfieldConfig } from "./config";
import { credentialTypes, nodes } from "./index";
import { bodyOf, buildRequest, modelPath } from "./request";

const signal = new AbortController().signal;
const options = { signal, timeoutMs: 5_000 };
const access = { keyId: "key-id", keySecret: "key-secret" };
const credential = { type: "higgsfield.account", data: access };
const ID = "d7e6c0f3-6699-4f6c-bb45-2ad7fd9158ff";
const noSleep = async () => {};

const def = (type: string): NodeDefinition => {
  const found = nodes.find((entry) => entry.type === type);
  if (!found) throw new Error(`no node ${type}`);
  return found;
};

type Call = { url: string; init: RequestInit };
type Answer = { body?: unknown; status?: number; headers?: Record<string, string> };

/** Answers the calls in order. The last answer repeats. */
function mockFetch(answers: Answer[], calls: Call[] = []) {
  mock.method(globalThis, "fetch", async (url: URL | string, init: RequestInit) => {
    calls.push({ url: String(url), init });
    const answer = answers[Math.min(calls.length, answers.length) - 1] ?? { body: {} };
    return new Response(answer.body === undefined ? null : JSON.stringify(answer.body), {
      status: answer.status ?? 200,
      headers: answer.headers,
    });
  });
  return calls;
}

const run = async (config: Record<string, unknown>) => {
  const definition = def("higgsfield.api");
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

const build = (config: Record<string, unknown>) => buildRequest(higgsfieldConfig.parse(config));

afterEach(() => mock.restoreAll());

describe("higgsfield config", () => {
  it("has a label and a hint for each operation", () => {
    const meta = higgsfieldConfig.shape.operation.meta() as {
      labels?: Record<string, string>;
      hints?: Record<string, string>;
    };
    for (const value of ["generate", "get", "cancel", "delete"]) {
      assert.ok(meta.labels?.[value], `${value} label`);
      assert.ok(meta.hints?.[value], `${value} hint`);
    }
  });
});

describe("higgsfield request", () => {
  it("posts the prompt to the model path", () => {
    const call = build({ model: "higgsfield-ai/soul/v2/standard", prompt: "A lake" });
    assert.equal(call.method, "POST");
    assert.equal(call.path, "/higgsfield-ai/soul/v2/standard");
    assert.deepEqual(call.body, { prompt: "A lake" });
  });

  it("puts the JSON fields over the prompt", () => {
    assert.deepEqual(bodyOf("A", '{"prompt":"B","duration":5}'), { prompt: "B", duration: 5 });
  });

  it("allows a body with no prompt", () => {
    assert.deepEqual(bodyOf("", '{"video_url":"https://x.test/a.mp4"}'), {
      video_url: "https://x.test/a.mp4",
    });
  });

  it("needs a prompt or parameters", () => {
    assert.throws(() => bodyOf("  ", undefined), /needs "prompt" or "parameters"/);
  });

  it("needs a JSON object", () => {
    assert.throws(() => bodyOf("", "{nope"), /must be JSON/);
    assert.throws(() => bodyOf("", "[1]"), /JSON object/);
  });

  it("accepts a model path and removes a leading slash", () => {
    assert.equal(
      modelPath("/kling-video/v2.5-turbo/pro/text-to-video"),
      "/kling-video/v2.5-turbo/pro/text-to-video",
    );
  });

  it("rejects a path that is not a model", () => {
    for (const bad of [
      "",
      "../requests",
      "a/../b",
      "a?x=1",
      "a#b",
      "https://evil.test/x",
      "requests/x",
      "v1/x",
      "a b",
    ]) {
      assert.throws(() => modelPath(bad), /model/, bad);
    }
  });

  it("builds get, cancel, and delete", () => {
    assert.deepEqual(build({ operation: "get", requestId: ID }), {
      method: "GET",
      path: `/requests/${ID}/status`,
    });
    assert.deepEqual(build({ operation: "cancel", requestId: ID }), {
      method: "POST",
      path: `/requests/${ID}/cancel`,
    });
    assert.deepEqual(build({ operation: "delete", requestId: ID }), {
      method: "DELETE",
      path: `/requests/${ID}`,
    });
  });

  it("rejects a request ID that is not an ID", () => {
    assert.throws(() => build({ operation: "get", requestId: "../x" }), /not an ID/);
    assert.throws(() => build({ operation: "get" }), /needs "requestId"/);
  });
});

describe("higgsfield api", () => {
  it("sends the Key header and a JSON body", async () => {
    const calls = mockFetch([{ body: { request_id: ID } }]);
    await callHiggsfield(access, { method: "POST", path: "/m/x", body: { prompt: "A" } }, options);
    const headers = calls[0]?.init.headers as Record<string, string>;
    assert.equal(calls[0]?.url, "https://api.higgsfield.ai/m/x");
    assert.equal(headers.authorization, authHeader(access));
    assert.equal(headers.authorization, "Key key-id:key-secret");
    assert.equal(headers["content-type"], "application/json");
    assert.equal(calls[0]?.init.body, '{"prompt":"A"}');
  });

  it("gives {} for an empty answer", async () => {
    mockFetch([{ status: 202 }]);
    assert.deepEqual(
      await callHiggsfield(access, { method: "POST", path: `/requests/${ID}/cancel` }, options),
      {},
    );
  });

  it("shows a text detail, a list detail, and an object detail", async () => {
    mockFetch([{ status: 401, body: { detail: "Invalid credentials" } }]);
    await assert.rejects(
      callHiggsfield(access, { method: "GET", path: "/requests/x/status" }, options),
      /Invalid credentials.*did not accept the API key/,
    );
    mock.restoreAll();
    mockFetch([
      { status: 422, body: { detail: [{ loc: ["body", "duration"], msg: "must be a number" }] } },
    ]);
    await assert.rejects(
      callHiggsfield(access, { method: "POST", path: "/m/x", body: { a: 1 } }, options),
      /duration: must be a number/,
    );
    mock.restoreAll();
    mockFetch([
      {
        status: 429,
        headers: { "retry-after": "30" },
        body: { detail: { code: "account_queue_full", message: "Too many queued generations" } },
      },
    ]);
    await assert.rejects(
      callHiggsfield(access, { method: "POST", path: "/m/x", body: { a: 1 } }, options),
      (error: unknown) =>
        error instanceof HiggsfieldError &&
        error.status === 429 &&
        error.retryAfter === 30 &&
        /Too many queued generations.*Try again in 30 seconds/.test(error.message),
    );
  });

  it("never puts the key in an error", async () => {
    mockFetch([{ status: 401, body: { detail: "bad" } }]);
    await assert.rejects(
      callHiggsfield(access, { method: "GET", path: "/requests/x/status" }, options),
      (error: unknown) => !String((error as Error).message).includes("key-secret"),
    );
  });

  it("tries a 503 again, and not a 401", async () => {
    const calls = mockFetch([{ status: 503, body: { detail: "busy" } }, { body: { ok: true } }]);
    const answer = await callWithRetry(
      access,
      { method: "GET", path: "/requests/x/status" },
      options,
      noSleep,
    );
    assert.deepEqual(answer, { ok: true });
    assert.equal(calls.length, 2);

    mock.restoreAll();
    const again = mockFetch([{ status: 401, body: { detail: "no" } }]);
    await assert.rejects(
      callWithRetry(access, { method: "GET", path: "/requests/x/status" }, options, noSleep),
      /401/,
    );
    assert.equal(again.length, 1);
  });

  it("stops after the retries", async () => {
    const calls = mockFetch([{ status: 500, body: { detail: "boom" } }]);
    await assert.rejects(
      callWithRetry(access, { method: "GET", path: "/requests/x/status" }, options, noSleep),
      /500/,
    );
    assert.equal(calls.length, 3);
  });

  it("waits until the status is done", async () => {
    const calls = mockFetch([
      { body: { status: "queued" } },
      { body: { status: "in_progress" } },
      { body: { status: "completed", video: { url: "https://cdn.test/v.mp4" } } },
    ]);
    const result = await waitForRequest(access, ID, {
      ...options,
      waitTimeoutMs: 60_000,
      sleep: noSleep,
    });
    assert.equal(result.status, "completed");
    assert.equal(calls.length, 3);
    assert.equal(calls[0]?.url, `https://api.higgsfield.ai/requests/${ID}/status`);
  });

  it("stops waiting at the timeout", async () => {
    mockFetch([{ body: { status: "in_progress" } }]);
    await assert.rejects(
      waitForRequest(access, ID, { ...options, waitTimeoutMs: 1_000, sleep: noSleep }),
      /did not finish.*in_progress.*Get/,
    );
  });

  it("collects the URLs of the files", () => {
    assert.deepEqual(
      outputUrls({
        status: "completed",
        status_url: "https://api.higgsfield.ai/requests/x/status",
        images: [{ url: "https://cdn.test/1.jpg" }, { url: "https://cdn.test/2.jpg" }],
        video: { url: "https://cdn.test/v.mp4" },
        audio: { url: "https://cdn.test/a.mp3" },
        audios: [{ url: "https://cdn.test/a.mp3" }],
      }),
      [
        "https://cdn.test/1.jpg",
        "https://cdn.test/2.jpg",
        "https://cdn.test/v.mp4",
        "https://cdn.test/a.mp3",
      ],
    );
  });
});

describe("higgsfield node", () => {
  it("generates, waits, and gives the URLs", async () => {
    const calls = mockFetch([
      { body: { status: "queued", request_id: ID } },
      { body: { status: "completed", request_id: ID, video: { url: "https://cdn.test/v.mp4" } } },
    ]);
    const result = await run({ model: "m/video", prompt: "A", idempotencyKey: "my-key" });
    const headers = calls[0]?.init.headers as Record<string, string>;
    assert.equal(headers["idempotency-key"], "my-key");
    assert.deepEqual(result, {
      port: "out",
      data: {
        status: "completed",
        request_id: ID,
        video: { url: "https://cdn.test/v.mp4" },
        urls: ["https://cdn.test/v.mp4"],
      },
    });
  });

  it("makes a random idempotency key when the field is empty", async () => {
    const calls = mockFetch([{ body: { status: "queued", request_id: ID } }]);
    await run({ model: "m/video", prompt: "A", wait: false });
    const headers = calls[0]?.init.headers as Record<string, string>;
    assert.match(headers["idempotency-key"] ?? "", /^[0-9a-f-]{36}$/);
  });

  it("gives the submit answer when wait is off", async () => {
    const calls = mockFetch([{ body: { status: "queued", request_id: ID } }]);
    const result = await run({ model: "m/video", prompt: "A", wait: false });
    assert.equal(calls.length, 1);
    assert.deepEqual(result, { port: "out", data: { status: "queued", request_id: ID } });
  });

  it("fails when the request ends as failed or nsfw", async () => {
    mockFetch([
      { body: { status: "queued", request_id: ID } },
      { body: { status: "failed", error: "Generation failed" } },
    ]);
    await assert.rejects(
      run({ model: "m/video", prompt: "A" }),
      /ended as "failed": Generation failed/,
    );
    mock.restoreAll();
    mockFetch([{ body: { status: "queued", request_id: ID } }, { body: { status: "nsfw" } }]);
    await assert.rejects(run({ model: "m/video", prompt: "A" }), /ended as "nsfw"/);
  });

  it("fails when there is no request_id", async () => {
    mockFetch([{ body: { status: "queued" } }]);
    await assert.rejects(run({ model: "m/video", prompt: "A" }), /no request_id/);
  });

  it("gets a request with its URLs", async () => {
    mockFetch([{ body: { status: "completed", images: [{ url: "https://cdn.test/1.jpg" }] } }]);
    const result = await run({ operation: "get", requestId: ID });
    assert.deepEqual(result, {
      port: "out",
      data: {
        status: "completed",
        images: [{ url: "https://cdn.test/1.jpg" }],
        urls: ["https://cdn.test/1.jpg"],
      },
    });
  });

  it("cancels and says that it worked", async () => {
    const calls = mockFetch([{ status: 202 }]);
    const result = await run({ operation: "cancel", requestId: ID });
    assert.equal(calls[0]?.init.method, "POST");
    assert.deepEqual(result, { port: "out", data: { success: true } });
  });

  it("deletes request data", async () => {
    const calls = mockFetch([{ body: { request_id: ID, status: "deleted" } }]);
    const result = await run({ operation: "delete", requestId: ID });
    assert.equal(calls[0]?.init.method, "DELETE");
    assert.deepEqual(result, { port: "out", data: { request_id: ID, status: "deleted" } });
  });

  it("needs a Higgsfield credential", async () => {
    const definition = def("higgsfield.api");
    await assert.rejects(
      async () =>
        definition.run({
          config: definition.config.parse({ model: "m/x", prompt: "A" }),
          input: null,
          credential: null,
          signal,
          scope: {},
          tables: null,
          sandbox: null,
        } as never),
      /Higgsfield credential/,
    );
  });
});

describe("higgsfield credential", () => {
  it("passes when the API says the request is not found", async () => {
    const calls = mockFetch([{ status: 404, body: { detail: "Not found" } }]);
    await credentialTypes[0]?.test?.(credential as never);
    assert.match(calls[0]?.url ?? "", /\/requests\/0{8}-0{4}-0{4}-0{4}-0{12}\/status$/);
  });

  it("fails when the API does not accept the key", async () => {
    mockFetch([{ status: 401, body: { detail: "Invalid credentials" } }]);
    await assert.rejects(
      credentialTypes[0]?.test?.(credential as never) ?? Promise.resolve(),
      /401/,
    );
  });

  it("does not take a key ID with a colon", () => {
    const fields = credentialTypes[0]?.fields;
    assert.equal(fields?.safeParse({ keyId: "a:b", keySecret: "s" }).success, false);
    assert.equal(fields?.safeParse({ keyId: "ab", keySecret: "s" }).success, true);
  });
});
