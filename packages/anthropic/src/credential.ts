// SPDX-License-Identifier: AGPL-3.0-only
import type { CredentialTypeDefinition } from "@zerodot/node-sdk";
import { z } from "zod";
import { ANTHROPIC_CREDENTIAL, anthropicAccess, callAnthropic } from "./api";
import { ANTHROPIC_ICON } from "./icon";

const TIMEOUT_MS = 10_000;

export const anthropicCredential: CredentialTypeDefinition = {
  type: ANTHROPIC_CREDENTIAL,
  label: "Anthropic API key",
  fields: z.object({
    /** From the Anthropic Console. */
    apiKey: z.string().min(1).meta({ placeholder: "sk-ant-…" }),
    /** Optional. For a proxy or a gateway. Default: https://api.anthropic.com */
    baseUrl: z.string().optional().meta({ placeholder: "https://api.anthropic.com" }),
  }),
  secretFields: ["apiKey"],
  icon: "Sparkles",
  iconUrl: ANTHROPIC_ICON,
  async test(credential) {
    await callAnthropic(
      anthropicAccess(credential),
      { method: "GET", path: "/v1/models", query: { limit: 1 } },
      { signal: AbortSignal.timeout(TIMEOUT_MS), timeoutMs: TIMEOUT_MS },
    );
  },
};
