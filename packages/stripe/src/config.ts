// SPDX-License-Identifier: AGPL-3.0-only
import { z } from "zod";

// Resource and operation names follow the Stripe REST API.

export const RESOURCES = [
  "customer",
  "paymentIntent",
  "charge",
  "refund",
  "invoice",
  "subscription",
  "product",
  "price",
  "coupon",
  "balance",
  "checkoutSession",
] as const;
export type Resource = (typeof RESOURCES)[number];

export const OPERATIONS_OF = {
  customer: ["create", "get", "update", "delete", "list"],
  paymentIntent: ["create", "get", "confirm", "cancel", "list"],
  charge: ["get", "list"],
  refund: ["create", "get", "list"],
  invoice: ["create", "get", "finalize", "pay", "void", "list"],
  subscription: ["create", "get", "update", "cancel", "list"],
  product: ["create", "get", "list"],
  price: ["create", "get", "list"],
  coupon: ["create", "get", "list"],
  balance: ["get"],
  checkoutSession: ["create", "get"],
} as const satisfies Record<Resource, readonly string[]>;

const ALL_OPERATIONS = [...new Set(Object.values(OPERATIONS_OF).flat())] as [string, ...string[]];

export const CANCEL_REASONS = [
  "duplicate",
  "fraudulent",
  "requested_by_customer",
  "abandoned",
] as const;
export const REFUND_REASONS = ["duplicate", "fraudulent", "requested_by_customer"] as const;
export const COLLECTION_METHODS = ["charge_automatically", "send_invoice"] as const;
export const CHECKOUT_MODES = ["payment", "subscription", "setup"] as const;
export const DURATIONS = ["once", "repeating", "forever"] as const;
export const INTERVALS = ["none", "day", "week", "month", "year"] as const;

type Operations = { [R in Resource]?: readonly (typeof OPERATIONS_OF)[R][number][] };

/** Show a field for these operations of these resources. */
const on = (operations: Operations) => ({
  showWhen: Object.entries(operations).map(([resource, ops]) => ({
    resource: [resource],
    operation: [...(ops ?? [])],
  })),
});

const isList = on({
  customer: ["list"],
  paymentIntent: ["list"],
  charge: ["list"],
  refund: ["list"],
  invoice: ["list"],
  subscription: ["list"],
  product: ["list"],
  price: ["list"],
  coupon: ["list"],
});

/** The operations that send a POST. Stripe can run them only once for one Idempotency Key. */
const isWrite = on({
  customer: ["create", "update"],
  paymentIntent: ["create", "confirm", "cancel"],
  refund: ["create"],
  invoice: ["create", "finalize", "pay", "void"],
  subscription: ["create", "update"],
  product: ["create"],
  price: ["create"],
  coupon: ["create"],
  checkoutSession: ["create"],
});

export const stripeConfig = z
  .object({
    resource: z
      .enum(RESOURCES)
      .default("customer")
      .meta({
        labels: {
          customer: "Customer",
          paymentIntent: "Payment Intent",
          charge: "Charge",
          refund: "Refund",
          invoice: "Invoice",
          subscription: "Subscription",
          product: "Product",
          price: "Price",
          coupon: "Coupon",
          balance: "Balance",
          checkoutSession: "Checkout Session",
        },
        hints: {
          customer: "Create, get, change, delete, or list customers",
          paymentIntent: "Collect a payment from a customer",
          charge: "Get or list the charges of your account",
          refund: "Give money back for a payment",
          invoice: "Bill a customer",
          subscription: "Bill a customer again and again",
          product: "Something that you sell",
          price: "How much a product costs, and how often",
          coupon: "A discount that a customer can use",
          balance: "Get the balance of your account",
          checkoutSession: "A Stripe page where a customer pays",
        },
      }),
    operation: z
      .enum(ALL_OPERATIONS)
      .default("create")
      .meta({
        labels: {
          create: "Create",
          get: "Get",
          update: "Update",
          delete: "Delete",
          list: "List",
          confirm: "Confirm",
          cancel: "Cancel",
          finalize: "Finalize",
          pay: "Pay",
          void: "Void",
        },
        hints: {
          create: "Make a new object",
          get: "Get one object by its ID",
          update: "Change an object",
          delete: "Delete an object",
          list: "Get many objects",
          confirm: "Confirm a payment intent to try the payment",
          cancel: "Cancel the object",
          finalize: "Close a draft invoice so that it can get paid",
          pay: "Try to pay an open invoice now",
          void: "Cancel an open invoice. It stays on record",
        },
      }),
    id: z
      .string()
      .optional()
      .meta({
        title: "ID",
        ...on({
          customer: ["get", "update", "delete"],
          paymentIntent: ["get", "confirm", "cancel"],
          charge: ["get"],
          refund: ["get"],
          invoice: ["get", "finalize", "pay", "void"],
          subscription: ["get", "update", "cancel"],
          product: ["get"],
          price: ["get"],
          coupon: ["get"],
          checkoutSession: ["get"],
        }),
        description: "The ID of the object, such as cus_123 or pi_123",
      }),
    idempotencyKey: z
      .string()
      .optional()
      .meta({
        ...isWrite,
        description:
          "Stripe runs the request only once for one key. Use it to be safe when you try again",
      }),
    name: z
      .string()
      .optional()
      .meta({
        ...on({ customer: ["create", "update"], product: ["create"], coupon: ["create"] }),
        description: "The name of the customer, the product, or the coupon",
      }),
    email: z
      .string()
      .optional()
      .meta({
        ...on({ customer: ["create", "update"], checkoutSession: ["create"] }),
        description: "The email address of the customer",
      }),
    phone: z
      .string()
      .optional()
      .meta({ ...on({ customer: ["create", "update"] }) }),
    description: z
      .string()
      .optional()
      .meta({
        ...on({
          customer: ["create", "update"],
          paymentIntent: ["create"],
          invoice: ["create"],
          subscription: ["create", "update"],
          product: ["create"],
        }),
      }),
    metadata: z
      .string()
      .optional()
      .meta({
        ...on({
          customer: ["create", "update"],
          paymentIntent: ["create"],
          refund: ["create"],
          invoice: ["create"],
          subscription: ["create", "update"],
          product: ["create"],
          price: ["create"],
          coupon: ["create"],
          checkoutSession: ["create"],
        }),
        ui: "code",
        description: 'Your own data as a JSON object, such as {"order":"42"}',
      }),
    amount: z
      .number()
      .int()
      .min(0)
      .optional()
      .meta({
        ...on({
          paymentIntent: ["create"],
          refund: ["create"],
          price: ["create"],
          coupon: ["create"],
        }),
        description:
          "The amount in the smallest unit of the currency. For USD, 1000 is $10.00. For a coupon, use it or Percent Off",
      }),
    currency: z
      .string()
      .optional()
      .meta({
        ...on({ paymentIntent: ["create"], price: ["create"], coupon: ["create"] }),
        description: "Three letters, such as usd",
      }),
    customer: z
      .string()
      .optional()
      .meta({
        ...on({
          paymentIntent: ["create"],
          invoice: ["create"],
          subscription: ["create"],
          checkoutSession: ["create"],
        }),
        description: "The customer ID, such as cus_123",
      }),
    paymentMethod: z
      .string()
      .optional()
      .meta({
        ...on({
          paymentIntent: ["create", "confirm"],
          invoice: ["pay"],
          subscription: ["create", "update"],
        }),
        description: "The payment method ID, such as pm_123",
      }),
    confirmNow: z
      .boolean()
      .default(false)
      .meta({
        ...on({ paymentIntent: ["create"] }),
        title: "Confirm Now",
        description: "Try the payment at once. This needs a Payment Method",
      }),
    returnUrl: z
      .url()
      .optional()
      .meta({
        ...on({ paymentIntent: ["create", "confirm"] }),
        title: "Return URL",
        description: "The customer comes back to this address after a redirect",
      }),
    cancelReason: z
      .enum(CANCEL_REASONS)
      .optional()
      .meta({
        ...on({ paymentIntent: ["cancel"] }),
        title: "Reason",
        labels: {
          duplicate: "Duplicate",
          fraudulent: "Fraudulent",
          requested_by_customer: "Requested by Customer",
          abandoned: "Abandoned",
        },
        hints: {
          duplicate: "The payment is a copy of another payment",
          fraudulent: "The payment is fraud",
          requested_by_customer: "The customer asked to cancel",
          abandoned: "The customer did not finish the payment",
        },
      }),
    // refunds
    paymentIntent: z
      .string()
      .optional()
      .meta({
        ...on({ refund: ["create"] }),
        description: "The payment intent ID to refund, such as pi_123. Use it or Charge",
      }),
    charge: z
      .string()
      .optional()
      .meta({
        ...on({ refund: ["create"] }),
        description: "The charge ID to refund, such as ch_123. Use it or Payment Intent",
      }),
    refundReason: z
      .enum(REFUND_REASONS)
      .optional()
      .meta({
        ...on({ refund: ["create"] }),
        title: "Reason",
        labels: {
          duplicate: "Duplicate",
          fraudulent: "Fraudulent",
          requested_by_customer: "Requested by Customer",
        },
        hints: {
          duplicate: "The payment is a copy of another payment",
          fraudulent: "The payment is fraud",
          requested_by_customer: "The customer asked for the refund",
        },
      }),
    // invoices
    collectionMethod: z
      .enum(COLLECTION_METHODS)
      .default("charge_automatically")
      .meta({
        ...on({ invoice: ["create"] }),
        labels: { charge_automatically: "Charge Automatically", send_invoice: "Send Invoice" },
        hints: {
          charge_automatically: "Stripe charges the default payment method",
          send_invoice: "Stripe emails the invoice. The customer pays before the due date",
        },
      }),
    daysUntilDue: z
      .number()
      .int()
      .min(1)
      .optional()
      .meta({
        showWhen: {
          resource: ["invoice"],
          operation: ["create"],
          collectionMethod: ["send_invoice"],
        },
        description: "The number of days before the due date",
      }),
    autoAdvance: z
      .boolean()
      .optional()
      .meta({
        ...on({ invoice: ["create", "finalize"] }),
        description: "Let Stripe finalize and collect the invoice by itself",
      }),
    // subscriptions and checkout
    lineItems: z
      .string()
      .optional()
      .meta({
        ...on({ subscription: ["create"], checkoutSession: ["create"] }),
        title: "Prices",
        description:
          "Price IDs with commas between. Add a quantity after a colon, such as price_1:2,price_2",
      }),
    trialDays: z
      .number()
      .int()
      .min(1)
      .optional()
      .meta({ ...on({ subscription: ["create"] }), title: "Trial Days" }),
    cancelAtPeriodEnd: z
      .boolean()
      .optional()
      .meta({
        ...on({ subscription: ["update"] }),
        description: "Cancel the subscription at the end of the paid period",
      }),
    mode: z
      .enum(CHECKOUT_MODES)
      .default("payment")
      .meta({
        ...on({ checkoutSession: ["create"] }),
        labels: { payment: "Payment", subscription: "Subscription", setup: "Setup" },
        hints: {
          payment: "A one-time payment",
          subscription: "A subscription with recurring prices",
          setup: "Save a payment method for later",
        },
      }),
    successUrl: z
      .url()
      .optional()
      .meta({
        ...on({ checkoutSession: ["create"] }),
        title: "Success URL",
        description: "The customer goes here after a payment",
      }),
    cancelUrl: z
      .url()
      .optional()
      .meta({
        ...on({ checkoutSession: ["create"] }),
        title: "Cancel URL",
        description: "The customer goes here if they leave the page",
      }),
    // products and prices
    product: z
      .string()
      .optional()
      .meta({
        ...on({ price: ["create"] }),
        description: "The product ID, such as prod_123",
      }),
    interval: z
      .enum(INTERVALS)
      .default("none")
      .meta({
        ...on({ price: ["create"] }),
        title: "Billing Interval",
        labels: { none: "One Time", day: "Day", week: "Week", month: "Month", year: "Year" },
        hints: {
          none: "The customer pays one time",
          day: "The customer pays every day",
          week: "The customer pays every week",
          month: "The customer pays every month",
          year: "The customer pays every year",
        },
      }),
    // coupons
    percentOff: z
      .number()
      .min(0.01)
      .max(100)
      .optional()
      .meta({
        ...on({ coupon: ["create"] }),
        title: "Percent Off",
        description: "A percent from 0.01 to 100. Use it or Amount",
      }),
    duration: z
      .enum(DURATIONS)
      .default("once")
      .meta({
        ...on({ coupon: ["create"] }),
        labels: { once: "Once", repeating: "Repeating", forever: "Forever" },
        hints: {
          once: "The discount applies to one payment",
          repeating: "The discount applies for some months",
          forever: "The discount applies to all payments",
        },
      }),
    durationInMonths: z
      .number()
      .int()
      .min(1)
      .optional()
      .meta({
        showWhen: { resource: ["coupon"], operation: ["create"], duration: ["repeating"] },
        title: "Months",
        description: "The number of months that the discount applies",
      }),
    // lists
    filters: z
      .object({
        email: z.string().meta({ description: "Only customers with this email address" }),
        customer: z.string().meta({ description: "Only for this customer ID" }),
        status: z.string().meta({
          description:
            "Only with this status, such as open for an invoice or active for a subscription",
        }),
        paymentIntent: z.string().meta({ description: "Only for this payment intent ID" }),
        charge: z.string().meta({ description: "Only for this charge ID" }),
        subscription: z.string().meta({ description: "Only for this subscription ID" }),
        product: z.string().meta({ description: "Only for this product ID" }),
        createdAfter: z.string().meta({
          title: "Created After",
          description: "Date as YYYY-MM-DD",
        }),
        createdBefore: z.string().meta({
          title: "Created Before",
          description: "Date as YYYY-MM-DD",
        }),
      })
      .partial()
      .default({})
      .meta(isList),
    returnAll: z.boolean().default(false).meta(isList),
    limit: z
      .number()
      .int()
      .min(1)
      .max(5000)
      .default(50)
      .meta({
        showWhen: RESOURCES.flatMap((resource) =>
          (OPERATIONS_OF[resource] as readonly string[]).includes("list")
            ? [{ resource: [resource], operation: ["list"], returnAll: [false] }]
            : [],
        ),
      }),
    timeoutMs: z.number().int().min(1).max(300_000).default(30_000),
  })
  .superRefine((config, context) => {
    const operations: readonly string[] = OPERATIONS_OF[config.resource];
    if (!operations.includes(config.operation)) {
      context.addIssue({
        code: "custom",
        path: ["operation"],
        message: `"${config.operation}" is not an operation of "${config.resource}"`,
      });
    }
  });

export type StripeConfig = z.output<typeof stripeConfig>;
