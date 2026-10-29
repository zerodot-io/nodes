// SPDX-License-Identifier: AGPL-3.0-only
import type { CredentialTypeDefinition, OAuth2Config, ResolvedCredential } from "@zerodot/node-sdk";
import { z } from "zod";
import {
  callLinear,
  LINEAR_API_KEY_CREDENTIAL,
  LINEAR_OAUTH2_CREDENTIAL,
  linearAccess,
} from "./api";
import { LINEAR_ICON } from "./icon";

const TIMEOUT_MS = 10_000;
const DEFAULT_SCOPES = ["read", "write"];

/** Fields that only the server writes, after the user connects the account. */
const OAUTH2_TOKEN_FIELDS = [
  "accessToken",
  "refreshToken",
  "expiresAt",
  "tokenType",
  "grantedScope",
] as const;

/** Text fields for the token. The user cannot set them. */
const oauth2TokenShape = {
  accessToken: z.string().min(1).optional(),
  refreshToken: z.string().min(1).optional(),
  /** ISO 8601 time. */
  expiresAt: z.iso.datetime().optional(),
  tokenType: z.string().min(1).optional(),
  grantedScope: z.string().optional(),
};

const text = (value: unknown): string | undefined =>
  typeof value === "string" && value !== "" ? value : undefined;

export function linearOAuth2(data: Record<string, unknown>): OAuth2Config {
  const scope = text(data.scope);
  return {
    authUrl: "https://linear.app/oauth/authorize",
    tokenUrl: "https://api.linear.app/oauth/token",
    scopes: scope ? scope.split(/[\s,]+/).filter(Boolean) : DEFAULT_SCOPES,
    authentication: "body",
    pkce: true,
  };
}

async function check(credential: ResolvedCredential): Promise<void> {
  const access = linearAccess(credential);
  await callLinear(
    access,
    { query: "query { viewer { id } }" },
    { signal: AbortSignal.timeout(TIMEOUT_MS), timeoutMs: TIMEOUT_MS },
  );
}

export const linearApiKeyCredential: CredentialTypeDefinition = {
  type: LINEAR_API_KEY_CREDENTIAL,
  label: "Linear API key",
  fields: z.object({
    /** Make a key in Linear: Settings > Account > Security & access. */
    apiKey: z.string().min(1).meta({ placeholder: "lin_api_…" }),
  }),
  secretFields: ["apiKey"],
  icon: "KeyRound",
  iconUrl: LINEAR_ICON,
  test: check,
};

export const linearOAuth2Credential: CredentialTypeDefinition = {
  type: LINEAR_OAUTH2_CREDENTIAL,
  label: "Linear OAuth2",
  fields: z.object({
    clientId: z.string().min(1),
    clientSecret: z.string().min(1),
    /** Scopes, separated by commas or spaces. Empty means `read write`. */
    scope: z.string().optional().meta({ placeholder: "read write" }),
    ...oauth2TokenShape,
  }),
  secretFields: ["clientSecret", "accessToken", "refreshToken"],
  serverFields: [...OAUTH2_TOKEN_FIELDS],
  oauth2: linearOAuth2,
  icon: "KeyRound",
  iconUrl: LINEAR_ICON,
  test: check,
};
