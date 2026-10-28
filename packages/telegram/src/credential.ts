// SPDX-License-Identifier: AGPL-3.0-only
import type { CredentialTypeDefinition } from "@zerodot/node-sdk";
import { z } from "zod";
import { DEFAULT_BASE_URL, TELEGRAM_CREDENTIAL } from "./api";
import { TELEGRAM_ICON } from "./icon";

const TIMEOUT_MS = 10_000;

const text = (value: unknown): string | undefined =>
  typeof value === "string" && value !== "" ? value : undefined;

export const telegramCredential: CredentialTypeDefinition = {
  type: TELEGRAM_CREDENTIAL,
  label: "Telegram bot",
  fields: z.object({
    accessToken: z.string().min(1).meta({ placeholder: "123456:ABC-DEF…" }),
    baseUrl: z.url().optional().meta({ placeholder: "https://api.telegram.org" }),
  }),
  secretFields: ["accessToken"],
  icon: "Send",
  iconUrl: TELEGRAM_ICON,
  async test({ data }) {
    const token = text(data.accessToken);
    if (!token) throw new Error('The credential has no "accessToken"');
    const base = (text(data.baseUrl) ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
    const response = await fetch(`${base}/bot${token}/getMe`, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (response.status === 401 || response.status === 404) {
      throw new Error("Telegram did not accept the token");
    }
    if (!response.ok) throw new Error(`Telegram answered with status ${response.status}`);
  },
};
