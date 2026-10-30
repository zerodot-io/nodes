// SPDX-License-Identifier: AGPL-3.0-only
import type { CredentialTypeDefinition, OAuth2Config, ResolvedCredential } from "@zerodot/node-sdk";
import { z } from "zod";
import {
  callGmail,
  GMAIL_OAUTH2_CREDENTIAL,
  GMAIL_SCOPE,
  GMAIL_SERVICE_ACCOUNT_CREDENTIAL,
  gmailToken,
  parseServiceAccountKey,
} from "./api";
import { GMAIL_ICON } from "./icon";

const TIMEOUT_MS = 10_000;

/** Google sign-in. `access_type=offline` and `prompt=consent` give a refresh token. */
export const GOOGLE_OAUTH2: OAuth2Config = {
  authUrl: "https://accounts.google.com/o/oauth2/v2/auth",
  tokenUrl: "https://oauth2.googleapis.com/token",
  scopes: [GMAIL_SCOPE],
  authQuery: { access_type: "offline", prompt: "consent" },
  authentication: "body",
  pkce: true,
};

/** Fields that only the server writes, after the user connects the account. */
const OAUTH2_TOKEN_FIELDS = [
  "accessToken",
  "refreshToken",
  "expiresAt",
  "tokenType",
  "grantedScope",
] as const;

const isKey = (json: string) => {
  try {
    parseServiceAccountKey(json);
    return true;
  } catch {
    return false;
  }
};

/** Gets a token, then reads the profile of the mailbox. A 401 or a 403 throws with the text of Google. */
async function check(credential: ResolvedCredential): Promise<void> {
  const options = { signal: AbortSignal.timeout(TIMEOUT_MS), timeoutMs: TIMEOUT_MS };
  const token = await gmailToken(credential, options);
  await callGmail(
    token,
    { method: "GET", path: "/profile", action: "check the credential" },
    options,
  );
}

export const gmailOAuth2Credential: CredentialTypeDefinition = {
  type: GMAIL_OAUTH2_CREDENTIAL,
  label: "Gmail OAuth2",
  fields: z.object({
    clientId: z.string().min(1).meta({ placeholder: "…apps.googleusercontent.com" }),
    clientSecret: z.string().min(1),
    accessToken: z.string().min(1).optional(),
    refreshToken: z.string().min(1).optional(),
    /** ISO 8601 time. */
    expiresAt: z.iso.datetime().optional(),
    tokenType: z.string().min(1).optional(),
    grantedScope: z.string().optional(),
  }),
  secretFields: ["clientSecret", "accessToken", "refreshToken"],
  serverFields: [...OAUTH2_TOKEN_FIELDS],
  oauth2: GOOGLE_OAUTH2,
  icon: "Mail01Icon",
  iconUrl: GMAIL_ICON,
  test: check,
};

export const gmailServiceAccountCredential: CredentialTypeDefinition = {
  type: GMAIL_SERVICE_ACCOUNT_CREDENTIAL,
  label: "Gmail service account",
  fields: z.object({
    /** The JSON key file of the service account, as text. */
    serviceAccountKey: z
      .string()
      .min(1)
      .refine(isKey, 'Paste the JSON key file. It needs "client_email" and "private_key"')
      .meta({ placeholder: '{ "type": "service_account", "client_email": "…", … }' }),
    /** The user that the service account acts as. Domain-wide delegation must be on. */
    impersonatedUser: z.string().min(1).meta({ placeholder: "user@example.com" }),
  }),
  secretFields: ["serviceAccountKey"],
  icon: "Mail01Icon",
  iconUrl: GMAIL_ICON,
  test: check,
};
