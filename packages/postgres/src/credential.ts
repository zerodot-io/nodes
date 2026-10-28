// SPDX-License-Identifier: AGPL-3.0-only
import type { CredentialTypeDefinition } from "@zerodot/node-sdk";
import { z } from "zod";
import { POSTGRES_ICON } from "./icon";
import { loadPostgres, postgresOptions } from "./postgres";

export const postgresCredential: CredentialTypeDefinition = {
  type: "postgres",
  label: "Postgres",
  // The usual Postgres settings, without an SSH tunnel. Empty means:
  // port 5432, database and user `postgres`, SSL `disable`. The form saves text, so the switch
  // is "true" or "false".
  fields: z.object({
    host: z.string().min(1).meta({ placeholder: "db.example.com" }),
    database: z.string().min(1).optional().meta({ placeholder: "postgres" }),
    user: z.string().min(1).optional().meta({ placeholder: "postgres" }),
    password: z.string().min(1).optional(),
    /** Connect with TLS and do not check the certificate. The SSL setting is not used then. */
    allowUnauthorizedCerts: z.enum(["true", "false"]).optional(),
    ssl: z.enum(["allow", "disable", "require"]).optional(),
    port: z
      .string()
      .regex(/^\d{1,5}$/, "Not a port number")
      .optional()
      .meta({ placeholder: "5432" }),
  }),
  secretFields: ["password"],
  icon: "Database",
  iconUrl: POSTGRES_ICON,
  async test(credential) {
    const postgres = await loadPostgres();
    const sql = postgres({ ...postgresOptions(credential), connect_timeout: 10 });
    try {
      await sql`select 1`;
    } finally {
      await sql.end({ timeout: 1 });
    }
  },
};
