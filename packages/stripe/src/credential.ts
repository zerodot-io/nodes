// SPDX-License-Identifier: AGPL-3.0-only
import type { CredentialTypeDefinition } from "@zerodot/node-sdk";
import { z } from "zod";
import { callStripe, STRIPE_CREDENTIAL, StripeError, stripeAccess } from "./api";
import { STRIPE_ICON } from "./icon";

const TIMEOUT_MS = 10_000;

export const stripeCredential: CredentialTypeDefinition = {
  type: STRIPE_CREDENTIAL,
  label: "Stripe account",
  fields: z.object({
    /** From Developers > API keys in the Stripe Dashboard. A restricted key also works. */
    secretKey: z.string().min(1).meta({ placeholder: "sk_live_… or rk_live_…" }),
    /** From the webhook endpoint in the Stripe Dashboard. Only the trigger needs it. */
    webhookSecret: z.string().optional().meta({ placeholder: "whsec_…" }),
  }),
  secretFields: ["secretKey", "webhookSecret"],
  icon: "CreditCardIcon",
  iconUrl: STRIPE_ICON,
  async test(credential) {
    const access = stripeAccess(credential);
    if (!/^(sk|rk)_(test|live)_/.test(access.secretKey)) {
      throw new Error('Use a secret key. It starts with "sk_" or "rk_"');
    }
    try {
      await callStripe(
        access,
        { method: "GET", path: "/v1/balance" },
        { signal: AbortSignal.timeout(TIMEOUT_MS), timeoutMs: TIMEOUT_MS },
      );
    } catch (error) {
      // A restricted key without the Balance read permission gets HTTP 403. Stripe accepted
      // the key, so the key is valid. The nodes need only the permissions that they use.
      if (error instanceof StripeError && error.status === 403) return;
      throw error;
    }
  },
};
