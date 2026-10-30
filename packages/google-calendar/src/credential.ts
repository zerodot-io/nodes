// SPDX-License-Identifier: AGPL-3.0-only
import type { CredentialTypeDefinition, OAuth2Config, ResolvedCredential } from "@zerodot/node-sdk";
import { z } from "zod";
import {
  CALENDAR_OAUTH2_CREDENTIAL,
  CALENDAR_SCOPE,
  CALENDAR_SERVICE_ACCOUNT_CREDENTIAL,
  calendarToken,
  callCalendar,
  parseServiceAccountKey,
} from "./api";
import { CALENDAR_ICON } from "./icon";

const TIMEOUT_MS = 10_000;

/** Google sign-in. `access_type=offline` and `prompt=consent` give a refresh token. */
export const GOOGLE_OAUTH2: OAuth2Config = {
  authUrl: "https://accounts.google.com/o/oauth2/v2/auth",
  tokenUrl: "https://oauth2.googleapis.com/token",
  scopes: [CALENDAR_SCOPE],
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

/** Gets a token, then lists one calendar. A 401 or a 403 throws with the text of Google. */
async function check(credential: ResolvedCredential): Promise<void> {
  const options = { signal: AbortSignal.timeout(TIMEOUT_MS), timeoutMs: TIMEOUT_MS };
  const token = await calendarToken(credential, options);
  await callCalendar(
    token,
    {
      method: "GET",
      path: "/users/me/calendarList",
      query: { maxResults: "1", fields: "items(id)" },
      action: "check the credential",
    },
    options,
  );
}

export const calendarOAuth2Credential: CredentialTypeDefinition = {
  type: CALENDAR_OAUTH2_CREDENTIAL,
  label: "Google Calendar OAuth2",
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
  icon: "Calendar01Icon",
  iconUrl: CALENDAR_ICON,
  test: check,
};

export const calendarServiceAccountCredential: CredentialTypeDefinition = {
  type: CALENDAR_SERVICE_ACCOUNT_CREDENTIAL,
  label: "Google Calendar service account",
  fields: z.object({
    /** The JSON key file of the service account, as text. */
    serviceAccountKey: z
      .string()
      .min(1)
      .refine(isKey, 'Paste the JSON key file. It needs "client_email" and "private_key"')
      .meta({ placeholder: '{ "type": "service_account", "client_email": "…", … }' }),
  }),
  secretFields: ["serviceAccountKey"],
  icon: "Calendar01Icon",
  iconUrl: CALENDAR_ICON,
  test: check,
};
