// SPDX-License-Identifier: AGPL-3.0-only
import type { CredentialTypeDefinition } from "@zerodot/node-sdk";
import { z } from "zod";
import { callOpenAI, OPENAI_CREDENTIAL, openaiAccess } from "./api";
import { OPENAI_ICON } from "./icon";

const TIMEOUT_MS = 10_000;

export const openaiCredential: CredentialTypeDefinition = {
  type: OPENAI_CREDENTIAL,
  label: "OpenAI API",
  fields: z.object({
    /** From the API keys page of the OpenAI platform. */
    apiKey: z.string().min(1).meta({ placeholder: "sk-…" }),
    /** Only to bill a request to a specific organization. */
    organization: z.string().optional().meta({ placeholder: "org-… (optional)" }),
    /** Only to bill a request to a specific project. */
    project: z.string().optional().meta({ placeholder: "proj_… (optional)" }),
    /** Only for a compatible service. Empty means https://api.openai.com/v1 */
    baseUrl: z.string().optional().meta({ placeholder: "https://api.openai.com/v1 (optional)" }),
  }),
  secretFields: ["apiKey"],
  icon: "Sparkles",
  iconUrl: OPENAI_ICON,
  async test(credential) {
    const access = openaiAccess(credential);
    await callOpenAI(
      access,
      { method: "GET", path: "/models" },
      { signal: AbortSignal.timeout(TIMEOUT_MS), timeoutMs: TIMEOUT_MS },
    );
  },
};
