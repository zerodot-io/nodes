// SPDX-License-Identifier: AGPL-3.0-only
import type { CredentialTypeDefinition } from "@zerodot/node-sdk";
import { z } from "zod";
import { callNotion, NOTION_CREDENTIAL, notionAccess } from "./api";
import { NOTION_ICON } from "./icon";

const TIMEOUT_MS = 10_000;

export const notionCredential: CredentialTypeDefinition = {
  type: NOTION_CREDENTIAL,
  label: "Notion integration",
  fields: z.object({
    /** From notion.so/profile/integrations. Share pages with the integration to give it access. */
    token: z.string().min(1).meta({ placeholder: "ntn_…" }),
  }),
  secretFields: ["token"],
  icon: "FileText",
  iconUrl: NOTION_ICON,
  async test(credential) {
    const access = notionAccess(credential);
    await callNotion(
      access,
      { method: "GET", path: "/v1/users/me" },
      { signal: AbortSignal.timeout(TIMEOUT_MS), timeoutMs: TIMEOUT_MS },
    );
  },
};
