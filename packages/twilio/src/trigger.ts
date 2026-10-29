// SPDX-License-Identifier: AGPL-3.0-only
import { createHmac, timingSafeEqual } from "node:crypto";
import { defineNode, type ResolvedCredential, type WebhookVerdict } from "@zerodot/node-sdk";
import { z } from "zod";
import { callTwilio, TWILIO_CREDENTIAL, twilioAccess } from "./api";
import { TWILIO_ICON } from "./icon";

export const EVENT_TYPES = ["*", "message", "messageStatus", "callStatus"] as const;
export type EventType = Exclude<(typeof EVENT_TYPES)[number], "*">;

export const triggerConfig = z.object({
  events: z
    .array(z.enum(EVENT_TYPES))
    .min(1)
    .default(["message"])
    .meta({
      title: "Trigger On",
      labels: {
        "*": "All Events",
        message: "Incoming Message",
        messageStatus: "Message Status",
        callStatus: "Call Status",
      },
      hints: {
        "*": "All events that Twilio sends to this address",
        message: "Someone sent an SMS, an MMS, or a WhatsApp message to your number",
        messageStatus: "A message that you sent changed status, such as delivered or failed",
        callStatus: "A call that you made changed status, such as completed or busy",
      },
    }),
  additionalFields: z
    .object({
      numbers: z.string().meta({
        description: "Only events for these numbers (From or To), as E.164 with commas between",
      }),
    })
    .partial()
    .default({}),
});

export type TwilioTriggerConfig = z.output<typeof triggerConfig>;

/**
 * The `x-twilio-signature` value of a request: the Base64 HMAC-SHA1 of the full address, then
 * each form field as name and value, sorted by name.
 */
export function twilioSignature(
  authToken: string,
  url: string,
  params: Iterable<[string, string]>,
): string {
  const text = [...params]
    .sort(([a, x], [b, y]) => (a === b ? (x < y ? -1 : x > y ? 1 : 0) : a < b ? -1 : 1))
    .reduce((acc, [name, value]) => acc + name + value, url);
  return createHmac("sha1", authToken).update(text).digest("base64");
}

/** Checks the signature of a request. The body must be a form. */
export function verifyTwilioRequest(
  authToken: string,
  url: string,
  request: { headers: Record<string, string>; rawBody?: string },
): boolean {
  // Twilio signs the address and the sorted form fields. Without a raw body, there is nothing to check.
  if (request.rawBody === undefined) return false;
  const given = Buffer.from(request.headers["x-twilio-signature"] ?? "");
  const wanted = Buffer.from(twilioSignature(authToken, url, new URLSearchParams(request.rawBody)));
  return given.byteLength === wanted.byteLength && timingSafeEqual(given, wanted);
}

/**
 * What the request is. A message status request has no `Body`. A call status request has
 * `CallbackSource`. Other requests with a `MessageSid` are incoming messages.
 */
export function eventOf(params: Record<string, string>): EventType | undefined {
  if (params.MessageSid)
    return "Body" in params || "NumMedia" in params ? "message" : "messageStatus";
  if (params.CallSid) return "callStatus";
  return undefined;
}

const numbersOf = (text: string | undefined): string[] =>
  (text ?? "")
    .split(",")
    .map((item) => item.trim().replace(/^whatsapp:/, ""))
    .filter(Boolean);

/** Decides about a request that has a valid signature. */
export function checkTwilioEvent(config: TwilioTriggerConfig, rawBody: string): WebhookVerdict {
  const params = Object.fromEntries(new URLSearchParams(rawBody));
  const type = eventOf(params);
  if (!type) return { verdict: "ignore" };
  if (!config.events.includes("*") && !(config.events as readonly string[]).includes(type)) {
    return { verdict: "ignore" };
  }
  const numbers = numbersOf(config.additionalFields.numbers);
  if (numbers.length > 0) {
    const seen = [params.From, params.To].map((value) => value?.replace(/^whatsapp:/, ""));
    if (!seen.some((value) => value && numbers.includes(value))) return { verdict: "ignore" };
  }
  return {
    verdict: "accept",
    input: {
      type,
      sid: params.MessageSid ?? params.CallSid ?? null,
      from: params.From ?? null,
      to: params.To ?? null,
      body: params.Body ?? null,
      status: params.MessageStatus ?? params.CallStatus ?? null,
      numMedia: Number(params.NumMedia ?? 0),
      // The fields as Twilio sent them, such as MediaUrl0, ErrorCode, or ProfileName.
      params,
    },
  };
}

const authTokenOf = (credential: Pick<ResolvedCredential, "type" | "data"> | null) =>
  twilioAccess(credential).authToken;

export default defineNode({
  type: "trigger.twilio",
  label: "Twilio Trigger",
  description: "Start the workflow on an incoming message or a status update from Twilio",
  category: "trigger",
  app: "Twilio",
  icon: "MessageSquare",
  iconUrl: TWILIO_ICON,
  config: triggerConfig,
  defaultConfig: { events: ["message"], additionalFields: {} },
  credentialTypes: [TWILIO_CREDENTIAL],
  ports: { in: [], out: ["out"] },
  subtitle: (config) =>
    Array.isArray(config.events) ? `Events: ${config.events.join(", ")}` : undefined,
  // The input is { type, sid, from, to, body, status, numMedia, params }.
  run: ({ input }) => ({ port: "out", data: input }),
  // Twilio sends the events to a address that you set at a phone number, a Messaging Service, or
  // a Status Callback URL. The console holds that address, so the trigger cannot set it.
  // Each request has a signature.
  webhook: {
    async receive({ config: raw, credential, request, url }) {
      let token: string;
      try {
        token = authTokenOf(credential);
      } catch {
        return { verdict: "forbidden", status: 401 };
      }
      if (!verifyTwilioRequest(token, url, request)) return { verdict: "forbidden", status: 401 };
      return checkTwilioEvent(triggerConfig.parse(raw), request.rawBody ?? "");
    },
    /** Checks that the credential works. The trigger needs the Auth Token for the signature. */
    async activate({ credential, signal }) {
      const access = twilioAccess(credential);
      const answer = await callTwilio(
        access,
        {
          method: "GET",
          url: `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(access.accountSid)}.json`,
        },
        { signal, timeoutMs: 15_000 },
      );
      return { accountSid: answer.sid ?? null };
    },
  },
  // No `webhookTest`: Twilio sends events only to the address in the console.
});
