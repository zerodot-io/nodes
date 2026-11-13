// SPDX-License-Identifier: AGPL-3.0-only
import type { CredentialTypeDefinition } from "@zerodot/node-sdk";
import { z } from "zod";
import { callGraph, GRAPH_HOST, META_CREDENTIAL, metaAccess } from "./api";
import { META_ICON } from "./icon";

const TIMEOUT_MS = 10_000;

export const metaCredential: CredentialTypeDefinition = {
  type: META_CREDENTIAL,
  label: "Meta Graph API",
  fields: z.object({
    /** A long-lived User or Page access token, from the Graph API Explorer or /oauth/access_token. */
    accessToken: z.string().min(1).meta({ placeholder: "EAAG…" }),
    /** The App secret, from App Settings > Basic. Only the trigger needs it. */
    appSecret: z.string().optional().meta({ placeholder: "App secret of the Meta app" }),
  }),
  secretFields: ["accessToken", "appSecret"],
  icon: "Share2Icon",
  iconUrl: META_ICON,
  async test(credential) {
    const access = metaAccess(credential);
    await callGraph(
      access,
      {
        host: GRAPH_HOST,
        version: "v23.0",
        path: "/me",
        method: "GET",
        params: { fields: "id,name" },
      },
      {
        signal: AbortSignal.timeout(TIMEOUT_MS),
        timeoutMs: TIMEOUT_MS,
      },
    );
  },
};
