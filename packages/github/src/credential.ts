// SPDX-License-Identifier: AGPL-3.0-only
import type { CredentialTypeDefinition, OAuth2Config, ResolvedCredential } from "@zerodot/node-sdk";
import { z } from "zod";
import { GITHUB_API, GITHUB_OAUTH2_CREDENTIAL, GITHUB_TOKEN_CREDENTIAL } from "./api";
import { GITHUB_ICON } from "./icon";

const TIMEOUT_MS = 10_000;
const DEFAULT_SCOPES = ["repo", "read:user"];

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

/**
 * GitHub, and GitHub Enterprise Server when `server` is set (its API address, for example
 * `https://ghe.example.com/api/v3`). The sign-in pages are on the host of the server.
 */
export function githubOAuth2(data: Record<string, unknown>): OAuth2Config | null {
  const server = text(data.server) ?? GITHUB_API;
  let origin: string;
  try {
    origin = server === GITHUB_API ? "https://github.com" : new URL(server).origin;
  } catch {
    return null;
  }
  const scope = text(data.scope);
  return {
    authUrl: `${origin}/login/oauth/authorize`,
    tokenUrl: `${origin}/login/oauth/access_token`,
    scopes: scope ? scope.split(/[\s,]+/).filter(Boolean) : DEFAULT_SCOPES,
    authentication: "body",
    pkce: true,
  };
}

async function check({ data }: ResolvedCredential): Promise<void> {
  const token = text(data.accessToken);
  if (!token) throw new Error("The credential is not connected to an account yet");
  const base = (text(data.server) ?? GITHUB_API).replace(/\/+$/, "");
  const response = await fetch(`${base}/user`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "User-Agent": "zerodot",
    },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (response.status === 401) throw new Error("GitHub did not accept the token");
  if (!response.ok) throw new Error(`GitHub answered with status ${response.status}`);
}

export const githubTokenCredential: CredentialTypeDefinition = {
  type: GITHUB_TOKEN_CREDENTIAL,
  label: "GitHub access token",
  fields: z.object({
    accessToken: z.string().min(1).meta({ placeholder: "ghp_…" }),
    /** The API address of GitHub Enterprise Server. Empty means github.com. */
    server: z.url().optional().meta({ placeholder: "https://api.github.com" }),
  }),
  secretFields: ["accessToken"],
  icon: "Key01Icon",
  iconUrl: GITHUB_ICON,
  test: check,
};

export const githubOAuth2Credential: CredentialTypeDefinition = {
  type: GITHUB_OAUTH2_CREDENTIAL,
  label: "GitHub OAuth2",
  fields: z.object({
    clientId: z.string().min(1),
    clientSecret: z.string().min(1),
    /** The API address of GitHub Enterprise Server. Empty means github.com. */
    server: z.url().optional().meta({ placeholder: "https://api.github.com" }),
    /** Scopes, separated by spaces. Empty means `repo read:user`. */
    scope: z.string().optional().meta({ placeholder: "repo read:user" }),
    ...oauth2TokenShape,
  }),
  secretFields: ["clientSecret", "accessToken", "refreshToken"],
  serverFields: [...OAUTH2_TOKEN_FIELDS],
  oauth2: githubOAuth2,
  icon: "Key01Icon",
  iconUrl: GITHUB_ICON,
  test: check,
};
