// SPDX-License-Identifier: AGPL-3.0-only
import assert from "node:assert/strict";
import { afterEach, describe, it, mock } from "node:test";
import type { NodeDefinition } from "@zerodot/node-sdk";
import { basicAuth, callTwilio, callTwilioList, formBody, TwilioError } from "./api";
import { twilioConfig } from "./config";
import { credentialTypes, nodes } from "./index";
import { addressOf, buildRequest } from "./request";
import {
  checkTwilioEvent,
  eventOf,
  triggerConfig,
  twilioSignature,
  verifyTwilioRequest,
} from "./trigger";

const signal = new AbortController().signal;
const options = { signal, timeoutMs: 5_000 };
// Built at run time, so secret scanners do not flag a fake SID.
const SID = `AC${"1234abcd".repeat(4)}`;
const access = { accountSid: SID, authToken: "secret-token" };
type Cred = { type: string; data: Record<string, unknown> };
const credential: Cred = {
  type: "twilio.account",
  data: { accountSid: SID, authToken: "secret-token" },
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
    return new Response(answer.status === 204 ? null : JSON.stringify(answer.body ?? {}), {
      status: answer.status ?? 200,
      headers: answer.headers,
    });
  });
  return calls;
}

const formOf = (call: Call | undefined) =>
  Object.fromEntries(new URLSearchParams(String(call?.init.body)));

const run = async (config: Record<string, unknown>) => {
  const definition = def("twilio.api");
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

const build = (config: Record<string, unknown>) => buildRequest(twilioConfig.parse(config), SID);

afterEach(() => mock.restoreAll());

describe("twilio config", () => {
  it("checks that the operation belongs to the resource", () => {
    assert.equal(
      twilioConfig.safeParse({ resource: "phoneNumber", operation: "send" }).success,
      false,
    );
    assert.equal(
      twilioConfig.safeParse({ resource: "phoneNumber", operation: "lookup" }).success,
      true,
    );
  });

  it("has a label and a hint for each option of each select", () => {
    const options: Record<string, readonly string[]> = {
      resource: ["message", "call", "phoneNumber"],
      operation: ["send", "get", "list", "delete", "make", "lookup"],
      channel: ["sms", "whatsapp"],
      lookupFields: ["line_type_intelligence", "caller_name", "sms_pumping_risk"],
    };
    for (const [key, values] of Object.entries(options)) {
      const meta = (twilioConfig.shape as Record<string, { meta(): unknown }>)[key]?.meta() as {
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

describe("twilio request", () => {
  it("sends an SMS with the form fields", () => {
    const { call } = build({ operation: "send", from: "+1415", to: " +1650 ", body: "Hi" });
    assert.equal(call.method, "POST");
    assert.equal(call.url, `https://api.twilio.com/2010-04-01/Accounts/${SID}/Messages.json`);
    assert.deepEqual(call.args, {
      To: "+1650",
      From: "+1415",
      MessagingServiceSid: undefined,
      Body: "Hi",
      MediaUrl: [],
      ContentSid: undefined,
      ContentVariables: undefined,
      StatusCallback: undefined,
    });
  });

  it("adds the whatsapp prefix once", () => {
    assert.equal(addressOf("whatsapp", "+1415"), "whatsapp:+1415");
    assert.equal(addressOf("whatsapp", "whatsapp:+1415"), "whatsapp:+1415");
    assert.equal(addressOf("sms", "+1415"), "+1415");
    const { call } = build({
      operation: "send",
      channel: "whatsapp",
      from: "+1415",
      to: "+1650",
      body: "Hi",
    });
    assert.equal(call.args?.To, "whatsapp:+1650");
    assert.equal(call.args?.From, "whatsapp:+1415");
  });

  it("uses a Messaging Service in place of From", () => {
    const { call } = build({
      operation: "send",
      to: "+1650",
      body: "Hi",
      messagingServiceSid: "MG123",
    });
    assert.equal(call.args?.From, undefined);
    assert.equal(call.args?.MessagingServiceSid, "MG123");
  });

  it("needs a sender, a recipient, and content", () => {
    assert.throws(() => build({ operation: "send", to: "+1", body: "Hi" }), /from/);
    assert.throws(() => build({ operation: "send", from: "+1", body: "Hi" }), /"to"/);
    assert.throws(() => build({ operation: "send", from: "+1", to: "+2" }), /body/);
  });

  it("allows media without a body, and at most 10 media URLs", () => {
    const { call } = build({
      operation: "send",
      from: "+1",
      to: "+2",
      mediaUrls: "https://a.test/1.png, https://a.test/2.png",
    });
    assert.deepEqual(call.args?.MediaUrl, ["https://a.test/1.png", "https://a.test/2.png"]);
    const many = Array.from({ length: 11 }, (_, i) => `https://a.test/${i}.png`).join(",");
    assert.throws(
      () => build({ operation: "send", from: "+1", to: "+2", mediaUrls: many }),
      /at most 10/,
    );
  });

  it("sends a WhatsApp template only on the WhatsApp channel", () => {
    const base = { operation: "send", from: "+1", to: "+2", contentSid: "HX1" };
    const sms = build({ ...base, body: "Hi", contentVariables: '{"1":"Ada"}' });
    assert.equal(sms.call.args?.ContentSid, undefined);
    const wa = build({ ...base, channel: "whatsapp", contentVariables: '{ "1": "Ada" }' });
    assert.equal(wa.call.args?.ContentSid, "HX1");
    assert.equal(wa.call.args?.ContentVariables, '{"1":"Ada"}');
    assert.throws(
      () => build({ ...base, channel: "whatsapp", contentVariables: "[1]" }),
      /JSON object/,
    );
  });

  it("checks that a SID is a SID", () => {
    assert.throws(() => build({ operation: "get", messageSid: "../Calls" }), /not a SID/);
    assert.throws(() => build({ operation: "get" }), /messageSid/);
    const { call } = build({ operation: "get", messageSid: "SM0123456789abcdef" });
    assert.ok(call.url.endsWith("/Messages/SM0123456789abcdef.json"));
  });

  it("lists with filters", () => {
    const { call, itemsKey } = build({
      operation: "list",
      filters: { to: "+1", dateSentAfter: "2026-01-01" },
    });
    assert.equal(itemsKey, "messages");
    assert.equal(call.args?.To, "+1");
    assert.equal(call.args?.["DateSent>"], "2026-01-01");
    const calls = build({ resource: "call", operation: "list", filters: { status: "busy" } });
    assert.equal(calls.itemsKey, "calls");
    assert.equal(calls.call.args?.Status, "busy");
  });

  it("makes a call from TwiML or from an address", () => {
    const twiml = build({
      resource: "call",
      operation: "make",
      from: "+1",
      to: "+2",
      twiml: "<Response/>",
    });
    assert.equal(twiml.call.args?.Twiml, "<Response/>");
    assert.equal(twiml.call.args?.Url, undefined);
    assert.throws(
      () => build({ resource: "call", operation: "make", from: "+1", to: "+2" }),
      /twiml/,
    );
    const url = build({
      resource: "call",
      operation: "make",
      from: "+1",
      to: "+2",
      callMode: "url",
      twimlUrl: "https://a.test/voice",
    });
    assert.equal(url.call.args?.Url, "https://a.test/voice");
  });

  it("looks up a number", () => {
    const { call } = build({
      resource: "phoneNumber",
      operation: "lookup",
      phoneNumber: "+14155550100",
      lookupFields: ["caller_name", "line_type_intelligence"],
    });
    assert.equal(call.url, "https://lookups.twilio.com/v2/PhoneNumbers/%2B14155550100");
    assert.equal(call.args?.Fields, "caller_name,line_type_intelligence");
  });
});

describe("twilio api", () => {
  it("drops empty values and repeats array keys", () => {
    const form = formBody({ A: "1", B: "", C: undefined, D: ["x", "y"] });
    assert.equal(form.toString(), "A=1&D=x&D=y");
  });

  it("signs with Basic auth and sends a form", async () => {
    const calls = mockFetch([{ body: { sid: "SM1" }, status: 201 }]);
    const answer = await callTwilio(
      access,
      { method: "POST", url: "https://api.twilio.com/x.json", args: { To: "+1" } },
      options,
    );
    assert.deepEqual(answer, { sid: "SM1" });
    const headers = calls[0]?.init.headers as Record<string, string>;
    assert.equal(headers.authorization, basicAuth(access));
    assert.match(headers["content-type"] ?? "", /x-www-form-urlencoded/);
    assert.deepEqual(formOf(calls[0]), { To: "+1" });
  });

  it("puts the query of a GET in the address", async () => {
    const calls = mockFetch([{ body: {} }]);
    await callTwilio(
      access,
      { method: "GET", url: "https://api.twilio.com/x.json", args: { To: "+1" } },
      options,
    );
    assert.equal(calls[0]?.url, "https://api.twilio.com/x.json?To=%2B1");
    assert.equal(calls[0]?.init.body, undefined);
  });

  it("gives an error with the code, a hint, and no token", async () => {
    mockFetch([
      {
        status: 400,
        body: { code: 21211, message: "The 'To' number is not a valid phone number." },
      },
    ]);
    await assert.rejects(
      callTwilio(access, { method: "POST", url: "https://api.twilio.com/x.json" }, options),
      (error: unknown) => {
        assert.ok(error instanceof TwilioError);
        assert.equal(error.code, 21211);
        assert.match(error.message, /E\.164/);
        assert.doesNotMatch(error.message, /secret-token/);
        return true;
      },
    );
  });

  it("reports a rate limit with the wait", async () => {
    mockFetch([{ status: 429, headers: { "retry-after": "7" } }]);
    await assert.rejects(
      callTwilio(access, { method: "GET", url: "https://api.twilio.com/x.json" }, options),
      (error: unknown) => {
        assert.ok(error instanceof TwilioError);
        assert.equal(error.retryAfter, 7);
        assert.match(error.message, /7 seconds/);
        return true;
      },
    );
  });

  it("follows the next page until the limit", async () => {
    const calls = mockFetch([
      {
        body: {
          messages: [{ sid: "1" }, { sid: "2" }],
          next_page_uri: "/2010-04-01/p2.json?Page=1",
        },
      },
      { body: { messages: [{ sid: "3" }, { sid: "4" }], next_page_uri: null } },
    ]);
    const items = await callTwilioList(
      access,
      "https://api.twilio.com/2010-04-01/m.json",
      { To: "+1" },
      "messages",
      3,
      options,
    );
    assert.deepEqual(items, [{ sid: "1" }, { sid: "2" }, { sid: "3" }]);
    assert.match(calls[0]?.url ?? "", /PageSize=3/);
    assert.equal(calls[1]?.url, "https://api.twilio.com/2010-04-01/p2.json?Page=1");
  });

  it("refuses a next page on another host", async () => {
    mockFetch([{ body: { messages: [{}], next_page_uri: "https://evil.test/p2" } }]);
    await assert.rejects(
      callTwilioList(access, "https://api.twilio.com/m.json", {}, "messages", null, options),
      /another host/,
    );
  });
});

describe("twilio node", () => {
  it("sends a message", async () => {
    const calls = mockFetch([{ body: { sid: "SM1", status: "queued" }, status: 201 }]);
    const result = await run({ operation: "send", from: "+1", to: "+2", body: "Hi" });
    assert.deepEqual(result, { port: "out", data: { sid: "SM1", status: "queued" } });
    assert.deepEqual(formOf(calls[0]), { To: "+2", From: "+1", Body: "Hi" });
  });

  it("says success for a delete", async () => {
    const calls = mockFetch([{ status: 204 }]);
    const result = await run({ operation: "delete", messageSid: "SM0123456789abcdef" });
    assert.deepEqual(result, { port: "out", data: { success: true } });
    assert.equal(calls[0]?.init.method, "DELETE");
  });

  it("lists with a limit", async () => {
    mockFetch([{ body: { calls: [{ sid: "CA1" }, { sid: "CA2" }] } }]);
    const result = await run({ resource: "call", operation: "list", limit: 1 });
    assert.deepEqual(result, { port: "out", data: [{ sid: "CA1" }] });
  });

  it("needs a Twilio credential", async () => {
    const definition = def("twilio.api");
    await assert.rejects(
      Promise.resolve(
        definition.run({
          config: definition.config.parse({ operation: "send" }),
          credential: null,
          signal,
        } as never),
      ),
      /Twilio credential/,
    );
  });
});

describe("twilio credential", () => {
  it("tests the Account SID against the account", async () => {
    const calls = mockFetch([{ body: { sid: SID } }]);
    await credentialTypes[0]?.test?.(credential as never);
    assert.equal(calls[0]?.url, `https://api.twilio.com/2010-04-01/Accounts/${SID}.json`);
    await assert.rejects(
      credentialTypes[0]?.test?.({
        type: "twilio.account",
        data: { accountSid: "SK123", authToken: "t" },
      } as never) ?? Promise.resolve(),
      /starts with "AC"/,
    );
  });
});

describe("twilio trigger", () => {
  const url = "https://zerodot.test/hooks/abc";
  const incoming = "MessageSid=SM1&Body=Hello&From=%2B1650&To=%2B1415&NumMedia=0";
  const status = "MessageSid=SM1&MessageStatus=delivered&From=%2B1415&To=%2B1650";
  const callStatus = "CallSid=CA1&CallStatus=completed&From=%2B1415&To=%2B1650";
  const config = (events: string[], numbers?: string) =>
    triggerConfig.parse({ events, additionalFields: numbers ? { numbers } : {} });

  it("matches an independent HMAC-SHA1 calculation", () => {
    // Value from an independent HMAC-SHA1 calculation (Python hmac), not from Twilio docs.
    const signature = twilioSignature(
      "12345",
      "https://mycompany.com/myapp.php?foo=1&bar=2",
      new URLSearchParams(
        "CallSid=CA1234567890ABCDE&Caller=%2B14158675309&Digits=1234&From=%2B14158675309&To=%2B18005551212",
      ),
    );
    assert.equal(signature, "RSOYDt4T1cUTdK1PDd93/VVr8B8=");
  });

  it("checks the signature", () => {
    const sign = twilioSignature("secret-token", url, new URLSearchParams(incoming));
    const request = { headers: { "x-twilio-signature": sign }, rawBody: incoming };
    assert.equal(verifyTwilioRequest("secret-token", url, request), true);
    assert.equal(verifyTwilioRequest("other", url, request), false);
    assert.equal(verifyTwilioRequest("secret-token", `${url}/x`, request), false);
    assert.equal(
      verifyTwilioRequest("secret-token", url, { ...request, rawBody: `${incoming}&X=1` }),
      false,
    );
    assert.equal(
      verifyTwilioRequest("secret-token", url, { headers: {}, rawBody: incoming }),
      false,
    );
  });

  it("rejects a request that has no raw body", () => {
    const sign = twilioSignature("secret-token", url, new URLSearchParams(""));
    assert.equal(
      verifyTwilioRequest("secret-token", url, { headers: { "x-twilio-signature": sign } }),
      false,
    );
    assert.equal(
      verifyTwilioRequest("secret-token", url, {
        headers: { "x-twilio-signature": sign },
        rawBody: "",
      }),
      true,
    );
  });

  it("tells the events apart", () => {
    const of = (body: string) => eventOf(Object.fromEntries(new URLSearchParams(body)));
    assert.equal(of(incoming), "message");
    assert.equal(of(status), "messageStatus");
    assert.equal(of(callStatus), "callStatus");
    assert.equal(of("Foo=1"), undefined);
  });

  it("accepts the events that the config lists", () => {
    const verdict = checkTwilioEvent(config(["message"]), incoming);
    assert.equal(verdict.verdict, "accept");
    assert.ok(verdict.verdict === "accept");
    assert.deepEqual(
      { ...(verdict.input as Record<string, unknown>), params: undefined },
      {
        type: "message",
        sid: "SM1",
        from: "+1650",
        to: "+1415",
        body: "Hello",
        status: null,
        numMedia: 0,
        params: undefined,
      },
    );
    assert.equal(checkTwilioEvent(config(["message"]), status).verdict, "ignore");
    assert.equal(checkTwilioEvent(config(["messageStatus"]), status).verdict, "accept");
    assert.equal(checkTwilioEvent(config(["*"]), callStatus).verdict, "accept");
  });

  it("filters by number, also for WhatsApp", () => {
    assert.equal(checkTwilioEvent(config(["message"], "+1650"), incoming).verdict, "accept");
    assert.equal(checkTwilioEvent(config(["message"], "+1999"), incoming).verdict, "ignore");
    const whatsapp = "MessageSid=SM1&Body=Hi&From=whatsapp%3A%2B1650&To=whatsapp%3A%2B1415";
    assert.equal(checkTwilioEvent(config(["message"], "+1650"), whatsapp).verdict, "accept");
  });

  it("rejects a request with a bad signature, and the node has no webhook test", async () => {
    const trigger = def("trigger.twilio");
    const receive = trigger.webhook?.receive;
    assert.ok(receive);
    const verdict = await receive({
      config: { events: ["message"] },
      credential,
      url,
      request: { method: "POST", headers: {}, query: {}, body: {}, rawBody: incoming },
    } as never);
    assert.deepEqual(verdict, { verdict: "forbidden", status: 401 });
    assert.equal(trigger.webhookTest, undefined);
  });
});
