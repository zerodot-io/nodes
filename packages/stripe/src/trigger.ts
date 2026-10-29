// SPDX-License-Identifier: AGPL-3.0-only
import { createHmac, timingSafeEqual } from "node:crypto";
import { defineNode, type ResolvedCredential, type WebhookVerdict } from "@zerodot/node-sdk";
import { z } from "zod";
import { STRIPE_CREDENTIAL, stripeAccess } from "./api";
import { STRIPE_ICON } from "./icon";

export const EVENT_TYPES = [
  "*",
  "payment_intent.succeeded",
  "payment_intent.payment_failed",
  "charge.succeeded",
  "charge.failed",
  "charge.refunded",
  "charge.dispute.created",
  "customer.created",
  "customer.updated",
  "customer.deleted",
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
  "customer.subscription.trial_will_end",
  "invoice.created",
  "invoice.finalized",
  "invoice.paid",
  "invoice.payment_failed",
  "invoice.voided",
  "checkout.session.completed",
] as const;

/** Stripe asks for a tolerance of 5 minutes. A request with an older timestamp can be a replay. */
export const TOLERANCE_SECONDS = 300;

export const triggerConfig = z.object({
  events: z
    .array(z.enum(EVENT_TYPES))
    .min(1)
    .default(["payment_intent.succeeded"])
    .meta({
      title: "Trigger On",
      labels: {
        "*": "All Events",
        "payment_intent.succeeded": "Payment Succeeded",
        "payment_intent.payment_failed": "Payment Failed",
        "charge.succeeded": "Charge Succeeded",
        "charge.failed": "Charge Failed",
        "charge.refunded": "Charge Refunded",
        "charge.dispute.created": "Dispute Created",
        "customer.created": "Customer Created",
        "customer.updated": "Customer Updated",
        "customer.deleted": "Customer Deleted",
        "customer.subscription.created": "Subscription Created",
        "customer.subscription.updated": "Subscription Updated",
        "customer.subscription.deleted": "Subscription Canceled",
        "customer.subscription.trial_will_end": "Trial Ends Soon",
        "invoice.created": "Invoice Created",
        "invoice.finalized": "Invoice Finalized",
        "invoice.paid": "Invoice Paid",
        "invoice.payment_failed": "Invoice Payment Failed",
        "invoice.voided": "Invoice Voided",
        "checkout.session.completed": "Checkout Completed",
      },
      hints: {
        "*": "All events that Stripe sends to this address",
        "payment_intent.succeeded": "A payment worked",
        "payment_intent.payment_failed": "A payment did not work",
        "charge.succeeded": "A charge worked",
        "charge.failed": "A charge did not work",
        "charge.refunded": "A charge got a refund, in full or in part",
        "charge.dispute.created": "A customer disputed a charge",
        "customer.created": "A new customer exists",
        "customer.updated": "A customer changed",
        "customer.deleted": "A customer was deleted",
        "customer.subscription.created": "A customer started a subscription",
        "customer.subscription.updated": "A subscription changed, such as its plan or status",
        "customer.subscription.deleted": "A subscription ended",
        "customer.subscription.trial_will_end": "A trial ends in 3 days",
        "invoice.created": "A new invoice exists",
        "invoice.finalized": "An invoice is final and ready for payment",
        "invoice.paid": "An invoice got paid",
        "invoice.payment_failed": "Stripe could not collect an invoice",
        "invoice.voided": "An invoice was voided",
        "checkout.session.completed": "A customer finished a Checkout Session",
      },
    }),
  additionalFields: z
    .object({
      otherEvents: z.string().meta({
        title: "Other Event Types",
        description:
          "More event types with commas between, such as payout.paid. End with .* to match a group, such as invoice.*",
      }),
    })
    .partial()
    .default({}),
});

export type StripeTriggerConfig = z.output<typeof triggerConfig>;

/** The `v1` signature: the hex HMAC-SHA256 of `timestamp.body`, with the signing secret as key. */
export function stripeSignature(secret: string, timestamp: string, payload: string): string {
  return createHmac("sha256", secret).update(`${timestamp}.${payload}`).digest("hex");
}

/** Reads the `Stripe-Signature` header: `t=1700000000,v1=abc,v1=def`. */
export function parseSignatureHeader(header: string | undefined): {
  timestamp: string | undefined;
  signatures: string[];
} {
  let timestamp: string | undefined;
  const signatures: string[] = [];
  for (const part of (header ?? "").split(",")) {
    const [name, ...rest] = part.trim().split("=");
    const value = rest.join("=");
    if (name === "t") timestamp = value;
    else if (name === "v1" && value) signatures.push(value);
  }
  return { timestamp, signatures };
}

/**
 * The value of a header. The SDK types do not say that the keys are lowercase, so this
 * looks for the name in any case.
 */
export function headerOf(headers: Record<string, string>, name: string): string | undefined {
  const wanted = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === wanted) return value;
  }
  return undefined;
}

/** How many event IDs the node remembers. The oldest ID goes first when the set is full. */
export const SEEN_LIMIT = 10_000;
/** The SDK does not remove duplicate events, so the node does it. ID -> end of memory (ms). */
const seen = new Map<string, number>();

/**
 * True if the event ID came in the last two tolerance windows. If not, the node remembers it.
 * Expired IDs go away on each call. `now` is in milliseconds.
 */
export function isDuplicateEvent(id: string, now: number = Date.now()): boolean {
  for (const [key, until] of seen) {
    if (until > now) break; // Entries are in time order, so the rest are still valid.
    seen.delete(key);
  }
  const until = seen.get(id);
  if (until !== undefined && until > now) return true;
  seen.delete(id);
  seen.set(id, now + 2 * TOLERANCE_SECONDS * 1000);
  while (seen.size > SEEN_LIMIT) {
    const oldest = seen.keys().next().value;
    if (oldest === undefined) break;
    seen.delete(oldest);
  }
  return false;
}

/** For tests. */
export const clearSeenEvents = (): void => seen.clear();

/**
 * Checks the signature of a request. One `v1` value must match, and the timestamp must be
 * inside the tolerance. `now` is in milliseconds.
 */
export function verifyStripeRequest(
  secret: string,
  request: { headers: Record<string, string>; rawBody?: string },
  now: number = Date.now(),
  toleranceSeconds: number = TOLERANCE_SECONDS,
): boolean {
  // Without the raw body, the signature cannot be checked.
  if (request.rawBody === undefined) return false;
  const { timestamp, signatures } = parseSignatureHeader(
    headerOf(request.headers, "stripe-signature"),
  );
  if (!timestamp || !/^\d+$/.test(timestamp) || signatures.length === 0) return false;
  if (Math.abs(now / 1000 - Number(timestamp)) > toleranceSeconds) return false;
  const wanted = Buffer.from(stripeSignature(secret, timestamp, request.rawBody));
  return signatures.some((signature) => {
    const given = Buffer.from(signature);
    return given.byteLength === wanted.byteLength && timingSafeEqual(given, wanted);
  });
}

const typesOf = (text: string | undefined): string[] =>
  (text ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

/** Does the event type match a listed type? A type that ends with `.*` matches a group. */
export const matchesType = (type: string, listed: string): boolean =>
  listed === "*" ||
  listed === type ||
  (listed.endsWith(".*") && type.startsWith(listed.slice(0, -1)));

/** Decides about a request that has a valid signature. */
export function checkStripeEvent(config: StripeTriggerConfig, rawBody: string): WebhookVerdict {
  let event: unknown;
  try {
    event = JSON.parse(rawBody);
  } catch {
    return { verdict: "ignore" };
  }
  if (typeof event !== "object" || event === null) return { verdict: "ignore" };
  const { id, type, created, livemode, account, data } = event as Record<string, unknown>;
  if (typeof id !== "string" || typeof type !== "string") return { verdict: "ignore" };
  const listed = [...config.events, ...typesOf(config.additionalFields.otherEvents)];
  if (!listed.some((entry) => matchesType(type, entry))) return { verdict: "ignore" };
  const body = typeof data === "object" && data !== null ? (data as Record<string, unknown>) : {};
  return {
    verdict: "accept",
    input: {
      id,
      type,
      created: typeof created === "number" ? created : null,
      livemode: livemode === true,
      account: typeof account === "string" ? account : null,
      // The Stripe object of the event, such as the payment intent or the invoice.
      object: body.object ?? null,
      // The old values of the fields that changed. Only update events have it.
      previousAttributes: body.previous_attributes ?? null,
    },
  };
}

const webhookSecretOf = (credential: Pick<ResolvedCredential, "type" | "data"> | null) => {
  const { webhookSecret } = stripeAccess(credential);
  if (!webhookSecret) throw new Error('The credential has no "webhookSecret"');
  return webhookSecret;
};

export default defineNode({
  type: "trigger.stripe",
  label: "Stripe Trigger",
  description: "Start the workflow when Stripe sends an event, such as a payment or an invoice",
  category: "trigger",
  app: "Stripe",
  icon: "CreditCard",
  iconUrl: STRIPE_ICON,
  config: triggerConfig,
  defaultConfig: { events: ["payment_intent.succeeded"], additionalFields: {} },
  credentialTypes: [STRIPE_CREDENTIAL],
  ports: { in: [], out: ["out"] },
  subtitle: (config) =>
    Array.isArray(config.events) ? `Events: ${config.events.join(", ")}` : undefined,
  // The input is { id, type, created, livemode, account, object, previousAttributes }.
  run: ({ input }) => ({ port: "out", data: input }),
  // Stripe sends the events to an address that you set as a webhook endpoint in the Dashboard.
  // The Dashboard holds that address, so the trigger cannot set it. Each request has a signature.
  webhook: {
    async receive({ config: raw, credential, request }) {
      let secret: string;
      try {
        secret = webhookSecretOf(credential);
      } catch {
        return { verdict: "forbidden", status: 401 };
      }
      if (!verifyStripeRequest(secret, request)) return { verdict: "forbidden", status: 401 };
      const verdict = checkStripeEvent(triggerConfig.parse(raw), request.rawBody ?? "");
      // Remember only the events that start a workflow. A replay inside the window is ignored.
      if (verdict.verdict === "accept") {
        const id = (verdict.input as { id: string }).id;
        if (isDuplicateEvent(id)) return { verdict: "ignore" };
      }
      return verdict;
    },
    /**
     * The trigger needs the webhook secret for the signature, and nothing else. It makes no call
     * to Stripe, so a restricted key without any permission works.
     */
    async activate({ credential }) {
      webhookSecretOf(credential);
      return null;
    },
  },
  // No `webhookTest`: Stripe sends events only to the address in the Dashboard.
});
