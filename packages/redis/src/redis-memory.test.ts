// SPDX-License-Identifier: AGPL-3.0-only
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import type { ResolvedCredential } from "@zerodot/node-sdk";
import { type Message, readTurn, withoutLastMessages } from "./chat-memory";
import { nodes } from "./index";
import { type MemoryClient, redisMemory } from "./redis-memory";

/** The index of a Redis list position. Negative counts from the end. */
const at = (index: number, length: number) => (index < 0 ? length + index : index);

/** A Redis with lists that records the commands and the connections. */
function fakeRedis() {
  const lists = new Map<string, string[]>();
  const calls: string[][] = [];
  let open = 0;
  const slice = (list: string[], start: string, stop: string) =>
    list.slice(Math.max(0, at(Number(start), list.length)), at(Number(stop), list.length) + 1);
  const client: MemoryClient = {
    async call(command, ...args) {
      calls.push([command, ...args]);
      const [key = "", ...rest] = command === "EVAL" ? args.slice(2) : args;
      const list = lists.get(key) ?? [];
      switch (command) {
        case "LRANGE":
          return slice(list, rest[0] ?? "0", rest[1] ?? "-1");
        case "RPUSH":
          lists.set(key, [...list, ...rest]);
          return list.length + rest.length;
        case "LTRIM":
          lists.set(key, slice(list, rest[0] ?? "0", rest[1] ?? "-1"));
          return "OK";
        case "DEL":
          lists.delete(key);
          return 1;
        case "EVAL": {
          const [removed = "0", ...added] = rest;
          lists.set(key, [...list.slice(0, list.length - Number(removed)), ...added]);
          return 1;
        }
        default:
          return 1;
      }
    },
    disconnect() {
      open--;
    },
  };
  const connect = async () => {
    open++;
    return client;
  };
  return { lists, calls, connect, open: () => open };
}

const user = (content: string): Message => ({ role: "user", content });
const ai = (content: string): Message => ({ role: "assistant", content });
const call: Message = {
  role: "assistant",
  content: "",
  toolCalls: [{ id: "c1", name: "find", input: {} }],
};
const result: Message = { role: "tool", toolCallId: "c1", name: "find", content: "found" };

const options = { key: "chat-1", turns: 2, trim: false, ttl: 0 };

describe("redis.memory", () => {
  it("is a supply node of the memory kind", () => {
    const node = nodes.find((entry) => entry.type === "redis.memory");
    assert.equal(node?.supplies, "ai.memory");
    assert.deepEqual(node?.ports, { in: [], out: [] });
    assert.deepEqual(node?.credentialTypes, ["redis"]);
  });

  it("needs a session ID and a Redis credential", () => {
    const node = nodes.find((entry) => entry.type === "redis.memory");
    const supply = (config: object, credential: ResolvedCredential | null) =>
      node?.supply?.({
        config: { sessionId: "", turns: 10, trim: false, ttl: 0, ...config },
        credential,
        signal: new AbortController().signal,
        scope: {},
        sandbox: null,
        tables: null,
        node: { id: "n", name: "Memory" },
      });
    assert.throws(() => supply({ sessionId: "s" }, null), /Redis credential/);
    assert.throws(() => supply({}, { type: "redis", data: { host: "h" } }), /"sessionId"/);
  });

  it("keeps one item for each turn and reads the last turns", async () => {
    const redis = fakeRedis();
    const memory = redisMemory(redis.connect, options);
    await memory.save([user("a"), ai("1")]);
    await memory.save([user("b"), call, result, ai("2")]);
    await memory.save([user("c"), ai("3")]);
    assert.equal(redis.lists.get("chat-1")?.length, 3);
    assert.deepEqual(await memory.load(), [user("b"), call, result, ai("2"), user("c"), ai("3")]);
    assert.equal((await memory.loadAll()).length, 8);
    assert.equal(redis.open(), 0);
  });

  it("deletes older turns and sets the time to live on request", async () => {
    const redis = fakeRedis();
    const memory = redisMemory(redis.connect, { ...options, trim: true, ttl: 60 });
    for (const text of ["a", "b", "c"]) await memory.save([user(text), ai(text)]);
    assert.deepEqual(await memory.loadAll(), [user("b"), ai("b"), user("c"), ai("c")]);
    assert.deepEqual(redis.calls.at(-2), ["EXPIRE", "chat-1", "60"]);
  });

  it("deletes the last messages and never keeps an open tool call", async () => {
    const redis = fakeRedis();
    const memory = redisMemory(redis.connect, options);
    await memory.save([user("a"), ai("1")]);
    await memory.save([user("b"), call, result, ai("2")]);
    await memory.deleteLast(2);
    assert.deepEqual(await memory.loadAll(), [user("a"), ai("1"), user("b")]);
    await memory.deleteLast(5);
    assert.deepEqual(await memory.loadAll(), []);
    await memory.save([user("x")]);
    await memory.clear();
    assert.equal(redis.lists.has("chat-1"), false);
  });
});

describe("chat memory", () => {
  it("is the same file in the postgres package", () => {
    const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
    assert.equal(read("./chat-memory.ts"), read("../../postgres/src/chat-memory.ts"));
  });

  it("checks the messages of a turn", () => {
    assert.deepEqual(readTurn('[{"role":"user","content":"hi"}]'), [user("hi")]);
    assert.throws(() => readTurn("{"), /not valid JSON/);
    assert.throws(() => readTurn([{ role: "tool", content: "x" }]), /Message 1/);
  });

  it("cuts inside a turn and removes the tool call without a result", () => {
    const turns = [
      [user("a"), ai("1")],
      [user("b"), call, result, ai("2")],
    ];
    assert.deepEqual(withoutLastMessages(turns, 1), [turns[0], [user("b"), call, result]]);
    assert.deepEqual(withoutLastMessages(turns, 2), [turns[0], [user("b")]]);
    assert.deepEqual(withoutLastMessages(turns, 6), []);
  });
});
