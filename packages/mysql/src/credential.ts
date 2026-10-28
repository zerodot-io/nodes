// SPDX-License-Identifier: AGPL-3.0-only
import type { CredentialTypeDefinition } from "@zerodot/node-sdk";
import { z } from "zod";
import { MYSQL_ICON } from "./icon";
import { mysqlOptions } from "./mysql";

export const mysqlCredential: CredentialTypeDefinition = {
  type: "mysql",
  label: "MySQL",
  // The usual MySQL settings. Empty means: port 3306, no SSL. The form saves text, so
  // the switches are "true" or "false".
  fields: z.object({
    host: z.string().min(1).meta({ placeholder: "db.example.com" }),
    port: z
      .string()
      .regex(/^\d{1,5}$/, "Not a port number")
      .optional()
      .meta({ placeholder: "3306" }),
    database: z.string().min(1).optional().meta({ placeholder: "mydb" }),
    user: z.string().min(1).optional().meta({ placeholder: "root" }),
    password: z.string().min(1).optional(),
    /** Connect with TLS and check the certificate. */
    ssl: z.enum(["true", "false"]).optional(),
    /** Connect with TLS and do not check the certificate. */
    allowUnauthorizedCerts: z.enum(["true", "false"]).optional(),
  }),
  secretFields: ["password"],
  icon: "Database",
  iconUrl: MYSQL_ICON,
  async test(credential) {
    const mysql = await import("mysql2/promise");
    const connection = await mysql.createConnection(mysqlOptions(credential));
    try {
      await connection.ping();
    } finally {
      connection.destroy();
    }
  },
};
