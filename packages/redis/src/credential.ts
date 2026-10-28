// SPDX-License-Identifier: AGPL-3.0-only
import type { CredentialTypeDefinition } from "@zerodot/node-sdk";
import { z } from "zod";
import { REDIS_ICON } from "./icon";
import { connectRedis } from "./redis";

export const redisCredential: CredentialTypeDefinition = {
  type: "redis",
  label: "Redis",
  // Empty means: port 6379, database 0, no TLS.
  fields: z.object({
    host: z.string().min(1),
    port: z
      .string()
      .regex(/^\d{1,5}$/, "Not a port number")
      .optional(),
    user: z.string().min(1).optional(),
    password: z.string().min(1).optional(),
    database: z
      .string()
      .regex(/^\d{1,3}$/, "Not a database number")
      .optional(),
    ssl: z.enum(["true", "false"]).optional(),
  }),
  secretFields: ["password"],
  icon: "Database",
  iconUrl: REDIS_ICON,
  async test(credential) {
    const client = await connectRedis(credential);
    try {
      await client.ping();
    } finally {
      client.disconnect();
    }
  },
};
