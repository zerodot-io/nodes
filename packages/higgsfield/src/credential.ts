// SPDX-License-Identifier: AGPL-3.0-only
import type { CredentialTypeDefinition } from "@zerodot/node-sdk";
import { z } from "zod";
import { callHiggsfield, HIGGSFIELD_CREDENTIAL, HiggsfieldError, higgsfieldAccess } from "./api";
import { HIGGSFIELD_ICON } from "./icon";

const TIMEOUT_MS = 10_000;
/** No request has this ID. The answer shows if the key works. */
const UNKNOWN_REQUEST = "00000000-0000-0000-0000-000000000000";

export const higgsfieldCredential: CredentialTypeDefinition = {
  type: HIGGSFIELD_CREDENTIAL,
  label: "Higgsfield API key",
  fields: z.object({
    /** From Higgsfield Console, with the secret. */
    keyId: z
      .string()
      .min(1)
      .regex(/^[^\s:]+$/, "No spaces or colons")
      .meta({ title: "API Key ID" }),
    keySecret: z.string().min(1).meta({ title: "API Key Secret" }),
  }),
  secretFields: ["keySecret"],
  icon: "Video",
  iconUrl: HIGGSFIELD_ICON,
  async test(credential) {
    const access = higgsfieldAccess(credential);
    try {
      await callHiggsfield(
        access,
        { method: "GET", path: `/requests/${UNKNOWN_REQUEST}/status` },
        { signal: AbortSignal.timeout(TIMEOUT_MS), timeoutMs: TIMEOUT_MS },
      );
    } catch (error) {
      // 404 is the right answer for a request that does not exist: the key works.
      if (error instanceof HiggsfieldError && error.status === 404) return;
      throw error;
    }
  },
};
