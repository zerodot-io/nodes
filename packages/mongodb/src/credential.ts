// SPDX-License-Identifier: AGPL-3.0-only
import type { CredentialTypeDefinition } from "@zerodot/node-sdk";
import { z } from "zod";
import { MONGODB_ICON } from "./icon";
import { mongoSettings } from "./mongodb";

const TIMEOUT_MS = 10_000;

export const mongodbCredential: CredentialTypeDefinition = {
  type: "mongodb",
  label: "MongoDB",
  fields: z.object({
    /** For example `mongodb://user:pass@host:27017` or a `mongodb+srv://` address. */
    connectionString: z
      .string()
      .regex(/^mongodb(\+srv)?:\/\//, "Must start with mongodb:// or mongodb+srv://")
      .meta({ placeholder: "mongodb://user:password@host:27017" }),
    /** The database to use. */
    database: z.string().min(1).meta({ placeholder: "mydb" }),
  }),
  secretFields: ["connectionString"],
  icon: "Database",
  iconUrl: MONGODB_ICON,
  async test(credential) {
    const { connectionString } = mongoSettings(credential);
    const mongo = await import("mongodb");
    const client = new mongo.MongoClient(connectionString, {
      serverSelectionTimeoutMS: TIMEOUT_MS,
      appName: "zerodot",
    });
    try {
      await client.connect();
      await client.db("admin").command({ ping: 1 });
    } finally {
      await client.close();
    }
  },
};
