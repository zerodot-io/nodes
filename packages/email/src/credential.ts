// SPDX-License-Identifier: AGPL-3.0-only
import type { CredentialTypeDefinition } from "@zerodot/node-sdk";
import { z } from "zod";
import { smtpOptions } from "./email-send";
import { imapOptions } from "./imap";

const TIMEOUT_MS = 10_000;

export const smtpCredential: CredentialTypeDefinition = {
  type: "smtp",
  label: "SMTP",
  // The fields are the usual SMTP settings. The form saves text, so the two
  // switches are "true" or "false". `secure` is on when empty.
  fields: z.object({
    user: z.string().min(1).optional().meta({ placeholder: "you@example.com" }),
    password: z.string().min(1).optional(),
    host: z.string().min(1).meta({ placeholder: "smtp.example.com" }),
    /** Empty means 465. */
    port: z
      .string()
      .regex(/^\d{1,5}$/, "Not a port number")
      .optional()
      .meta({ placeholder: "465" }),
    /** Use SSL/TLS. Empty means true. */
    secure: z.enum(["true", "false"]).optional(),
    /** Do not upgrade to TLS with STARTTLS. Only for SSL/TLS off. */
    disableStartTls: z.enum(["true", "false"]).optional(),
    /** The name of the client, to identify it to the server. */
    hostName: z.string().min(1).optional(),
  }),
  secretFields: ["password"],
  icon: "Mail01Icon",
  async test(credential) {
    const nodemailer = await import("nodemailer");
    const transport = nodemailer.createTransport({
      ...smtpOptions(credential),
      connectionTimeout: TIMEOUT_MS,
      greetingTimeout: TIMEOUT_MS,
    });
    try {
      await transport.verify();
    } finally {
      transport.close();
    }
  },
};

export const imapCredential: CredentialTypeDefinition = {
  type: "imap",
  label: "IMAP",
  // The usual IMAP settings. The form saves text, so the two switches are "true" or
  // "false". `secure` is on when empty. Empty port means 993 (SSL/TLS) or 143.
  fields: z.object({
    user: z.string().min(1).meta({ placeholder: "you@example.com" }),
    password: z.string().min(1),
    host: z.string().min(1).meta({ placeholder: "imap.example.com" }),
    port: z
      .string()
      .regex(/^\d{1,5}$/, "Not a port number")
      .optional()
      .meta({ placeholder: "993" }),
    /** Use SSL/TLS. Empty means true. */
    secure: z.enum(["true", "false"]).optional(),
    allowUnauthorizedCerts: z.enum(["true", "false"]).optional(),
  }),
  secretFields: ["password"],
  icon: "Mail01Icon",
  async test(credential) {
    const { ImapFlow } = await import("imapflow");
    const client = new ImapFlow({ ...imapOptions(credential), connectionTimeout: TIMEOUT_MS });
    client.on("error", () => {});
    await client.connect();
    await client.logout();
  },
};
