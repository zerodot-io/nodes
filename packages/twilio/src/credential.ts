// SPDX-License-Identifier: AGPL-3.0-only
import type { CredentialTypeDefinition } from "@zerodot/node-sdk";
import { z } from "zod";
import { accountUrl, callTwilio, TWILIO_CREDENTIAL, twilioAccess } from "./api";
import { TWILIO_ICON } from "./icon";

const TIMEOUT_MS = 10_000;

export const twilioCredential: CredentialTypeDefinition = {
  type: TWILIO_CREDENTIAL,
  label: "Twilio account",
  fields: z.object({
    /** From the Twilio Console dashboard. */
    accountSid: z.string().min(1).meta({ placeholder: "AC…" }),
    /** From the Twilio Console dashboard. The trigger uses it to check the signature. */
    authToken: z.string().min(1).meta({ placeholder: "Auth Token" }),
  }),
  secretFields: ["authToken"],
  icon: "BubbleChatIcon",
  iconUrl: TWILIO_ICON,
  async test(credential) {
    const access = twilioAccess(credential);
    if (!access.accountSid.startsWith("AC")) {
      throw new Error('Use the Account SID. It starts with "AC"');
    }
    await callTwilio(
      access,
      { method: "GET", url: `${accountUrl(access.accountSid, "").slice(0, -1)}.json` },
      { signal: AbortSignal.timeout(TIMEOUT_MS), timeoutMs: TIMEOUT_MS },
    );
  },
};
