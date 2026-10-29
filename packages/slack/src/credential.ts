// SPDX-License-Identifier: AGPL-3.0-only
import type { CredentialTypeDefinition } from "@zerodot/node-sdk";
import { z } from "zod";
import { callSlack, SLACK_CREDENTIAL, slackAccess } from "./api";
import { SLACK_ICON } from "./icon";

const TIMEOUT_MS = 10_000;

export const slackCredential: CredentialTypeDefinition = {
  type: SLACK_CREDENTIAL,
  label: "Slack bot",
  fields: z.object({
    /** The Bot User OAuth Token of the app, from OAuth & Permissions. */
    accessToken: z.string().min(1).meta({ placeholder: "xoxb-…" }),
    /** From Basic Information > App Credentials. Only the trigger needs it. */
    signingSecret: z.string().optional().meta({ placeholder: "Signing secret of the app" }),
  }),
  secretFields: ["accessToken", "signingSecret"],
  icon: "MessageSquare",
  iconUrl: SLACK_ICON,
  async test(credential) {
    const access = slackAccess(credential);
    if (!access.token.startsWith("xoxb-")) {
      throw new Error('Use a bot token. It starts with "xoxb-"');
    }
    await callSlack(
      access,
      "auth.test",
      {},
      {
        signal: AbortSignal.timeout(TIMEOUT_MS),
        timeoutMs: TIMEOUT_MS,
      },
    );
  },
};
