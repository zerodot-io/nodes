// SPDX-License-Identifier: AGPL-3.0-only
import type { CredentialTypeDefinition, ResolvedCredential } from "@zerodot/node-sdk";
import { z } from "zod";
import { FEEDBACKJAR_CREDENTIAL, feedbackjarAccess } from "./api";
import { FEEDBACKJAR_ICON } from "./icon";

const TIMEOUT_MS = 10_000;

/**
 * Checks the token with a cheap read. An account token cannot read boards without a project ID,
 * so it reads the list of projects.
 */
async function check({ type, data }: ResolvedCredential): Promise<void> {
  const access = feedbackjarAccess({ type, data }, { needsOrganization: false });
  const path =
    access.token.startsWith("fj_user_") && !access.organizationId ? "/organizations" : "/boards";
  const response = await fetch(`${access.baseUrl}${path}`, {
    headers: {
      authorization: `Bearer ${access.token}`,
      accept: "application/json",
      "user-agent": "zerodot",
      ...(access.organizationId ? { "x-organization-id": access.organizationId } : {}),
    },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (response.status === 401) throw new Error("FeedbackJar did not accept the token");
  if (!response.ok) throw new Error(`FeedbackJar answered with status ${response.status}`);
}

export const feedbackjarCredential: CredentialTypeDefinition = {
  type: FEEDBACKJAR_CREDENTIAL,
  label: "FeedbackJar API token",
  fields: z.object({
    apiToken: z.string().min(1).meta({
      title: "API Token",
      placeholder: "fj_live_…",
      description: "A project token (fj_live_) or an account token (fj_user_)",
    }),
    organizationId: z.string().optional().meta({
      title: "Project ID",
      description: "Needed for an account token. Empty for a project token",
    }),
    signingSecret: z.string().optional().meta({
      title: "Webhook Signing Secret",
      placeholder: "whsec_…",
      description:
        "For the trigger. The secret of the webhook in FeedbackJar. Empty skips the check",
    }),
    /** The API address, for a test server. Empty means the FeedbackJar cloud. */
    server: z.url().optional().meta({ placeholder: "https://api.feedbackjar.com/api/v1" }),
  }),
  secretFields: ["apiToken", "signingSecret"],
  icon: "KeyRound",
  iconUrl: FEEDBACKJAR_ICON,
  test: check,
};
