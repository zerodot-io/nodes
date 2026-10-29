// SPDX-License-Identifier: AGPL-3.0-only
import { defineNode } from "@zerodot/node-sdk";
import { callTwilio, callTwilioList, TWILIO_CREDENTIAL, twilioAccess } from "./api";
import { twilioConfig } from "./config";
import { TWILIO_ICON } from "./icon";
import { buildRequest } from "./request";

export default defineNode({
  type: "twilio.api",
  label: "Twilio",
  description: "Send SMS and WhatsApp messages, make calls, and look up phone numbers with Twilio",
  category: "integration",
  app: "Twilio",
  // The names of the actions of the Twilio node.
  actions: [
    { label: "Send a message", config: { resource: "message", operation: "send" } },
    {
      label: "Send a WhatsApp message",
      config: { resource: "message", operation: "send", channel: "whatsapp" },
    },
    { label: "Get a message", config: { resource: "message", operation: "get" } },
    { label: "List messages", config: { resource: "message", operation: "list" } },
    { label: "Delete a message", config: { resource: "message", operation: "delete" } },
    { label: "Make a call", config: { resource: "call", operation: "make" } },
    { label: "Get a call", config: { resource: "call", operation: "get" } },
    { label: "List calls", config: { resource: "call", operation: "list" } },
    { label: "Look up a phone number", config: { resource: "phoneNumber", operation: "lookup" } },
  ],
  icon: "MessageSquare",
  iconUrl: TWILIO_ICON,
  config: twilioConfig,
  defaultConfig: {
    resource: "message",
    operation: "send",
    channel: "sms",
    from: "",
    to: "",
    body: "",
    filters: {},
    returnAll: false,
    limit: 50,
    lookupFields: [],
    timeoutMs: 30_000,
  },
  credentialTypes: [TWILIO_CREDENTIAL],
  ports: { in: ["in"], out: ["out"] },
  subtitle: (config) =>
    typeof config.operation === "string"
      ? `${String(config.resource ?? "message")}: ${config.operation}`
      : undefined,
  async run({ config, credential, signal }) {
    const access = twilioAccess(credential);
    const options = { signal, timeoutMs: config.timeoutMs };
    const request = buildRequest(config, access.accountSid);

    if (request.itemsKey) {
      const items = await callTwilioList(
        access,
        request.call.url,
        request.call.args ?? {},
        request.itemsKey,
        config.returnAll ? null : config.limit,
        options,
      );
      return { port: "out", data: items };
    }

    const data = await callTwilio(access, request.call, options);
    // A delete has no answer body. An empty answer says that the call worked.
    return { port: "out", data: Object.keys(data).length > 0 ? data : { success: true } };
  },
});
