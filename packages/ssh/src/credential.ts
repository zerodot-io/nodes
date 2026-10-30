// SPDX-License-Identifier: AGPL-3.0-only
import type { CredentialTypeDefinition } from "@zerodot/node-sdk";
import { z } from "zod";
import { connectSsh } from "./ssh";

const TIMEOUT_MS = 10_000;

const text = (value: unknown): string | undefined =>
  typeof value === "string" && value !== "" ? value : undefined;

export const sshCredential: CredentialTypeDefinition = {
  type: "ssh",
  label: "SSH",
  // For the SSH and SFTP nodes. `authType` is "password" or "privateKey" (a PEM key).
  fields: z.object({
    host: z.string().min(1).meta({ placeholder: "ssh.example.com" }),
    /** Empty means 22. */
    port: z
      .string()
      .regex(/^\d{1,5}$/, "Not a port number")
      .optional()
      .meta({ placeholder: "22" }),
    username: z.string().min(1).meta({ placeholder: "root" }),
    authType: z.enum(["password", "privateKey"]).optional(),
    password: z.string().min(1).optional(),
    privateKey: z.string().min(1).optional(),
    passphrase: z.string().min(1).optional(),
  }),
  secretFields: ["password", "privateKey", "passphrase"],
  icon: "ComputerTerminal01Icon",
  async test(credential) {
    const client = await connectSsh(credential);
    client.end();
  },
};

export const ftpCredential: CredentialTypeDefinition = {
  type: "ftp",
  label: "FTP",
  fields: z.object({
    host: z.string().min(1).meta({ placeholder: "ftp.example.com" }),
    /** Empty means 21. */
    port: z
      .string()
      .regex(/^\d{1,5}$/, "Not a port number")
      .optional()
      .meta({ placeholder: "21" }),
    username: z.string().min(1).optional().meta({ placeholder: "anonymous" }),
    password: z.string().min(1).optional(),
    /** Use FTPS (TLS). Empty means false. */
    secure: z.enum(["true", "false"]).optional(),
  }),
  secretFields: ["password"],
  icon: "FolderOpenIcon",
  async test({ data }) {
    const host = text(data.host);
    if (!host) throw new Error('The credential has no "host"');
    const { Client } = await import("basic-ftp");
    const client = new Client(TIMEOUT_MS);
    try {
      await client.access({
        host,
        port: text(data.port) ? Number(data.port) : 21,
        user: text(data.username) ?? "anonymous",
        password: text(data.password) ?? "anonymous@",
        secure: data.secure === "true",
      });
    } finally {
      client.close();
    }
  },
};
