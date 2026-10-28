// SPDX-License-Identifier: AGPL-3.0-only
import { randomUUID } from "node:crypto";
import { defineNode } from "@zerodot/node-sdk";
import { z } from "zod";
import { REDIS_ICON } from "./icon";
import { connectRedis, parseStored, REDIS_CREDENTIAL_TYPES } from "./redis";

const config = z.object({
  channels: z.string().min(1).meta({
    title: "Channels",
    placeholder: "e.g. orders, alerts.*",
    description:
      "Channel names to listen on, separated by commas. A name with * or ? matches a pattern.",
  }),
  jsonParseBody: z.boolean().default(false).meta({
    title: "JSON Parse Body",
    description: "Whether to read the message as JSON, when it is valid JSON",
  }),
  onlyMessage: z.boolean().default(false).meta({
    title: "Only Message",
    description: "Whether to return only the message, and not the channel name",
  }),
});

/** The channel names of the config. A name with a glob character is a pattern. */
export function splitChannels(channels: string): { exact: string[]; patterns: string[] } {
  const names = channels
    .split(",")
    .map((name) => name.trim())
    .filter((name) => name !== "");
  return {
    exact: names.filter((name) => !/[*?[]/.test(name)),
    patterns: names.filter((name) => /[*?[]/.test(name)),
  };
}

/** The trigger input for one message. */
export function toMessageItem(
  channel: string,
  message: string,
  options: { jsonParseBody: boolean; onlyMessage: boolean },
): unknown {
  const body = options.jsonParseBody ? parseStored(message) : message;
  return options.onlyMessage ? { message: body } : { channel, message: body };
}

export default defineNode({
  type: "trigger.redis",
  label: "On Redis message",
  description: "Start a run when a message arrives on a Redis channel",
  category: "trigger",
  app: "Redis",
  icon: "Database",
  iconUrl: REDIS_ICON,
  config,
  defaultConfig: { channels: "", jsonParseBody: false, onlyMessage: false },
  credentialTypes: REDIS_CREDENTIAL_TYPES,
  ports: { in: [], out: ["out"] },
  subtitle: (cfg) =>
    typeof cfg.channels === "string" && cfg.channels !== "" ? cfg.channels : undefined,
  // The input is the message that started the run.
  run: ({ input }) => ({ port: "out", data: input }),
  async listen({ config: cfg, credential, signal, emit, fail }) {
    const { exact, patterns } = splitChannels(cfg.channels);
    if (exact.length === 0 && patterns.length === 0) throw new Error("Add at least one channel");
    // The client does not retry in the background. The worker restarts a failed trigger.
    const client = await connectRedis(credential);
    const abort = () => client.disconnect();
    signal.addEventListener("abort", abort, { once: true });
    client.on("error", (error: Error) => fail(error));
    try {
      // Messages go to the runs in the order they came.
      let chain: Promise<void> = Promise.resolve();
      const handle = (channel: string, message: string) => {
        chain = chain
          .then(() =>
            emit({
              // Two equal messages are two events, so the key is unique.
              key: randomUUID(),
              data: toMessageItem(channel, message, cfg),
            }),
          )
          .catch((error) => fail(error instanceof Error ? error : new Error(String(error))));
      };
      client.on("message", handle);
      client.on("pmessage", (_pattern: string, channel: string, message: string) =>
        handle(channel, message),
      );
      if (exact.length > 0) await client.subscribe(...exact);
      if (patterns.length > 0) await client.psubscribe(...patterns);
      return {
        async close() {
          signal.removeEventListener("abort", abort);
          try {
            await chain;
          } finally {
            client.disconnect();
          }
        },
      };
    } catch (error) {
      signal.removeEventListener("abort", abort);
      client.disconnect();
      throw error;
    }
  },
});
