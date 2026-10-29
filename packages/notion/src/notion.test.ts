// SPDX-License-Identifier: AGPL-3.0-only
import assert from "node:assert/strict";
import { afterEach, describe, it, mock } from "node:test";
import type { NodeDefinition } from "@zerodot/node-sdk";
import { callNotion, callNotionList, NOTION_VERSION, NotionError } from "./api";
import { notionConfig } from "./config";
import { credentialTypes, nodes } from "./index";
import { blockOf, buildRequest } from "./request";
import { plainText, simplifyItem } from "./simplify";
import trigger, { keyOf, minuteOf, pollBody } from "./trigger";

const signal = new AbortController().signal;
const options = { signal, timeoutMs: 5_000 };
const access = { token: "secret-token" };
type Cred = { type: string; data: Record<string, unknown> };
const credential: Cred = { type: "notion.integration", data: { token: "secret-token" } };
const ID = "0123456789abcdef0123456789abcdef";
const DASHED = "01234567-89ab-cdef-0123-456789abcdef";

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
    const answer = answers[calls.length - 1] ?? { body: {} };
    return new Response(JSON.stringify(answer.body ?? {}), {
      status: answer.status ?? 200,
      headers: answer.headers,
    });
  });
  return calls;
}

const bodyOf = (call: Call | undefined) => JSON.parse(String(call?.init.body));

const run = async (config: Record<string, unknown>) => {
  const definition = def("notion.api");
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

const build = (config: Record<string, unknown>) => buildRequest(notionConfig.parse(config));

afterEach(() => mock.restoreAll());

describe("notion config", () => {
  it("checks that the operation belongs to the resource", () => {
    assert.equal(notionConfig.safeParse({ resource: "user", operation: "query" }).success, false);
    assert.equal(notionConfig.safeParse({ resource: "user", operation: "list" }).success, true);
  });

  it("has a label and a hint for each option of each select", () => {
    const options: Record<string, readonly string[]> = {
      resource: ["search", "page", "database", "block", "user"],
      operation: [
        "search",
        "get",
        "create",
        "update",
        "archive",
        "query",
        "createRow",
        "getDataSource",
        "getChildren",
        "append",
        "delete",
        "list",
      ],
      searchObject: ["all", "page", "dataSource"],
      blockType: [
        "paragraph",
        "heading_1",
        "heading_2",
        "heading_3",
        "bulleted_list_item",
        "numbered_list_item",
        "to_do",
        "toggle",
        "quote",
        "callout",
        "code",
        "divider",
      ],
    };
    for (const [key, values] of Object.entries(options)) {
      const meta = (notionConfig.shape as Record<string, { meta(): unknown }>)[key]?.meta() as {
        labels?: Record<string, string>;
        hints?: Record<string, string>;
      };
      for (const value of values) {
        assert.ok(meta.labels?.[value], `${key}.${value} label`);
        assert.ok(meta.hints?.[value], `${key}.${value} hint`);
      }
    }
  });
});

describe("notion request", () => {
  it("searches with an object filter", () => {
    const { call, list } = build({ query: " Roadmap ", searchObject: "dataSource" });
    assert.equal(call.method, "POST");
    assert.equal(call.path, "/v1/search");
    assert.equal(list, true);
    assert.deepEqual(call.body, {
      query: "Roadmap",
      filter: { property: "object", value: "data_source" },
    });
    assert.equal(build({}).call.body?.filter, undefined);
  });

  it("checks that an ID is an ID, and accepts hyphens", () => {
    assert.throws(
      () => build({ resource: "page", operation: "get", pageId: "../users" }),
      /not an ID/,
    );
    assert.throws(() => build({ resource: "page", operation: "get" }), /pageId/);
    const { call } = build({ resource: "page", operation: "get", pageId: DASHED });
    assert.equal(call.path, `/v1/pages/${ID}`);
  });

  it("creates a page with a title and blocks", () => {
    const block = { type: "paragraph", paragraph: { rich_text: [] } };
    const { call } = build({
      resource: "page",
      operation: "create",
      parentPageId: ID,
      title: "Notes",
      children: JSON.stringify([block]),
    });
    assert.equal(call.path, "/v1/pages");
    assert.deepEqual(call.body, {
      parent: { page_id: ID },
      properties: { title: { title: [{ text: { content: "Notes" } }] } },
      children: [block],
    });
    assert.throws(
      () => build({ resource: "page", operation: "create", parentPageId: ID }),
      /title/,
    );
  });

  it("updates and archives a page", () => {
    const update = build({
      resource: "page",
      operation: "update",
      pageId: ID,
      properties: '{"Done":{"checkbox":true}}',
    });
    assert.equal(update.call.method, "PATCH");
    assert.deepEqual(update.call.body, { properties: { Done: { checkbox: true } } });
    assert.throws(
      () => build({ resource: "page", operation: "update", pageId: ID, properties: "[1]" }),
      /JSON object/,
    );
    const archive = build({ resource: "page", operation: "archive", pageId: ID });
    assert.deepEqual(archive.call.body, { in_trash: true });
  });

  it("queries a data source with a filter and sorts", () => {
    const { call, list } = build({
      resource: "database",
      operation: "query",
      dataSourceId: ID,
      filter: '{"property":"Status","select":{"equals":"Done"}}',
      sorts: '[{"property":"Name","direction":"ascending"}]',
    });
    assert.equal(list, true);
    assert.equal(call.path, `/v1/data_sources/${ID}/query`);
    assert.deepEqual(call.body, {
      filter: { property: "Status", select: { equals: "Done" } },
      sorts: [{ property: "Name", direction: "ascending" }],
    });
    assert.throws(
      () => build({ resource: "database", operation: "query", dataSourceId: ID, sorts: "{}" }),
      /JSON array/,
    );
  });

  it("creates a row below a data source", () => {
    const { call } = build({
      resource: "database",
      operation: "createRow",
      dataSourceId: ID,
      properties: '{"Name":{"title":[{"text":{"content":"Task"}}]}}',
    });
    assert.equal(call.path, "/v1/pages");
    assert.deepEqual(call.body?.parent, { type: "data_source_id", data_source_id: ID });
    assert.throws(
      () => build({ resource: "database", operation: "createRow", dataSourceId: ID }),
      /properties/,
    );
  });

  it("appends blocks, and can set the position", () => {
    const children = '[{"type":"divider","divider":{}}]';
    const end = build({ resource: "block", operation: "append", blockId: ID, children });
    assert.equal(end.call.method, "PATCH");
    assert.equal(end.call.path, `/v1/blocks/${ID}/children`);
    assert.equal(end.call.body?.position, undefined);
    const after = build({
      resource: "block",
      operation: "append",
      blockId: ID,
      children,
      afterBlockId: DASHED,
    });
    assert.deepEqual(after.call.body?.position, { type: "after_block", after_block: { id: ID } });
    assert.throws(() => build({ resource: "block", operation: "append", blockId: ID }), /children/);
    const many = JSON.stringify(Array.from({ length: 101 }, () => ({})));
    assert.throws(
      () => build({ resource: "block", operation: "append", blockId: ID, children: many }),
      /at most 100/,
    );
  });

  it("gets children, deletes a block, and lists users", () => {
    const children = build({ resource: "block", operation: "getChildren", blockId: ID });
    assert.equal(children.list, true);
    assert.equal(children.call.path, `/v1/blocks/${ID}/children`);
    const del = build({ resource: "block", operation: "delete", blockId: ID });
    assert.equal(del.call.method, "DELETE");
    const users = build({ resource: "user", operation: "list" });
    assert.equal(users.call.path, "/v1/users");
    assert.equal(users.list, true);
  });
});

describe("notion api", () => {
  it("sends the token, the version, and a JSON body", async () => {
    const calls = mockFetch([{ body: { id: "p1" } }]);
    const answer = await callNotion(
      access,
      { method: "POST", path: "/v1/pages", body: { a: 1 } },
      options,
    );
    assert.deepEqual(answer, { id: "p1" });
    assert.equal(calls[0]?.url, "https://api.notion.com/v1/pages");
    const headers = calls[0]?.init.headers as Record<string, string>;
    assert.equal(headers.authorization, "Bearer secret-token");
    assert.equal(headers["notion-version"], NOTION_VERSION);
    assert.equal(headers["content-type"], "application/json");
    assert.deepEqual(bodyOf(calls[0]), { a: 1 });
  });

  it("puts the query of a GET in the address", async () => {
    const calls = mockFetch([{ body: {} }]);
    await callNotion(
      access,
      { method: "GET", path: "/v1/users", query: { page_size: 5, start_cursor: "" } },
      options,
    );
    assert.equal(calls[0]?.url, "https://api.notion.com/v1/users?page_size=5");
    assert.equal(calls[0]?.init.body, undefined);
  });

  it("gives an error with the code, a hint, and no token", async () => {
    mockFetch([
      { status: 404, body: { code: "object_not_found", message: "Could not find page." } },
    ]);
    await assert.rejects(
      callNotion(access, { method: "GET", path: "/v1/pages/x" }, options),
      (error: unknown) => {
        assert.ok(error instanceof NotionError);
        assert.equal(error.code, "object_not_found");
        assert.equal(error.status, 404);
        assert.match(error.message, /Share the page/);
        assert.doesNotMatch(error.message, /secret-token/);
        return true;
      },
    );
  });

  it("reports a rate limit with the wait", async () => {
    mockFetch([{ status: 429, headers: { "retry-after": "7" } }]);
    await assert.rejects(
      callNotion(access, { method: "GET", path: "/v1/users" }, options),
      (error: unknown) => {
        assert.ok(error instanceof NotionError);
        assert.equal(error.retryAfter, 7);
        assert.match(error.message, /7 seconds/);
        return true;
      },
    );
  });

  it("follows the cursor of a POST until the limit", async () => {
    const calls = mockFetch([
      { body: { results: [{ id: "1" }, { id: "2" }], has_more: true, next_cursor: "c2" } },
      { body: { results: [{ id: "3" }, { id: "4" }], has_more: false, next_cursor: null } },
    ]);
    const items = await callNotionList(
      access,
      { method: "POST", path: "/v1/search", body: { query: "a" } },
      3,
      options,
    );
    assert.deepEqual(items, [{ id: "1" }, { id: "2" }, { id: "3" }]);
    assert.deepEqual(bodyOf(calls[0]), { query: "a", page_size: 3 });
    assert.deepEqual(bodyOf(calls[1]), { query: "a", start_cursor: "c2", page_size: 1 });
  });

  it("follows the cursor of a GET in the query", async () => {
    const calls = mockFetch([
      { body: { results: [{ id: "1" }], has_more: true, next_cursor: "c2" } },
      { body: { results: [{ id: "2" }], has_more: false, next_cursor: null } },
    ]);
    const items = await callNotionList(access, { method: "GET", path: "/v1/users" }, null, options);
    assert.deepEqual(items, [{ id: "1" }, { id: "2" }]);
    assert.equal(calls[0]?.url, "https://api.notion.com/v1/users?page_size=100");
    assert.equal(calls[1]?.url, "https://api.notion.com/v1/users?start_cursor=c2&page_size=100");
  });
});

describe("notion node", () => {
  it("creates a row", async () => {
    const calls = mockFetch([{ body: { id: "p1", object: "page" } }]);
    const result = await run({
      resource: "database",
      operation: "createRow",
      dataSourceId: ID,
      simplify: false,
      properties: '{"Name":{"title":[{"text":{"content":"Task"}}]}}',
    });
    assert.deepEqual(result, { port: "out", data: { id: "p1", object: "page" } });
    assert.equal(calls[0]?.init.method, "POST");
  });

  it("lists with a limit", async () => {
    mockFetch([{ body: { results: [{ id: "u1" }, { id: "u2" }], has_more: false } }]);
    const result = await run({ resource: "user", operation: "list", limit: 1, simplify: false });
    assert.deepEqual(result, { port: "out", data: [{ id: "u1" }] });
  });

  it("gives the simple form by default", async () => {
    mockFetch([
      {
        body: {
          results: [
            {
              object: "page",
              id: "p1",
              url: "https://notion.so/p1",
              created_time: "t1",
              last_edited_time: "t2",
              properties: {
                Name: { type: "title", title: [{ plain_text: "Task" }] },
                Done: { type: "checkbox", checkbox: true },
              },
            },
          ],
          has_more: false,
        },
      },
    ]);
    const result = await run({ resource: "database", operation: "query", dataSourceId: ID });
    assert.deepEqual(result, {
      port: "out",
      data: [
        {
          id: "p1",
          url: "https://notion.so/p1",
          created_time: "t1",
          last_edited_time: "t2",
          in_trash: false,
          properties: { Name: "Task", Done: true },
        },
      ],
    });
  });

  it("needs a Notion credential", async () => {
    const definition = def("notion.api");
    await assert.rejects(
      Promise.resolve(
        definition.run({
          config: definition.config.parse({}),
          credential: null,
          signal,
        } as never),
      ),
      /Notion credential/,
    );
  });
});

describe("notion credential", () => {
  it("tests the token against the bot user", async () => {
    const calls = mockFetch([{ body: { object: "user" } }]);
    await credentialTypes[0]?.test?.(credential as never);
    assert.equal(calls[0]?.url, "https://api.notion.com/v1/users/me");
    await assert.rejects(
      credentialTypes[0]?.test?.({ type: "notion.integration", data: {} } as never) ??
        Promise.resolve(),
      /no "token"/,
    );
  });
});

describe("notion more operations", () => {
  it("lists data sources, gets one, gets a block, and gets a user", () => {
    const list = build({ resource: "database", operation: "list", query: "Tasks" });
    assert.deepEqual(list.call.body, {
      query: "Tasks",
      filter: { property: "object", value: "data_source" },
    });
    assert.equal(list.list, true);
    const source = build({ resource: "database", operation: "getDataSource", dataSourceId: ID });
    assert.equal(source.call.path, `/v1/data_sources/${ID}`);
    assert.equal(
      build({ resource: "block", operation: "get", blockId: ID }).call.path,
      `/v1/blocks/${ID}`,
    );
    assert.equal(
      build({ resource: "user", operation: "get", userId: ID }).call.path,
      `/v1/users/${ID}`,
    );
    assert.throws(() => build({ resource: "user", operation: "get" }), /userId/);
  });

  it("joins the time filters and the JSON filter with AND", () => {
    const only = build({
      resource: "database",
      operation: "query",
      dataSourceId: ID,
      filters: { editedAfter: "2026-01-01" },
    });
    assert.deepEqual(only.call.body?.filter, {
      timestamp: "last_edited_time",
      last_edited_time: { after: "2026-01-01" },
    });
    const both = build({
      resource: "database",
      operation: "query",
      dataSourceId: ID,
      filter: '{"property":"Done","checkbox":{"equals":true}}',
      filters: { createdBefore: "2026-02-01" },
    });
    assert.deepEqual(both.call.body?.filter, {
      and: [
        { property: "Done", checkbox: { equals: true } },
        { timestamp: "created_time", created_time: { before: "2026-02-01" } },
      ],
    });
  });

  it("makes a block of a type from text", () => {
    assert.deepEqual(blockOf("to_do", "Buy"), {
      object: "block",
      type: "to_do",
      to_do: { rich_text: [{ type: "text", text: { content: "Buy" } }], checked: false },
    });
    assert.deepEqual(blockOf("divider", ""), { object: "block", type: "divider", divider: {} });
    const long = blockOf("paragraph", "a".repeat(2001)).paragraph as { rich_text: unknown[] };
    assert.equal(long.rich_text.length, 2);
    const { call } = build({
      resource: "block",
      operation: "append",
      blockId: ID,
      blockType: "heading_2",
      text: "Title",
    });
    assert.equal((call.body?.children as { type: string }[] | undefined)?.[0]?.type, "heading_2");
    const json = build({
      resource: "block",
      operation: "append",
      blockId: ID,
      text: "ignored",
      children: '[{"type":"divider","divider":{}}]',
    });
    assert.deepEqual(json.call.body?.children, [{ type: "divider", divider: {} }]);
    const divider = build({
      resource: "block",
      operation: "append",
      blockId: ID,
      blockType: "divider",
    });
    assert.equal(
      (divider.call.body?.children as { type: string }[] | undefined)?.[0]?.type,
      "divider",
    );
  });
});

describe("notion simplify", () => {
  it("simplifies the property types", () => {
    const page = simplifyItem({
      object: "page",
      id: "p1",
      properties: {
        Tags: { type: "multi_select", multi_select: [{ name: "a" }, { name: "b" }] },
        Status: { type: "status", status: { name: "Open" } },
        Empty: { type: "select", select: null },
        Owner: { type: "people", people: [{ person: { email: "a@b.test" } }] },
        Count: { type: "formula", formula: { type: "number", number: 3 } },
        Ticket: { type: "unique_id", unique_id: { prefix: "T", number: 7 } },
        Link: { type: "relation", relation: [{ id: "r1" }] },
      },
    }) as { properties: Record<string, unknown> };
    assert.deepEqual(page.properties, {
      Tags: ["a", "b"],
      Status: "Open",
      Empty: null,
      Owner: ["a@b.test"],
      Count: 3,
      Ticket: "T-7",
      Link: ["r1"],
    });
  });

  it("simplifies blocks and users", () => {
    assert.deepEqual(
      simplifyItem({
        object: "block",
        id: "b1",
        type: "to_do",
        has_children: false,
        to_do: { rich_text: [{ plain_text: "Buy " }, { plain_text: "milk" }], checked: true },
      }),
      { id: "b1", type: "to_do", has_children: false, text: "Buy milk", checked: true },
    );
    assert.deepEqual(
      simplifyItem({
        object: "user",
        id: "u1",
        type: "person",
        name: "Ada",
        person: { email: "a@b.test" },
      }),
      { id: "u1", type: "person", name: "Ada", email: "a@b.test", avatar_url: null },
    );
    assert.equal(plainText(undefined), "");
    assert.equal(simplifyItem("x"), "x");
  });
});

describe("notion trigger", () => {
  const page = { id: "p1", created_time: "2026-01-01T10:15:00.000Z", last_edited_time: "t2" };
  const poll = async (
    cursor: unknown,
    firstPoll: boolean,
    config: Record<string, unknown> = {},
  ) => {
    const poller = trigger.poll;
    assert.ok(poller);
    return await poller({
      config: trigger.config.parse({ dataSourceId: ID, ...config }),
      credential,
      cursor,
      firstPoll,
      signal,
    } as never);
  };

  it("is a poll trigger", () => {
    assert.equal(trigger.category, "trigger");
    assert.equal(typeof trigger.poll, "function");
    assert.equal(nodes[0]?.type, "trigger.notion");
  });

  it("rounds down to a minute and builds the query", () => {
    assert.equal(minuteOf(new Date("2026-01-01T10:15:42.123Z")), "2026-01-01T10:15:00.000Z");
    assert.deepEqual(pollBody("pageUpdated", "c"), {
      filter: { timestamp: "last_edited_time", last_edited_time: { on_or_after: "c" } },
      sorts: [{ timestamp: "last_edited_time", direction: "ascending" }],
    });
    assert.equal(keyOf("pageAdded", page), "p1");
    assert.equal(keyOf("pageUpdated", page), "p1:t2");
  });

  it("only marks the time on the first poll", async () => {
    const calls = mockFetch([]);
    const result = await poll(null, true);
    assert.equal(calls.length, 0);
    assert.deepEqual(result.items, []);
    assert.equal(typeof result.cursor, "string");
  });

  it("returns the new pages and moves the cursor", async () => {
    const calls = mockFetch([
      { body: { results: [{ ...page, object: "page", properties: {} }], has_more: false } },
    ]);
    const result = await poll("2026-01-01T10:00:00.000Z", false, { simplify: false });
    assert.equal(calls[0]?.url, `https://api.notion.com/v1/data_sources/${ID}/query`);
    assert.equal(result.items[0]?.key, "p1");
    assert.equal(result.cursor, "2026-01-01T10:15:00.000Z");
  });
});
