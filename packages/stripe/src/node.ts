// SPDX-License-Identifier: AGPL-3.0-only
import { defineNode } from "@zerodot/node-sdk";
import { callStripe, callStripeList, STRIPE_CREDENTIAL, stripeAccess } from "./api";
import { stripeConfig } from "./config";
import { STRIPE_ICON } from "./icon";
import { buildRequest } from "./request";

export default defineNode({
  type: "stripe.api",
  label: "Stripe",
  description:
    "Manage customers, payments, invoices, subscriptions, refunds, and products with Stripe",
  category: "integration",
  app: "Stripe",
  // The names of the actions of the Stripe node.
  actions: [
    { label: "Create a customer", config: { resource: "customer", operation: "create" } },
    { label: "Get a customer", config: { resource: "customer", operation: "get" } },
    { label: "Update a customer", config: { resource: "customer", operation: "update" } },
    { label: "Delete a customer", config: { resource: "customer", operation: "delete" } },
    { label: "List customers", config: { resource: "customer", operation: "list" } },
    {
      label: "Create a payment intent",
      config: { resource: "paymentIntent", operation: "create" },
    },
    { label: "Get a payment intent", config: { resource: "paymentIntent", operation: "get" } },
    {
      label: "Confirm a payment intent",
      config: { resource: "paymentIntent", operation: "confirm" },
    },
    {
      label: "Cancel a payment intent",
      config: { resource: "paymentIntent", operation: "cancel" },
    },
    { label: "List payment intents", config: { resource: "paymentIntent", operation: "list" } },
    { label: "Get a charge", config: { resource: "charge", operation: "get" } },
    { label: "List charges", config: { resource: "charge", operation: "list" } },
    { label: "Create a refund", config: { resource: "refund", operation: "create" } },
    { label: "Get a refund", config: { resource: "refund", operation: "get" } },
    { label: "List refunds", config: { resource: "refund", operation: "list" } },
    { label: "Create an invoice", config: { resource: "invoice", operation: "create" } },
    { label: "Get an invoice", config: { resource: "invoice", operation: "get" } },
    { label: "Finalize an invoice", config: { resource: "invoice", operation: "finalize" } },
    { label: "Pay an invoice", config: { resource: "invoice", operation: "pay" } },
    { label: "Void an invoice", config: { resource: "invoice", operation: "void" } },
    { label: "List invoices", config: { resource: "invoice", operation: "list" } },
    { label: "Create a subscription", config: { resource: "subscription", operation: "create" } },
    { label: "Get a subscription", config: { resource: "subscription", operation: "get" } },
    { label: "Update a subscription", config: { resource: "subscription", operation: "update" } },
    { label: "Cancel a subscription", config: { resource: "subscription", operation: "cancel" } },
    { label: "List subscriptions", config: { resource: "subscription", operation: "list" } },
    { label: "Create a product", config: { resource: "product", operation: "create" } },
    { label: "Get a product", config: { resource: "product", operation: "get" } },
    { label: "List products", config: { resource: "product", operation: "list" } },
    { label: "Create a price", config: { resource: "price", operation: "create" } },
    { label: "Get a price", config: { resource: "price", operation: "get" } },
    { label: "List prices", config: { resource: "price", operation: "list" } },
    { label: "Create a coupon", config: { resource: "coupon", operation: "create" } },
    { label: "Get a coupon", config: { resource: "coupon", operation: "get" } },
    { label: "List coupons", config: { resource: "coupon", operation: "list" } },
    { label: "Get the balance", config: { resource: "balance", operation: "get" } },
    {
      label: "Create a Checkout Session",
      config: { resource: "checkoutSession", operation: "create" },
    },
    { label: "Get a Checkout Session", config: { resource: "checkoutSession", operation: "get" } },
  ],
  icon: "CreditCard",
  iconUrl: STRIPE_ICON,
  config: stripeConfig,
  defaultConfig: {
    resource: "customer",
    operation: "create",
    confirmNow: false,
    collectionMethod: "charge_automatically",
    mode: "payment",
    interval: "none",
    duration: "once",
    filters: {},
    returnAll: false,
    limit: 50,
    timeoutMs: 30_000,
  },
  credentialTypes: [STRIPE_CREDENTIAL],
  ports: { in: ["in"], out: ["out"] },
  subtitle: (config) =>
    typeof config.operation === "string"
      ? `${String(config.resource ?? "customer")}: ${config.operation}`
      : undefined,
  async run({ config, credential, signal }) {
    const access = stripeAccess(credential);
    const options = { signal, timeoutMs: config.timeoutMs };
    const request = buildRequest(config);

    if (request.list) {
      const items = await callStripeList(
        access,
        request.call.path,
        request.call.args ?? {},
        config.returnAll ? null : config.limit,
        options,
      );
      return { port: "out", data: items };
    }

    return { port: "out", data: await callStripe(access, request.call, options) };
  },
});
