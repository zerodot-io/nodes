// SPDX-License-Identifier: AGPL-3.0-only
import type { CredentialTypeDefinition } from "@zerodot/node-sdk";
import { z } from "zod";
import {
  botToken,
  callDiscord,
  DISCORD_API,
  DISCORD_BOT_CREDENTIAL,
  DISCORD_WEBHOOK_CREDENTIAL,
  webhookOf,
} from "./api";
import { DISCORD_ICON } from "./icon";

const TIMEOUT_MS = 10_000;

export const discordBotCredential: CredentialTypeDefinition = {
  type: DISCORD_BOT_CREDENTIAL,
  label: "Discord bot",
  fields: z.object({
    botToken: z.string().min(1).meta({ placeholder: "MTA…" }),
    /** The public key of the application. The trigger checks requests with it. */
    publicKey: z
      .string()
      .regex(/^[0-9a-fA-F]{64}$/)
      .optional()
      .meta({ placeholder: "64 hex characters from the Developer Portal" }),
  }),
  secretFields: ["botToken"],
  icon: "Bot",
  iconUrl: DISCORD_ICON,
  async test(credential) {
    const token = botToken(credential);
    try {
      await callDiscord(
        token,
        { method: "GET", path: "/users/@me" },
        { signal: AbortSignal.timeout(TIMEOUT_MS), timeoutMs: TIMEOUT_MS },
      );
    } catch (error) {
      if (String(error).includes("(401)")) throw new Error("Discord did not accept the bot token");
      throw error;
    }
  },
};

export const discordWebhookCredential: CredentialTypeDefinition = {
  type: DISCORD_WEBHOOK_CREDENTIAL,
  label: "Discord webhook",
  fields: z.object({
    webhookUrl: z.url().meta({ placeholder: "https://discord.com/api/webhooks/123/abc…" }),
  }),
  // The token of the webhook is in the address.
  secretFields: ["webhookUrl"],
  icon: "Webhook",
  iconUrl: DISCORD_ICON,
  async test(credential) {
    const { id, token } = webhookOf(credential);
    const response = await fetch(`${DISCORD_API}/webhooks/${id}/${token}`, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
      redirect: "error",
    });
    if (response.status === 401 || response.status === 404) {
      throw new Error("Discord does not know this webhook");
    }
    if (!response.ok) throw new Error(`Discord answered with status ${response.status}`);
  },
};
