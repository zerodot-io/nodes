// SPDX-License-Identifier: AGPL-3.0-only
import { z } from "zod";
import {
  changeOf,
  defineSupplyNode,
  MEMORY_KIND,
  type Memory,
  readTurn,
  sessionOf,
  withoutLastMessages,
} from "./chat-memory";
import { REDIS_ICON } from "./icon";
import { connectRedis, REDIS_CREDENTIAL_TYPES, type RedisCaller, redisOptions } from "./redis";

/** A connection for one call of the memory. `ioredis` has these methods. A test can fake them. */
export type MemoryClient = RedisCaller & { disconnect(): void };

type Options = { key: string; turns: number; trim: boolean; ttl: number };

/**
 * Removes the last `ARGV[1]` items of the list, then adds `ARGV[2]` when it is there. One script,
 * so a turn that another run saves at the same time is not lost.
 */
const REPLACE_TAIL = `local n = tonumber(ARGV[1])
if n > 0 then redis.call('LTRIM', KEYS[1], 0, -n - 1) end
if ARGV[2] then redis.call('RPUSH', KEYS[1], ARGV[2]) end
return 1`;

/**
 * Memory in a Redis list. The key is the session ID, and each item is the messages of one turn
 * as JSON text, oldest first. A turn keeps a tool call and its result together, so a window of
 * turns never splits them. Each call opens its own connection, because a supply has no close.
 */
export function redisMemory(connect: () => Promise<MemoryClient>, options: Options): Memory {
  const { key, turns, trim, ttl } = options;
  const withClient = async <T>(work: (client: MemoryClient) => Promise<T>): Promise<T> => {
    const client = await connect();
    try {
      return await work(client);
    } finally {
      client.disconnect();
    }
  };
  const range = async (client: MemoryClient, start: number) => {
    const items = await client.call("LRANGE", key, String(start), "-1");
    return Array.isArray(items) ? items.map(readTurn) : [];
  };
  const expire = async (client: MemoryClient) => {
    if (ttl > 0) await client.call("EXPIRE", key, String(ttl));
  };
  return {
    load: () => withClient(async (client) => (await range(client, -turns)).flat()),
    save: (messages) =>
      withClient(async (client) => {
        await client.call("RPUSH", key, JSON.stringify(messages));
        // Older turns than the window go.
        if (trim) await client.call("LTRIM", key, String(-turns), "-1");
        await expire(client);
      }),
    loadAll: () => withClient(async (client) => (await range(client, 0)).flat()),
    clear: () =>
      withClient(async (client) => {
        await client.call("DEL", key);
      }),
    deleteLast: (count) =>
      withClient(async (client) => {
        const all = await range(client, 0);
        const { from, replacement } = changeOf(all, withoutLastMessages(all, count));
        const removed = all.length - from;
        if (removed === 0) return;
        const args = replacement.map((turn) => JSON.stringify(turn));
        await client.call("EVAL", REPLACE_TAIL, "1", key, String(removed), ...args);
        if (args.length > 0) await expire(client);
      }),
  };
}

export default defineSupplyNode({
  type: "redis.memory",
  label: "Redis Chat Memory",
  description: "Keeps the conversation of the AI Agent in Redis",
  category: "integration",
  icon: "DatabaseIcon",
  iconUrl: REDIS_ICON,
  supplies: MEMORY_KIND,
  config: z.object({
    sessionId: z.string().default("").meta({
      title: "Session ID",
      description:
        "One conversation, such as {{ $input.chatId }}. It is the key of the list in Redis. It reads the input of the agent",
    }),
    turns: z.number().int().min(1).max(100).default(10).meta({
      title: "Turns to Remember",
      description: "How many earlier runs of the session the agent reads",
    }),
    trim: z.boolean().default(false).meta({
      title: "Delete Older Turns",
      description: "Delete the turns of the session that are older than the turns to remember",
    }),
    ttl: z.number().int().min(0).default(0).meta({
      title: "Session Time to Live (s)",
      description: "Redis deletes the session this long after the last turn. 0 keeps it",
    }),
  }),
  defaultConfig: { sessionId: "", turns: 10, trim: false, ttl: 0 },
  credentialTypes: REDIS_CREDENTIAL_TYPES,
  subtitle: (config) =>
    typeof config.sessionId === "string" && config.sessionId !== "" ? config.sessionId : undefined,
  supply: ({ config, credential }) => {
    // A missing credential or host stops the run before the agent calls the model.
    redisOptions(credential);
    return redisMemory(() => connectRedis(credential), {
      key: sessionOf(config),
      turns: config.turns,
      trim: config.trim,
      ttl: config.ttl,
    });
  },
});
