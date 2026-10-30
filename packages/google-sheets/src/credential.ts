// SPDX-License-Identifier: AGPL-3.0-only
import type { CredentialTypeDefinition, OAuth2Config, ResolvedCredential } from "@zerodot/node-sdk";
import { z } from "zod";
import {
  callSheets,
  parseServiceAccountKey,
  SHEETS_OAUTH2_CREDENTIAL,
  SHEETS_SCOPE,
  SHEETS_SERVICE_ACCOUNT_CREDENTIAL,
  sheetsToken,
} from "./api";
import { SHEETS_ICON } from "./icon";

const TIMEOUT_MS = 10_000;

/** Google sign-in. `access_type=offline` and `prompt=consent` give a refresh token. */
export const GOOGLE_OAUTH2: OAuth2Config = {
  authUrl: "https://accounts.google.com/o/oauth2/v2/auth",
  tokenUrl: "https://oauth2.googleapis.com/token",
  scopes: [SHEETS_SCOPE],
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

/**
 * Gets a token, then asks for a spreadsheet that does not exist. A 404 means that the token
 * works and the Sheets API is on. A 401 or a 403 throws with the text of Google.
 */
async function check(credential: ResolvedCredential): Promise<void> {
  const options = { signal: AbortSignal.timeout(TIMEOUT_MS), timeoutMs: TIMEOUT_MS };
  const token = await sheetsToken(credential, options);
  try {
    await callSheets(
      token,
      {
        method: "GET",
        path: "/zerodot-credential-test",
        query: { fields: "spreadsheetId" },
        action: "check the credential",
      },
      options,
    );
  } catch (error) {
    if (error instanceof Error && / \((404|400)[ )]/.test(error.message)) return;
    throw error;
  }
}

export const sheetsOAuth2Credential: CredentialTypeDefinition = {
  type: SHEETS_OAUTH2_CREDENTIAL,
  label: "Google Sheets OAuth2",
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
  icon: "Table01Icon",
  iconUrl: SHEETS_ICON,
  test: check,
};

export const sheetsServiceAccountCredential: CredentialTypeDefinition = {
  type: SHEETS_SERVICE_ACCOUNT_CREDENTIAL,
  label: "Google Sheets service account",
  fields: z.object({
    /** The JSON key file of the service account, as text. */
    serviceAccountKey: z
      .string()
      .min(1)
      .refine(isKey, 'Paste the JSON key file. It needs "client_email" and "private_key"')
      .meta({ placeholder: '{ "type": "service_account", "client_email": "…", … }' }),
  }),
  secretFields: ["serviceAccountKey"],
  icon: "Table01Icon",
  iconUrl: SHEETS_ICON,
  test: check,
};
