// SPDX-License-Identifier: AGPL-3.0-only
import { defineNode, type ResolvedCredential, resolveTemplate } from "@zerodot/node-sdk";
import type { Redis, RedisOptions } from "ioredis";
import { z } from "zod";
import { REDIS_ICON } from "./icon";
import { isRecord, type Row, toItems } from "./util";

export const REDIS_CREDENTIAL_TYPES = ["redis"];

const OPERATIONS = [
  "get",
  "set",
  "delete",
  "incr",
  "keys",
  "push",
  "pop",
  "llen",
  "publish",
  "info",
] as const;

const KEY_TYPES = ["automatic", "string", "hash", "list", "sets"] as const;
type KeyType = (typeof KEY_TYPES)[number];

/** The one method of the client that the node needs. `ioredis` has it. A test can fake it. */
export type RedisCaller = { call(command: string, ...args: string[]): Promise<unknown> };

const text = (value: unknown): string | undefined =>
  typeof value === "string" && value !== "" ? value : undefined;

/** The connection settings from a `redis` credential. Empty means port 6379, database 0, no TLS. */
export function redisOptions(credential: ResolvedCredential | null): RedisOptions {
  if (credential?.type !== "redis") throw new Error("Pick a Redis credential");
  const { data } = credential;
  const host = text(data.host);
  if (!host) throw new Error('The credential has no "host"');
  const options: RedisOptions = {
    host,
    port: text(data.port) ? Number(data.port) : 6379,
    db: text(data.database) ? Number(data.database) : 0,
    connectTimeout: 10_000,
    lazyConnect: true,
    // A node run is short. Do not retry in the background.
    maxRetriesPerRequest: 1,
    retryStrategy: () => null,
  };
  const user = text(data.user);
  const password = text(data.password);
  if (user) options.username = user;
  if (password) options.password = password;
  if (data.ssl === "true") options.tls = {};
  return options;
}

/** The driver loads on first use. The editor imports this package for the node catalog. */
export async function connectRedis(
  credential: ResolvedCredential | null,
  extra: RedisOptions = {},
): Promise<Redis> {
  const { default: IORedis } = await import("ioredis");
  const client = new IORedis({ ...redisOptions(credential), ...extra });
  // Without a listener, a connection error would stop the process.
  client.on("error", () => {});
  await client.connect();
  return client;
}

const asText = (value: unknown): string => {
  if (typeof value === "string") return value;
  return JSON.stringify(value) ?? "";
};

/** Text that is JSON gives the value. Other text stays text. */
export function parseStored(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return value;
  }
}

/** `[k1, v1, k2, v2]` from a Redis reply becomes an object. */
function pairsToObject(reply: unknown): Row {
  const result: Row = {};
  if (!Array.isArray(reply)) return result;
  for (let i = 0; i + 1 < reply.length; i += 2) result[String(reply[i])] = reply[i + 1];
  return result;
}

/** Reads a value. `automatic` asks Redis for the type of the key. A missing key gives null. */
export async function getValue(
  client: RedisCaller,
  key: string,
  keyType: KeyType,
): Promise<unknown> {
  const type = keyType === "automatic" ? String(await client.call("TYPE", key)) : keyType;
  if (type === "none") return null;
  if (type === "string") return parseStored(await client.call("GET", key));
  if (type === "hash") return pairsToObject(await client.call("HGETALL", key));
  if (type === "list") return await client.call("LRANGE", key, "0", "-1");
  if (type === "set" || type === "sets") return await client.call("SMEMBERS", key);
  throw new Error(`Redis type "${type}" is not supported`);
}

/** Writes a value. `hash` needs a JSON object. `list` and `sets` take a JSON array, or one value. */
export async function setValue(
  client: RedisCaller,
  key: string,
  value: string,
  keyType: KeyType,
  ttl: number | undefined,
): Promise<void> {
  const type = keyType === "automatic" ? "string" : keyType;
  if (type === "string") {
    await client.call("SET", key, value);
  } else if (type === "hash") {
    const object = parseStored(value);
    if (!isRecord(object)) throw new Error("A hash needs a JSON object as the value");
    const args = Object.entries(object).flatMap(([field, entry]) => [field, asText(entry)]);
    if (args.length === 0) throw new Error("A hash needs at least one field");
    await client.call("HSET", key, ...args);
  } else {
    const parsed = parseStored(value);
    const list = Array.isArray(parsed) ? parsed : [value];
    if (list.length === 0) throw new Error("Give at least one value");
    await client.call(type === "list" ? "RPUSH" : "SADD", key, ...list.map(asText));
  }
  if (ttl !== undefined) await client.call("EXPIRE", key, String(ttl));
}

/** The INFO reply as an object. Lines are `name:value`. Numbers become numbers. */
export function parseInfo(reply: unknown): Row {
  const result: Row = {};
  for (const line of String(reply).split(/\r?\n/)) {
    if (line === "" || line.startsWith("#")) continue;
    const at = line.indexOf(":");
    if (at < 0) continue;
    const value = line.slice(at + 1);
    result[line.slice(0, at)] =
      value !== "" && !Number.isNaN(Number(value)) ? Number(value) : value;
  }
  return result;
}

const option = (title: string) => ({ option: true, title });

const config = z.object({
  operation: z
    .enum(OPERATIONS)
    .default("get")
    .meta({
      title: "Operation",
      labels: {
        get: "Get",
        set: "Set",
        delete: "Delete",
        incr: "Increment",
        keys: "Get Keys",
        push: "Push to List",
        pop: "Pop from List",
        llen: "Get List Length",
        publish: "Publish",
        info: "Get Info",
      },
      hints: {
        get: "Get the value of a key",
        set: "Set the value of a key",
        delete: "Delete a key",
        incr: "Increment a number key by one, or create it with the value 1",
        keys: "Get all keys that match a pattern",
        push: "Add data to the start or the end of a list",
        pop: "Remove and return data from the start or the end of a list",
        llen: "Get the number of entries in a list",
        publish: "Send a message to a channel",
        info: "Get the INFO reply of the server",
      },
    }),
  key: z
    .string()
    .default("")
    .meta({
      title: "Key",
      description: "The key to work on",
      showWhen: { operation: ["get", "set", "delete", "incr"] },
    }),
  propertyName: z
    .string()
    .default("propertyName")
    .meta({
      title: "Property Name",
      description: "Name of the property to put the result in",
      showWhen: { operation: ["get", "incr", "keys", "pop", "llen"] },
    }),
  value: z
    .string()
    .default("")
    .meta({
      title: "Value",
      description: 'The value to write. For a hash use a JSON object, for example {"a":"1"}.',
      showWhen: { operation: ["set"] },
    }),
  keyType: z
    .enum(KEY_TYPES)
    .default("automatic")
    .meta({
      title: "Key Type",
      description: "The type of the key. Set treats Automatic as String.",
      labels: {
        automatic: "Automatic",
        string: "String",
        hash: "Hash",
        list: "List",
        sets: "Set",
      },
      hints: {
        automatic: "Get: ask Redis for the type. Set: write a string",
        string: "A plain value",
        hash: "A set of fields and values",
        list: "An ordered list of values",
        sets: "An unordered set of unique values",
      },
      showWhen: { operation: ["get", "set"] },
    }),
  expire: z
    .boolean()
    .default(false)
    .meta({
      title: "Expire",
      description: "Whether to set a time to live on the key",
      showWhen: { operation: ["set", "incr"] },
    }),
  ttl: z
    .number()
    .int()
    .min(1)
    .default(60)
    .meta({
      title: "TTL",
      description: "Time to live in seconds",
      showWhen: { operation: ["set", "incr"], expire: [true] },
    }),
  keyPattern: z
    .string()
    .default("*")
    .meta({
      title: "Key Pattern",
      placeholder: "e.g. user:*",
      description: "The pattern to match. Use * for any text and ? for one character.",
      showWhen: { operation: ["keys"] },
    }),
  getValues: z
    .boolean()
    .default(true)
    .meta({
      title: "Get Values",
      description: "Whether to read the value of each key, or return only the key names",
      showWhen: { operation: ["keys"] },
    }),
  list: z
    .string()
    .default("")
    .meta({
      title: "List",
      description: "The name of the list",
      showWhen: { operation: ["push", "pop", "llen"] },
    }),
  messageData: z
    .string()
    .default("")
    .meta({
      title: "Data",
      description: "The data to add to the list, or to publish",
      showWhen: { operation: ["push", "publish"] },
    }),
  tail: z
    .boolean()
    .default(false)
    .meta({
      title: "Tail",
      description: "Whether to work on the end of the list, and not on the start",
      showWhen: { operation: ["push", "pop"] },
    }),
  channel: z
    .string()
    .default("")
    .meta({
      title: "Channel",
      description: "The channel to send the message to",
      showWhen: { operation: ["publish"] },
    }),
  dotNotation: z
    .boolean()
    .default(true)
    .meta({
      ...option("Dot Notation"),
      description:
        "Whether to read dots in the property name as a path (a.b gives { a: { b } }), and not as part of the name",
      showWhen: { operation: ["get", "incr", "keys", "pop", "llen"] },
    }),
});

type Config = z.output<typeof config>;

/** Puts `value` in a copy of `target` under `name`. With dot notation `a.b` makes a nested object. */
export function setProperty(target: Row, name: string, value: unknown, dotNotation: boolean): Row {
  const result: Row = { ...target };
  if (!dotNotation || !name.includes(".")) {
    result[name] = value;
    return result;
  }
  const path = name.split(".");
  let cursor: Row = result;
  for (const [index, part] of path.entries()) {
    if (index === path.length - 1) {
      cursor[part] = value;
      break;
    }
    const existing = cursor[part];
    const next: Row = isRecord(existing) ? { ...existing } : {};
    cursor[part] = next;
    cursor = next;
  }
  return result;
}

const need = (value: string, what: string): string => {
  if (value === "") throw new Error(`Set the ${what}`);
  return value;
};

/** Runs the operation for one item. Returns the output item. */
export async function runOperation(client: RedisCaller, cfg: Config, item: Row): Promise<Row> {
  const put = (value: unknown): Row =>
    setProperty(item, cfg.propertyName || "propertyName", value, cfg.dotNotation);
  const ttl = cfg.expire ? cfg.ttl : undefined;
  switch (cfg.operation) {
    case "get":
      return put(await getValue(client, need(cfg.key, "key"), cfg.keyType));
    case "set":
      await setValue(client, need(cfg.key, "key"), cfg.value, cfg.keyType, ttl);
      return item;
    case "delete":
      return { ...item, deleted: Number(await client.call("DEL", need(cfg.key, "key"))) };
    case "incr": {
      const key = need(cfg.key, "key");
      const value = Number(await client.call("INCR", key));
      if (ttl !== undefined) await client.call("EXPIRE", key, String(ttl));
      return put(value);
    }
    case "keys": {
      const keys = (await client.call("KEYS", cfg.keyPattern || "*")) as string[];
      if (!cfg.getValues) return put(keys);
      const values: Row = {};
      for (const key of keys) values[key] = await getValue(client, key, "automatic");
      return put(values);
    }
    case "push": {
      const list = need(cfg.list, "list");
      const length = await client.call(cfg.tail ? "RPUSH" : "LPUSH", list, cfg.messageData);
      return { ...item, length: Number(length) };
    }
    case "pop": {
      const value = await client.call(cfg.tail ? "RPOP" : "LPOP", need(cfg.list, "list"));
      return put(parseStored(value));
    }
    case "llen":
      return put(Number(await client.call("LLEN", need(cfg.list, "list"))));
    case "publish": {
      const receivers = await client.call("PUBLISH", need(cfg.channel, "channel"), cfg.messageData);
      return { ...item, receivers: Number(receivers) };
    }
    case "info":
      return { ...item, info: parseInfo(await client.call("INFO")) };
  }
}

const RAW_KEYS = ["key", "value", "messageData", "list", "channel", "keyPattern"] as const;

/** Resolves the expressions of the raw keys for one item. */
function forItem(cfg: Config, scope: Record<string, unknown>): Config {
  const resolved: Config = { ...cfg };
  for (const name of RAW_KEYS) {
    const value = resolveTemplate(cfg[name], scope);
    resolved[name] = typeof value === "string" ? value : asText(value);
  }
  return resolved;
}

export default defineNode({
  type: "redis.database",
  label: "Redis",
  description: "Get, set and delete keys, work on lists, and publish messages in Redis",
  category: "integration",
  app: "Redis",
  // The names of the actions of the Redis node.
  actions: [
    { label: "Delete a key from Redis", config: { operation: "delete" } },
    { label: "Get the value of a key from Redis", config: { operation: "get" } },
    { label: "Return all the keys that match a pattern", config: { operation: "keys" } },
    { label: "Increment a key", config: { operation: "incr" } },
    { label: "Push data to a Redis list", config: { operation: "push" } },
    { label: "Pop data from a Redis list", config: { operation: "pop" } },
    { label: "Get the length of a Redis list", config: { operation: "llen" } },
    { label: "Publish data to a Redis channel", config: { operation: "publish" } },
    { label: "Set the value of a key in Redis", config: { operation: "set" } },
    { label: "Return information about the Redis server", config: { operation: "info" } },
  ],
  icon: "Database",
  iconUrl: REDIS_ICON,
  config,
  defaultConfig: { operation: "get", key: "", propertyName: "propertyName" },
  // These keys can read one item, so they are resolved once for each item.
  rawConfigKeys: [...RAW_KEYS],
  credentialTypes: REDIS_CREDENTIAL_TYPES,
  ports: { in: ["in"], out: ["out"] },
  subtitle: (cfg) => (typeof cfg.operation === "string" ? cfg.operation : undefined),
  // Each input item runs the operation once. The output has one item for each.
  async run({ config: cfg, input, credential, scope, signal }) {
    const items = toItems(input);
    if (items.length === 0) return { port: "out", data: [] };
    const client = await connectRedis(credential);
    const abort = () => client.disconnect();
    signal.addEventListener("abort", abort, { once: true });
    try {
      const out: Row[] = [];
      for (const [index, item] of items.entries()) {
        const itemScope = { ...scope, $item: item, $json: item, $index: index };
        out.push(await runOperation(client, forItem(cfg, itemScope), item));
      }
      return { port: "out", data: out };
    } finally {
      signal.removeEventListener("abort", abort);
      client.disconnect();
    }
  },
});
