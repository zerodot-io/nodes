// SPDX-License-Identifier: AGPL-3.0-only
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { z } from "zod";
import { credentialTypes, nodes } from "./index";
import {
  getValue,
  parseInfo,
  type RedisCaller,
  redisOptions,
  runOperation,
  setProperty,
  setValue,
} from "./redis";
import { splitChannels, toMessageItem } from "./redis-trigger";

type Call = [string, ...string[]];

/** A client that records the commands and answers from a table. */
function fake(answers: Record<string, unknown> = {}): { client: RedisCaller; calls: Call[] } {
  const calls: Call[] = [];
  return {
    calls,
    client: {
      async call(command, ...args) {
        calls.push([command, ...args]);
        return answers[command] ?? null;
      },
    },
  };
}

const base = {
  operation: "get",
  key: "k",
  propertyName: "propertyName",
  value: "",
  keyType: "automatic",
  expire: false,
  ttl: 60,
  keyPattern: "*",
  getValues: true,
  list: "",
  messageData: "",
  tail: false,
  channel: "",
  dotNotation: true,
} as const;

const config = (override: Record<string, unknown>) => {
  const node = registry.get("redis.database");
  assert.ok(node);
  return node.config.parse({ ...base, ...override }) as Parameters<typeof runOperation>[1];
};

describe("redisOptions", () => {
  it("uses the usual defaults", () => {
    const options = redisOptions({ type: "redis", data: { host: "r.x.io" } });
    assert.equal(options.port, 6379);
    assert.equal(options.db, 0);
    assert.equal(options.tls, undefined);
    assert.equal(options.password, undefined);
  });

  it("reads the login, database and TLS", () => {
    const options = redisOptions({
      type: "redis",
      data: { host: "h", port: "6380", user: "u", password: "p", database: "3", ssl: "true" },
    });
    assert.equal(options.port, 6380);
    assert.equal(options.db, 3);
    assert.equal(options.username, "u");
    assert.equal(options.password, "p");
    assert.deepEqual(options.tls, {});
  });

  it("fails without a credential or a host", () => {
    assert.throws(() => redisOptions(null), /Pick a Redis credential/);
    assert.throws(() => redisOptions({ type: "redis", data: {} }), /no "host"/);
  });
});

describe("values", () => {
  it("reads a string as JSON when it is JSON", async () => {
    const { client } = fake({ TYPE: "string", GET: '{"a":1}' });
    assert.deepEqual(await getValue(client, "k", "automatic"), { a: 1 });
    const text = fake({ GET: "plain" });
    assert.equal(await getValue(text.client, "k", "string"), "plain");
  });

  it("reads a hash, a list, a set, and a missing key", async () => {
    assert.deepEqual(await getValue(fake({ HGETALL: ["a", "1", "b", "2"] }).client, "k", "hash"), {
      a: "1",
      b: "2",
    });
    assert.deepEqual(
      await getValue(fake({ TYPE: "list", LRANGE: ["x"] }).client, "k", "automatic"),
      ["x"],
    );
    assert.deepEqual(
      await getValue(fake({ TYPE: "set", SMEMBERS: ["y"] }).client, "k", "automatic"),
      ["y"],
    );
    assert.equal(await getValue(fake({ TYPE: "none" }).client, "k", "automatic"), null);
    await assert.rejects(
      getValue(fake({ TYPE: "stream" }).client, "k", "automatic"),
      /not supported/,
    );
  });

  it("writes each key type, with a time to live", async () => {
    const string = fake();
    await setValue(string.client, "k", "v", "automatic", 30);
    assert.deepEqual(string.calls, [
      ["SET", "k", "v"],
      ["EXPIRE", "k", "30"],
    ]);

    const hash = fake();
    await setValue(hash.client, "k", '{"a":"1","b":2}', "hash", undefined);
    assert.deepEqual(hash.calls, [["HSET", "k", "a", "1", "b", "2"]]);

    const list = fake();
    await setValue(list.client, "k", '["x","y"]', "list", undefined);
    assert.deepEqual(list.calls, [["RPUSH", "k", "x", "y"]]);

    const set = fake();
    await setValue(set.client, "k", "one", "sets", undefined);
    assert.deepEqual(set.calls, [["SADD", "k", "one"]]);

    await assert.rejects(setValue(fake().client, "k", "text", "hash", undefined), /JSON object/);
  });

  it("reads INFO", () => {
    assert.deepEqual(parseInfo("# Server\r\nredis_version:7.2.4\r\nuptime_in_seconds:10\r\n\r\n"), {
      redis_version: "7.2.4",
      uptime_in_seconds: 10,
    });
  });

  it("sets a property with dot notation", () => {
    assert.deepEqual(setProperty({ a: 1 }, "x.y", 2, true), { a: 1, x: { y: 2 } });
    assert.deepEqual(setProperty({ x: { z: 1 } }, "x.y", 2, true), { x: { z: 1, y: 2 } });
    assert.deepEqual(setProperty({}, "x.y", 2, false), { "x.y": 2 });
  });
});

describe("operations", () => {
  it("get puts the value in the item", async () => {
    const { client } = fake({ TYPE: "string", GET: "5" });
    assert.deepEqual(await runOperation(client, config({ propertyName: "n" }), { id: 1 }), {
      id: 1,
      n: 5,
    });
  });

  it("set, delete, and incr", async () => {
    const set = fake();
    const kept = await runOperation(
      set.client,
      config({ operation: "set", value: "v", expire: true, ttl: 5 }),
      { id: 1 },
    );
    assert.deepEqual(kept, { id: 1 });
    assert.deepEqual(set.calls, [
      ["SET", "k", "v"],
      ["EXPIRE", "k", "5"],
    ]);

    const del = fake({ DEL: 1 });
    assert.deepEqual(await runOperation(del.client, config({ operation: "delete" }), {}), {
      deleted: 1,
    });

    const incr = fake({ INCR: 3 });
    assert.deepEqual(await runOperation(incr.client, config({ operation: "incr" }), {}), {
      propertyName: 3,
    });
  });

  it("keys gives names, or values", async () => {
    const answers = { KEYS: ["a", "b"], TYPE: "string", GET: "1" };
    assert.deepEqual(
      await runOperation(fake(answers).client, config({ operation: "keys", getValues: false }), {}),
      { propertyName: ["a", "b"] },
    );
    assert.deepEqual(await runOperation(fake(answers).client, config({ operation: "keys" }), {}), {
      propertyName: { a: 1, b: 1 },
    });
  });

  it("push, pop, length, and publish", async () => {
    const push = fake({ LPUSH: 2, RPUSH: 4 });
    assert.deepEqual(
      await runOperation(
        push.client,
        config({ operation: "push", list: "l", messageData: "x" }),
        {},
      ),
      { length: 2 },
    );
    assert.deepEqual(
      await runOperation(
        push.client,
        config({ operation: "push", list: "l", messageData: "x", tail: true }),
        {},
      ),
      { length: 4 },
    );
    assert.deepEqual(
      await runOperation(
        fake({ RPOP: '{"a":1}' }).client,
        config({ operation: "pop", list: "l", tail: true }),
        {},
      ),
      { propertyName: { a: 1 } },
    );
    assert.deepEqual(
      await runOperation(fake({ LLEN: 7 }).client, config({ operation: "llen", list: "l" }), {}),
      { propertyName: 7 },
    );
    const publish = fake({ PUBLISH: 2 });
    assert.deepEqual(
      await runOperation(
        publish.client,
        config({ operation: "publish", channel: "c", messageData: "hi" }),
        {},
      ),
      { receivers: 2 },
    );
    assert.deepEqual(publish.calls, [["PUBLISH", "c", "hi"]]);
  });

  it("asks for a missing key, list, or channel", async () => {
    await assert.rejects(
      runOperation(fake().client, config({ operation: "delete", key: "" }), {}),
      /Set the key/,
    );
    await assert.rejects(
      runOperation(fake().client, config({ operation: "pop", list: "" }), {}),
      /Set the list/,
    );
    await assert.rejects(
      runOperation(fake().client, config({ operation: "publish", channel: "" }), {}),
      /Set the channel/,
    );
  });
});

const registry = new Map(nodes.map((node) => [node.type, node]));
const credentialFields = (data: Record<string, string>) =>
  credentialTypes[0]?.fields.safeParse(data);

describe("redis nodes and credential", () => {
  it("checks the credential data", () => {
    assert.equal(credentialFields({ host: "h", database: "2", ssl: "true" })?.success, true);
    assert.equal(credentialFields({ host: "h", port: "x" })?.success, false);
    assert.equal(credentialFields({})?.success, false);
  });

  it("carry the icon with the package", () => {
    assert.match(credentialTypes[0]?.iconUrl ?? "", /^data:image\/svg\+xml;base64,/);
    assert.match(registry.get("redis.database")?.iconUrl ?? "", /^data:image\/svg\+xml;base64,/);
  });

  it("are in the registry", () => {
    const node = registry.get("redis.database");
    assert.equal(node?.credentialTypes?.[0], "redis");
    assert.equal(node?.config.safeParse({ operation: "x" }).success, false);
    const trigger = registry.get("trigger.redis");
    assert.equal(trigger?.category, "trigger");
    assert.equal(typeof trigger?.listen, "function");
  });

  it("splits channels into names and patterns", () => {
    assert.deepEqual(splitChannels(" a, b.*,,c? "), { exact: ["a"], patterns: ["b.*", "c?"] });
  });

  it("makes the trigger input", () => {
    const options = { jsonParseBody: true, onlyMessage: false };
    assert.deepEqual(toMessageItem("c", '{"a":1}', options), { channel: "c", message: { a: 1 } });
    assert.deepEqual(toMessageItem("c", "{bad", options), { channel: "c", message: "{bad" });
    assert.deepEqual(toMessageItem("c", "x", { jsonParseBody: false, onlyMessage: true }), {
      message: "x",
    });
  });
});

describe("labels and hints", () => {
  // Every select of the new nodes shows a label and a hint for each option.
  for (const type of ["redis.database", "trigger.redis"]) {
    it(`${type} has labels and hints for every enum`, () => {
      const node = registry.get(type);
      assert.ok(node);
      const schema = z.toJSONSchema(node.config, { io: "input", unrepresentable: "any" }) as {
        properties: Record<
          string,
          { enum?: string[]; labels?: Record<string, string>; hints?: Record<string, string> }
        >;
      };
      for (const [name, property] of Object.entries(schema.properties)) {
        if (!property.enum) continue;
        for (const value of property.enum) {
          assert.ok(property.labels?.[value], `${name}.${value} has no label`);
          assert.ok(property.hints && value in property.hints, `${name}.${value} has no hint`);
        }
      }
    });
  }
});
