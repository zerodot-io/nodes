// SPDX-License-Identifier: AGPL-3.0-only
import type { Call } from "./api";
import type { StripeConfig } from "./config";

export type StripeRequest = {
  call: Call;
  /** A list: the node follows the pages. */
  list?: boolean;
};

const need = <T>(value: T | undefined, name: string, operation: string): T => {
  if (value === undefined || (typeof value === "string" && value.trim() === "")) {
    throw new Error(`Stripe ${operation} needs "${name}"`);
  }
  return value;
};

/** An ID goes in a path, so it must be an ID: letters, digits, and underscores only. */
const idOf = (value: string | undefined, operation: string): string => {
  const text = need(value, "id", operation).trim();
  if (!/^[A-Za-z0-9_]{3,255}$/.test(text)) {
    throw new Error(`Stripe ${operation}: "id" is not an ID`);
  }
  return text;
};

const text = (value: string | undefined): string | undefined => value?.trim() || undefined;

/**
 * A field of an update. Text that is blank after trim clears the field: Stripe unsets a field
 * that has an empty string. Nothing (undefined) leaves the field as it is.
 */
const clearable = (value: string | undefined): string | undefined =>
  value === undefined ? undefined : value.trim();

/**
 * A JSON object of text values. Stripe wants `metadata[key]=value`. A `null` value unsets that
 * key. With `clear` (an update), `null` or `{}` gives "", which unsets all keys of the object.
 */
export function metadataOf(
  value: string | undefined,
  clear = false,
): Record<string, string> | "" | undefined {
  if (!value?.trim()) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error('"metadata" must be JSON');
  }
  if (parsed === null && clear) return "";
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error('"metadata" must be a JSON object');
  }
  const entries = Object.entries(parsed);
  if (entries.length === 0) return clear ? "" : undefined;
  return Object.fromEntries(
    entries.map(([key, entry]) => {
      if (entry === null) return [key, ""];
      if (typeof entry === "object") {
        throw new Error(`"metadata" value "${key}" must be text, a number, or a boolean`);
      }
      return [key, String(entry)];
    }),
  );
}

/** Price IDs with commas between and an optional quantity, such as `price_1:2,price_2`. */
export function lineItemsOf(
  value: string | undefined,
  operation: string,
): { price: string; quantity?: number }[] {
  const items = need(value, "lineItems", operation)
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const [price = "", quantity] = entry.split(":").map((part) => part.trim());
      if (!/^[A-Za-z0-9_]+$/.test(price)) {
        throw new Error(`Stripe ${operation}: "${price}" is not a price ID`);
      }
      if (quantity === undefined) return { price };
      const count = Number(quantity);
      if (!Number.isInteger(count) || count < 1) {
        throw new Error(`Stripe ${operation}: the quantity of "${price}" is not valid`);
      }
      return { price, quantity: count };
    });
  if (items.length === 0) throw new Error(`Stripe ${operation} needs "lineItems"`);
  return items;
}

/** A date as Unix seconds. */
function unix(value: string | undefined, name: string): number | undefined {
  const date = text(value);
  if (!date) return undefined;
  const time = Date.parse(date);
  if (Number.isNaN(time)) throw new Error(`"${name}" is not a date`);
  return Math.floor(time / 1000);
}

/** The Stripe call for one operation, without the network. */
export function buildRequest(c: StripeConfig): StripeRequest {
  const op = `${c.resource}.${c.operation}`;
  const key = text(c.idempotencyKey);
  const post = (path: string, args: Record<string, unknown> = {}): StripeRequest => ({
    call: { method: "POST", path, args, idempotencyKey: key },
  });
  const get = (path: string): StripeRequest => ({ call: { method: "GET", path } });
  const created = {
    gte: unix(c.filters.createdAfter, "createdAfter"),
    lte: unix(c.filters.createdBefore, "createdBefore"),
  };
  const list = (path: string, args: Record<string, unknown> = {}): StripeRequest => ({
    call: { method: "GET", path, args: { ...args, created } },
    list: true,
  });

  switch (op) {
    case "customer.create":
      return post("/v1/customers", {
        email: text(c.email),
        name: text(c.name),
        phone: text(c.phone),
        description: c.description?.trim() || undefined,
        metadata: metadataOf(c.metadata),
      });
    case "customer.get":
      return get(`/v1/customers/${idOf(c.id, op)}`);
    case "customer.update":
      return post(`/v1/customers/${idOf(c.id, op)}`, {
        email: clearable(c.email),
        name: clearable(c.name),
        phone: clearable(c.phone),
        description: clearable(c.description),
        metadata: metadataOf(c.metadata, true),
      });
    case "customer.delete":
      return { call: { method: "DELETE", path: `/v1/customers/${idOf(c.id, op)}` } };
    case "customer.list":
      return list("/v1/customers", { email: text(c.filters.email) });

    case "paymentIntent.create": {
      const confirm = c.confirmNow;
      if (confirm) need(c.paymentMethod, "paymentMethod", op);
      return post("/v1/payment_intents", {
        amount: need(c.amount, "amount", op),
        currency: need(c.currency, "currency", op).trim().toLowerCase(),
        customer: text(c.customer),
        payment_method: text(c.paymentMethod),
        description: c.description?.trim() || undefined,
        confirm: confirm ? true : undefined,
        return_url: confirm ? c.returnUrl : undefined,
        automatic_payment_methods: { enabled: true },
        metadata: metadataOf(c.metadata),
      });
    }
    case "paymentIntent.get":
      return get(`/v1/payment_intents/${idOf(c.id, op)}`);
    case "paymentIntent.confirm":
      return post(`/v1/payment_intents/${idOf(c.id, op)}/confirm`, {
        payment_method: text(c.paymentMethod),
        return_url: c.returnUrl,
      });
    case "paymentIntent.cancel":
      return post(`/v1/payment_intents/${idOf(c.id, op)}/cancel`, {
        cancellation_reason: c.cancelReason,
      });
    case "paymentIntent.list":
      return list("/v1/payment_intents", { customer: text(c.filters.customer) });

    case "charge.get":
      return get(`/v1/charges/${idOf(c.id, op)}`);
    case "charge.list":
      return list("/v1/charges", {
        customer: text(c.filters.customer),
        payment_intent: text(c.filters.paymentIntent),
      });

    case "refund.create": {
      const paymentIntent = text(c.paymentIntent);
      const charge = text(c.charge);
      if (!paymentIntent && !charge) {
        throw new Error(`Stripe ${op} needs "paymentIntent" or "charge"`);
      }
      return post("/v1/refunds", {
        payment_intent: paymentIntent,
        charge: paymentIntent ? undefined : charge,
        amount: c.amount,
        reason: c.refundReason,
        metadata: metadataOf(c.metadata),
      });
    }
    case "refund.get":
      return get(`/v1/refunds/${idOf(c.id, op)}`);
    case "refund.list":
      return list("/v1/refunds", {
        payment_intent: text(c.filters.paymentIntent),
        charge: text(c.filters.charge),
      });

    case "invoice.create": {
      const send = c.collectionMethod === "send_invoice";
      if (send) need(c.daysUntilDue, "daysUntilDue", op);
      return post("/v1/invoices", {
        customer: need(c.customer, "customer", op).trim(),
        collection_method: c.collectionMethod,
        days_until_due: send ? c.daysUntilDue : undefined,
        auto_advance: c.autoAdvance,
        description: c.description?.trim() || undefined,
        metadata: metadataOf(c.metadata),
      });
    }
    case "invoice.get":
      return get(`/v1/invoices/${idOf(c.id, op)}`);
    case "invoice.finalize":
      return post(`/v1/invoices/${idOf(c.id, op)}/finalize`, { auto_advance: c.autoAdvance });
    case "invoice.pay":
      return post(`/v1/invoices/${idOf(c.id, op)}/pay`, { payment_method: text(c.paymentMethod) });
    case "invoice.void":
      return post(`/v1/invoices/${idOf(c.id, op)}/void`);
    case "invoice.list":
      return list("/v1/invoices", {
        customer: text(c.filters.customer),
        status: text(c.filters.status),
        subscription: text(c.filters.subscription),
      });

    case "subscription.create":
      return post("/v1/subscriptions", {
        customer: need(c.customer, "customer", op).trim(),
        items: lineItemsOf(c.lineItems, op),
        default_payment_method: text(c.paymentMethod),
        trial_period_days: c.trialDays,
        description: c.description?.trim() || undefined,
        metadata: metadataOf(c.metadata),
      });
    case "subscription.get":
      return get(`/v1/subscriptions/${idOf(c.id, op)}`);
    case "subscription.update":
      return post(`/v1/subscriptions/${idOf(c.id, op)}`, {
        cancel_at_period_end: c.cancelAtPeriodEnd,
        default_payment_method: text(c.paymentMethod),
        description: clearable(c.description),
        metadata: metadataOf(c.metadata, true),
      });
    case "subscription.cancel":
      return { call: { method: "DELETE", path: `/v1/subscriptions/${idOf(c.id, op)}` } };
    case "subscription.list":
      return list("/v1/subscriptions", {
        customer: text(c.filters.customer),
        status: text(c.filters.status),
      });

    case "product.create":
      return post("/v1/products", {
        name: need(c.name, "name", op).trim(),
        description: c.description?.trim() || undefined,
        metadata: metadataOf(c.metadata),
      });
    case "product.get":
      return get(`/v1/products/${idOf(c.id, op)}`);
    case "product.list":
      return list("/v1/products");

    case "price.create":
      return post("/v1/prices", {
        unit_amount: need(c.amount, "amount", op),
        currency: need(c.currency, "currency", op).trim().toLowerCase(),
        product: need(c.product, "product", op).trim(),
        recurring: c.interval === "none" ? undefined : { interval: c.interval },
        metadata: metadataOf(c.metadata),
      });
    case "price.get":
      return get(`/v1/prices/${idOf(c.id, op)}`);
    case "price.list":
      return list("/v1/prices", { product: text(c.filters.product) });

    case "coupon.create": {
      const percent = c.percentOff;
      if (percent === undefined && c.amount === undefined) {
        throw new Error(`Stripe ${op} needs "percentOff" or "amount"`);
      }
      if (percent !== undefined && c.amount !== undefined) {
        throw new Error(`Stripe ${op} needs "percentOff" or "amount", not both`);
      }
      if (c.amount !== undefined) need(c.currency, "currency", op);
      if (c.duration === "repeating") need(c.durationInMonths, "durationInMonths", op);
      return post("/v1/coupons", {
        name: text(c.name),
        percent_off: percent,
        amount_off: c.amount,
        currency: c.amount === undefined ? undefined : c.currency?.trim().toLowerCase(),
        duration: c.duration,
        duration_in_months: c.duration === "repeating" ? c.durationInMonths : undefined,
        metadata: metadataOf(c.metadata),
      });
    }
    case "coupon.get":
      return get(`/v1/coupons/${idOf(c.id, op)}`);
    case "coupon.list":
      return list("/v1/coupons");

    case "balance.get":
      return get("/v1/balance");

    case "checkoutSession.create":
      return post("/v1/checkout/sessions", {
        mode: c.mode,
        success_url: need(c.successUrl, "successUrl", op),
        cancel_url: c.cancelUrl,
        line_items: c.mode === "setup" ? undefined : lineItemsOf(c.lineItems, op),
        customer: text(c.customer),
        customer_email: c.customer ? undefined : text(c.email),
        metadata: metadataOf(c.metadata),
      });
    case "checkoutSession.get":
      return get(`/v1/checkout/sessions/${idOf(c.id, op)}`);
  }
  throw new Error(`Unknown Stripe operation "${op}"`);
}
