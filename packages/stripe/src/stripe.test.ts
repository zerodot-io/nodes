// SPDX-License-Identifier: AGPL-3.0-only
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { afterEach, describe, it, mock } from "node:test";
import type { NodeDefinition } from "@zerodot/node-sdk";
import { bearerAuth, callStripe, callStripeList, formBody, StripeError } from "./api";
import { stripeConfig } from "./config";
import { credentialTypes, nodes } from "./index";
import { buildRequest, lineItemsOf, metadataOf } from "./request";
import {
  checkStripeEvent,
  matchesType,
  parseSignatureHeader,
  stripeSignature,
  triggerConfig,
  verifyStripeRequest,
} from "./trigger";

const signal = new AbortController().signal;
const options = { signal, timeoutMs: 5_000 };
// Built at run time, so secret scanners do not flag a fake key.
const KEY = `sk_test_${"abcd1234".repeat(3)}`;
const WEBHOOK_SECRET = `whsec_${"abcd1234".repeat(2)}`;
const access = { secretKey: KEY, webhookSecret: WEBHOOK_SECRET };
type Cred = { type: string; data: Record<string, unknown> };
const credential: Cred = {
  type: "stripe.account",
  data: { secretKey: KEY, webhookSecret: WEBHOOK_SECRET },
};

const def = (type: string): NodeDefinition => {
  const found = nodes.find((entry) => entry.type === type);
  if (!found) throw new Error(`no node ${type}`);
  return found;
};

type Call = { url: string; init: RequestInit };
type Answer = { body?: unknown; status?: number; headers?: Record<string, string> };

/** Answers the calls in order. */
function mockFetch(answers: Answer[], calls: Call[] = []) {
  mock.method(globalThis, "fetch", async (url: URL | string, init: RequestInit) => {
    calls.push({ url: String(url), init });
    const answer = answers[calls.length - 1] ?? { body: {} };
    return new Response(JSON.stringify(answer.body ?? {}), {
      status: answer.status ?? 200,
      headers: answer.headers,
    });
  });
  return calls;
}

const headerOf = (call: Call | undefined, name: string) =>
  (call?.init.headers as Record<string, string> | undefined)?.[name];

const formOf = (call: Call | undefined) =>
  Object.fromEntries(new URLSearchParams(String(call?.init.body)));

const run = async (config: Record<string, unknown>) => {
  const definition = def("stripe.api");
  return await definition.run({
    config: definition.config.parse(config),
    input: null,
    credential,
    signal,
    scope: {},
    tables: null,
    sandbox: null,
  } as never);
};

const build = (config: Record<string, unknown>) => buildRequest(stripeConfig.parse(config));

afterEach(() => mock.restoreAll());

describe("stripe config", () => {
  it("checks that the operation belongs to the resource", () => {
    assert.equal(
      stripeConfig.safeParse({ resource: "balance", operation: "create" }).success,
      false,
    );
    assert.equal(stripeConfig.safeParse({ resource: "balance", operation: "get" }).success, true);
  });

  it("has a label and a hint for each option of each select", () => {
    const options: Record<string, readonly string[]> = {
      resource: [
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
      ],
      operation: [
        "create",
        "get",
        "update",
        "delete",
        "list",
        "confirm",
        "cancel",
        "finalize",
        "pay",
        "void",
      ],
      cancelReason: ["duplicate", "fraudulent", "requested_by_customer", "abandoned"],
      refundReason: ["duplicate", "fraudulent", "requested_by_customer"],
      collectionMethod: ["charge_automatically", "send_invoice"],
      duration: ["once", "repeating", "forever"],
      mode: ["payment", "subscription", "setup"],
      interval: ["none", "day", "week", "month", "year"],
    };
    for (const [key, values] of Object.entries(options)) {
      const meta = (stripeConfig.shape as Record<string, { meta(): unknown }>)[key]?.meta() as {
        labels?: Record<string, string>;
        hints?: Record<string, string>;
      };
      for (const value of values) {
        assert.ok(meta.labels?.[value], `${key}.${value} label`);
        assert.ok(meta.hints?.[value], `${key}.${value} hint`);
      }
    }
  });
});

describe("stripe request", () => {
  it("creates a customer with metadata", () => {
    const { call } = build({
      operation: "create",
      email: " ada@example.com ",
      name: "Ada",
      metadata: '{"order":42}',
      idempotencyKey: "key-1",
    });
    assert.equal(call.method, "POST");
    assert.equal(call.path, "/v1/customers");
    assert.equal(call.idempotencyKey, "key-1");
    assert.equal(
      formBody(call.args ?? {}).toString(),
      "email=ada%40example.com&name=Ada&metadata%5Border%5D=42",
    );
  });

  it("checks that an ID is an ID", () => {
    assert.throws(() => build({ operation: "get" }), /needs "id"/);
    assert.throws(() => build({ operation: "get", id: "cus_1/../x" }), /not an ID/);
    assert.equal(build({ operation: "get", id: "cus_123" }).call.path, "/v1/customers/cus_123");
  });

  it("makes a payment intent", () => {
    const { call } = build({
      resource: "paymentIntent",
      operation: "create",
      amount: 1000,
      currency: "USD",
    });
    assert.equal(call.path, "/v1/payment_intents");
    assert.equal(call.args?.currency, "usd");
    assert.equal(formBody(call.args ?? {}).get("automatic_payment_methods[enabled]"), "true");
    assert.throws(
      () =>
        build({
          resource: "paymentIntent",
          operation: "create",
          amount: 1,
          currency: "usd",
          confirmNow: true,
        }),
      /needs "paymentMethod"/,
    );
  });

  it("confirms and cancels a payment intent", () => {
    assert.equal(
      build({ resource: "paymentIntent", operation: "confirm", id: "pi_123" }).call.path,
      "/v1/payment_intents/pi_123/confirm",
    );
    const cancel = build({
      resource: "paymentIntent",
      operation: "cancel",
      id: "pi_123",
      cancelReason: "duplicate",
    });
    assert.equal(cancel.call.path, "/v1/payment_intents/pi_123/cancel");
    assert.deepEqual(cancel.call.args, { cancellation_reason: "duplicate" });
  });

  it("makes a refund from a payment intent or a charge", () => {
    assert.throws(() => build({ resource: "refund", operation: "create" }), /paymentIntent/);
    const { call } = build({
      resource: "refund",
      operation: "create",
      charge: "ch_1",
      amount: 500,
      refundReason: "duplicate",
    });
    assert.equal(call.path, "/v1/refunds");
    assert.equal(formBody(call.args ?? {}).toString(), "charge=ch_1&amount=500&reason=duplicate");
  });

  it("makes and changes invoices", () => {
    assert.throws(
      () =>
        build({
          resource: "invoice",
          operation: "create",
          customer: "cus_1",
          collectionMethod: "send_invoice",
        }),
      /needs "daysUntilDue"/,
    );
    const { call } = build({
      resource: "invoice",
      operation: "create",
      customer: "cus_1",
      collectionMethod: "send_invoice",
      daysUntilDue: 14,
    });
    assert.equal(
      formBody(call.args ?? {}).toString(),
      "customer=cus_1&collection_method=send_invoice&days_until_due=14",
    );
    for (const operation of ["finalize", "pay", "void"]) {
      assert.equal(
        build({ resource: "invoice", operation, id: "in_123" }).call.path,
        `/v1/invoices/in_123/${operation}`,
      );
    }
  });

  it("makes a subscription with price items", () => {
    const { call } = build({
      resource: "subscription",
      operation: "create",
      customer: "cus_1",
      lineItems: "price_1:2, price_2",
      trialDays: 7,
    });
    assert.equal(
      formBody(call.args ?? {}).toString(),
      "customer=cus_1&items%5B0%5D%5Bprice%5D=price_1&items%5B0%5D%5Bquantity%5D=2&items%5B1%5D%5Bprice%5D=price_2&trial_period_days=7",
    );
    const cancel = build({ resource: "subscription", operation: "cancel", id: "sub_123" });
    assert.equal(cancel.call.method, "DELETE");
    assert.equal(
      build({ resource: "subscription", operation: "update", id: "sub_1", cancelAtPeriodEnd: true })
        .call.args?.cancel_at_period_end,
      true,
    );
  });

  it("makes products and prices", () => {
    assert.throws(() => build({ resource: "product", operation: "create" }), /needs "name"/);
    const { call } = build({
      resource: "price",
      operation: "create",
      amount: 1500,
      currency: "usd",
      product: "prod_1",
      interval: "month",
    });
    assert.equal(
      formBody(call.args ?? {}).toString(),
      "unit_amount=1500&currency=usd&product=prod_1&recurring%5Binterval%5D=month",
    );
    assert.equal(
      build({
        resource: "price",
        operation: "create",
        amount: 1,
        currency: "usd",
        product: "prod_1",
      }).call.args?.recurring,
      undefined,
    );
  });

  it("makes a coupon with a percent or an amount", () => {
    assert.throws(() => build({ resource: "coupon", operation: "create" }), /percentOff/);
    assert.throws(
      () => build({ resource: "coupon", operation: "create", percentOff: 10, amount: 5 }),
      /not both/,
    );
    assert.throws(
      () => build({ resource: "coupon", operation: "create", amount: 500 }),
      /needs "currency"/,
    );
    assert.throws(
      () =>
        build({ resource: "coupon", operation: "create", percentOff: 10, duration: "repeating" }),
      /durationInMonths/,
    );
    const { call } = build({
      resource: "coupon",
      operation: "create",
      percentOff: 25,
      duration: "repeating",
      durationInMonths: 3,
      name: "Spring",
    });
    assert.equal(call.path, "/v1/coupons");
    assert.equal(
      formBody(call.args ?? {}).toString(),
      "name=Spring&percent_off=25&duration=repeating&duration_in_months=3",
    );
    assert.equal(
      build({ resource: "coupon", operation: "get", id: "SPRING25" }).call.path,
      "/v1/coupons/SPRING25",
    );
    assert.equal(build({ resource: "coupon", operation: "list" }).list, true);
  });

  it("gets the balance, and makes a Checkout Session", () => {
    assert.equal(build({ resource: "balance", operation: "get" }).call.path, "/v1/balance");
    assert.throws(
      () => build({ resource: "checkoutSession", operation: "create", lineItems: "price_1" }),
      /needs "successUrl"/,
    );
    const { call } = build({
      resource: "checkoutSession",
      operation: "create",
      successUrl: "https://example.com/ok",
      lineItems: "price_1:1",
      email: "a@b.co",
    });
    const form = formBody(call.args ?? {});
    assert.equal(form.get("mode"), "payment");
    assert.equal(form.get("line_items[0][price]"), "price_1");
    assert.equal(form.get("customer_email"), "a@b.co");
  });

  it("lists with filters and a date range", () => {
    const request = build({
      resource: "invoice",
      operation: "list",
      filters: { customer: " cus_1 ", status: "open", createdAfter: "2024-01-01" },
    });
    assert.equal(request.list, true);
    assert.equal(
      formBody(request.call.args ?? {}).toString(),
      "customer=cus_1&status=open&created%5Bgte%5D=1704067200",
    );
    assert.throws(
      () => build({ operation: "list", filters: { createdAfter: "soon" } }),
      /not a date/,
    );
  });

  it("reads metadata and price lines", () => {
    assert.deepEqual(metadataOf('{"a":1,"b":null}'), { a: "1", b: "" });
    assert.throws(() => metadataOf("[1]"), /JSON object/);
    assert.throws(() => metadataOf("x"), /must be JSON/);
    assert.deepEqual(lineItemsOf("price_1", "x"), [{ price: "price_1" }]);
    assert.throws(() => lineItemsOf("price_1:0", "x"), /quantity/);
    assert.throws(() => lineItemsOf("a b", "x"), /not a price ID/);
  });
});

describe("stripe api", () => {
  it("drops empty values, keeps false and 0, and nests objects and lists", () => {
    const form = formBody({
      A: "1",
      B: "",
      C: undefined,
      D: false,
      E: 0,
      F: { g: "x", h: { i: "y" } },
      J: [{ k: "z" }, "w"],
    });
    assert.equal(
      form.toString(),
      "A=1&D=false&E=0&F%5Bg%5D=x&F%5Bh%5D%5Bi%5D=y&J%5B0%5D%5Bk%5D=z&J%5B1%5D=w",
    );
  });

  it("signs with a Bearer key, sends a form, and sends the Idempotency-Key", async () => {
    const calls = mockFetch([{ body: { id: "cus_1" } }]);
    const answer = await callStripe(
      access,
      { method: "POST", path: "/v1/customers", args: { email: "a@b.co" }, idempotencyKey: "k1" },
      options,
    );
    assert.deepEqual(answer, { id: "cus_1" });
    assert.equal(calls[0]?.url, "https://api.stripe.com/v1/customers");
    const headers = calls[0]?.init.headers as Record<string, string>;
    assert.equal(headers.authorization, bearerAuth(access));
    assert.equal(headers["idempotency-key"], "k1");
    assert.match(headers["content-type"] ?? "", /x-www-form-urlencoded/);
    assert.deepEqual(formOf(calls[0]), { email: "a@b.co" });
  });

  it("puts the query of a GET in the address, with no key header", async () => {
    const calls = mockFetch([{ body: {} }]);
    await callStripe(
      access,
      { method: "GET", path: "/v1/customers", args: { email: "a@b.co" }, idempotencyKey: "k1" },
      options,
    );
    assert.equal(calls[0]?.url, "https://api.stripe.com/v1/customers?email=a%40b.co");
    assert.equal(calls[0]?.init.body, undefined);
    assert.equal(headerOf(calls[0], "idempotency-key"), undefined);
  });

  it("gives an error with the code, a hint, and no key", async () => {
    mockFetch([
      {
        status: 404,
        body: {
          error: {
            type: "invalid_request_error",
            code: "resource_missing",
            message: "No such customer: 'cus_x'",
          },
        },
      },
    ]);
    await assert.rejects(
      callStripe(access, { method: "GET", path: "/v1/customers/cus_x" }, options),
      (error: unknown) => {
        assert.ok(error instanceof StripeError);
        assert.equal(error.code, "resource_missing");
        assert.equal(error.status, 404);
        assert.match(error.message, /Check the ID/);
        assert.doesNotMatch(error.message, new RegExp(KEY));
        return true;
      },
    );
  });

  it("reports a rate limit with the wait", async () => {
    mockFetch([{ status: 429, headers: { "retry-after": "7" } }]);
    await assert.rejects(
      callStripe(access, { method: "GET", path: "/v1/balance" }, options),
      (error: unknown) => {
        assert.ok(error instanceof StripeError);
        assert.equal(error.retryAfter, 7);
        assert.match(error.message, /7 seconds/);
        return true;
      },
    );
  });

  it("follows has_more with starting_after until the limit", async () => {
    const calls = mockFetch([
      { body: { data: [{ id: "a" }, { id: "b" }], has_more: true } },
      { body: { data: [{ id: "c" }, { id: "d" }], has_more: false } },
    ]);
    const items = await callStripeList(access, "/v1/customers", { email: "a@b.co" }, 3, options);
    assert.deepEqual(items, [{ id: "a" }, { id: "b" }, { id: "c" }]);
    assert.match(calls[0]?.url ?? "", /limit=3/);
    assert.match(calls[1]?.url ?? "", /starting_after=b/);
    assert.match(calls[1]?.url ?? "", /limit=1/);
  });

  it("stops when there is no more", async () => {
    const calls = mockFetch([{ body: { data: [{ id: "a" }], has_more: false } }]);
    const items = await callStripeList(access, "/v1/customers", {}, null, options);
    assert.deepEqual(items, [{ id: "a" }]);
    assert.equal(calls.length, 1);
  });
});

describe("stripe node", () => {
  it("creates a customer", async () => {
    const calls = mockFetch([{ body: { id: "cus_1" } }]);
    const result = await run({ operation: "create", email: "a@b.co", idempotencyKey: "k" });
    assert.deepEqual(result, { port: "out", data: { id: "cus_1" } });
    assert.deepEqual(formOf(calls[0]), { email: "a@b.co" });
    assert.equal(headerOf(calls[0], "idempotency-key"), "k");
  });

  it("deletes a customer", async () => {
    const calls = mockFetch([{ body: { id: "cus_1", deleted: true } }]);
    const result = await run({ operation: "delete", id: "cus_1" });
    assert.deepEqual(result, { port: "out", data: { id: "cus_1", deleted: true } });
    assert.equal(calls[0]?.init.method, "DELETE");
  });

  it("lists with a limit", async () => {
    mockFetch([{ body: { data: [{ id: "ch_1" }, { id: "ch_2" }], has_more: true } }]);
    const result = await run({ resource: "charge", operation: "list", limit: 1 });
    assert.deepEqual(result, { port: "out", data: [{ id: "ch_1" }] });
  });

  it("needs a Stripe credential", async () => {
    const definition = def("stripe.api");
    await assert.rejects(
      Promise.resolve(
        definition.run({
          config: definition.config.parse({ operation: "create" }),
          credential: null,
          signal,
        } as never),
      ),
      /Stripe credential/,
    );
  });
});

describe("stripe credential", () => {
  it("tests the key against the balance", async () => {
    const calls = mockFetch([{ body: { object: "balance" } }]);
    await credentialTypes[0]?.test?.(credential as never);
    assert.equal(calls[0]?.url, "https://api.stripe.com/v1/balance");
    await assert.rejects(
      credentialTypes[0]?.test?.({
        type: "stripe.account",
        data: { secretKey: `pk_test_${"a".repeat(20)}` },
      } as never) ?? Promise.resolve(),
      /starts with "sk_"/,
    );
  });
});

describe("stripe trigger", () => {
  const NOW = 1_700_000_000_000;
  const stamp = String(NOW / 1000);
  const event = (type: string, extra: Record<string, unknown> = {}) =>
    JSON.stringify({
      id: "evt_1",
      type,
      created: 1_700_000_000,
      livemode: false,
      data: { object: { id: "pi_1", amount: 1000 } },
      ...extra,
    });
  const body = event("payment_intent.succeeded");
  const signed = (payload: string, timestamp = stamp, secret = WEBHOOK_SECRET) =>
    `t=${timestamp},v1=${stripeSignature(secret, timestamp, payload)}`;
  const config = (events: string[], otherEvents?: string) =>
    triggerConfig.parse({ events, additionalFields: otherEvents ? { otherEvents } : {} });

  it("matches an independent HMAC-SHA256 calculation", () => {
    // The check uses node:crypto in the test too, with the documented signed payload format.
    const expected = createHmac("sha256", "whsec_test").update('1700000000.{"a":1}').digest("hex");
    assert.equal(stripeSignature("whsec_test", "1700000000", '{"a":1}'), expected);
    // Value from an independent HMAC-SHA256 calculation (Python hmac), not from this code.
    assert.equal(
      stripeSignature("whsec_test", "1700000000", '{"a":1}'),
      "38877139021993b830af32feea6e18a8da83eb2f6e49ee50bd9e4cf4ca4d3789",
    );
  });

  it("reads the signature header", () => {
    assert.deepEqual(parseSignatureHeader("t=123, v1=aa,v0=bb,v1=cc"), {
      timestamp: "123",
      signatures: ["aa", "cc"],
    });
    assert.deepEqual(parseSignatureHeader(undefined), { timestamp: undefined, signatures: [] });
  });

  it("checks the signature", () => {
    const request = { headers: { "stripe-signature": signed(body) }, rawBody: body };
    assert.equal(verifyStripeRequest(WEBHOOK_SECRET, request, NOW), true);
    assert.equal(verifyStripeRequest("whsec_other", request, NOW), false);
    assert.equal(
      verifyStripeRequest(WEBHOOK_SECRET, { ...request, rawBody: `${body} ` }, NOW),
      false,
    );
    assert.equal(verifyStripeRequest(WEBHOOK_SECRET, { headers: {}, rawBody: body }, NOW), false);
    assert.equal(
      verifyStripeRequest(
        WEBHOOK_SECRET,
        { headers: { "stripe-signature": "t=1" }, rawBody: body },
        NOW,
      ),
      false,
    );
  });

  it("accepts any v1 signature in the header", () => {
    const good = stripeSignature(WEBHOOK_SECRET, stamp, body);
    const header = `t=${stamp},v1=${"0".repeat(64)},v1=${good}`;
    assert.equal(
      verifyStripeRequest(
        WEBHOOK_SECRET,
        { headers: { "stripe-signature": header }, rawBody: body },
        NOW,
      ),
      true,
    );
  });

  it("refuses an old or future timestamp", () => {
    const old = String(NOW / 1000 - 301);
    const request = { headers: { "stripe-signature": signed(body, old) }, rawBody: body };
    assert.equal(verifyStripeRequest(WEBHOOK_SECRET, request, NOW), false);
    assert.equal(verifyStripeRequest(WEBHOOK_SECRET, request, NOW, 600), true);
    const future = String(NOW / 1000 + 301);
    assert.equal(
      verifyStripeRequest(
        WEBHOOK_SECRET,
        { headers: { "stripe-signature": signed(body, future) }, rawBody: body },
        NOW,
      ),
      false,
    );
  });

  it("matches event types and groups", () => {
    assert.equal(matchesType("invoice.paid", "*"), true);
    assert.equal(matchesType("invoice.paid", "invoice.paid"), true);
    assert.equal(matchesType("invoice.paid", "invoice.*"), true);
    assert.equal(matchesType("invoices.paid", "invoice.*"), false);
    assert.equal(matchesType("invoice.paid", "invoice.voided"), false);
  });

  it("accepts the events that the config lists", () => {
    const verdict = checkStripeEvent(config(["payment_intent.succeeded"]), body);
    assert.ok(verdict.verdict === "accept");
    assert.deepEqual(verdict.input, {
      id: "evt_1",
      type: "payment_intent.succeeded",
      created: 1_700_000_000,
      livemode: false,
      account: null,
      object: { id: "pi_1", amount: 1000 },
      previousAttributes: null,
    });
    assert.equal(checkStripeEvent(config(["invoice.paid"]), body).verdict, "ignore");
    assert.equal(checkStripeEvent(config(["*"]), body).verdict, "accept");
    assert.equal(
      checkStripeEvent(config(["invoice.paid"], "payment_intent.*"), body).verdict,
      "accept",
    );
    assert.equal(checkStripeEvent(config(["*"]), "not json").verdict, "ignore");
    assert.equal(checkStripeEvent(config(["*"]), '{"type":"x"}').verdict, "ignore");
  });

  it("rejects a bad signature or a missing webhook secret, and the node has no webhook test", async () => {
    const trigger = def("trigger.stripe");
    const receive = trigger.webhook?.receive;
    assert.ok(receive);
    const request = { method: "POST", headers: {}, query: {}, body: {}, rawBody: body };
    const verdict = await receive({
      config: { events: ["*"] },
      credential,
      url: "https://zerodot.test/hooks/abc",
      request,
    } as never);
    assert.deepEqual(verdict, { verdict: "forbidden", status: 401 });
    const none = await receive({
      config: { events: ["*"] },
      credential: { type: "stripe.account", data: { secretKey: KEY } },
      url: "https://zerodot.test/hooks/abc",
      request,
    } as never);
    assert.deepEqual(none, { verdict: "forbidden", status: 401 });
    assert.equal(trigger.webhookTest, undefined);
  });

  it("accepts a request with a good signature", async () => {
    mock.method(Date, "now", () => NOW);
    const receive = def("trigger.stripe").webhook?.receive;
    assert.ok(receive);
    const verdict = await receive({
      config: { events: ["*"] },
      credential,
      url: "https://zerodot.test/hooks/abc",
      request: {
        method: "POST",
        headers: { "stripe-signature": signed(body) },
        query: {},
        body: {},
        rawBody: body,
      },
    } as never);
    assert.equal(verdict.verdict, "accept");
  });
});
