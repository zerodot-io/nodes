// SPDX-License-Identifier: AGPL-3.0-only
import { z } from "zod";

// Resource and operation names follow the Twilio REST API.

export const RESOURCES = ["message", "call", "phoneNumber"] as const;
export type Resource = (typeof RESOURCES)[number];

export const OPERATIONS_OF = {
  message: ["send", "get", "list", "delete"],
  call: ["make", "get", "list"],
  phoneNumber: ["lookup"],
} as const satisfies Record<Resource, readonly string[]>;

const ALL_OPERATIONS = [...new Set(Object.values(OPERATIONS_OF).flat())] as [string, ...string[]];

export const CHANNELS = ["sms", "whatsapp"] as const;
export const LOOKUP_FIELDS = ["line_type_intelligence", "caller_name", "sms_pumping_risk"] as const;

type Operations = { [R in Resource]?: readonly (typeof OPERATIONS_OF)[R][number][] };

/** Show a field for these operations of these resources. */
const on = (operations: Operations) => ({
  showWhen: Object.entries(operations).map(([resource, ops]) => ({
    resource: [resource],
    operation: [...(ops ?? [])],
  })),
});

const isList = on({ message: ["list"], call: ["list"] });

export const twilioConfig = z
  .object({
    resource: z
      .enum(RESOURCES)
      .default("message")
      .meta({
        labels: { message: "Message", call: "Call", phoneNumber: "Phone Number" },
        hints: {
          message: "Send, get, list, or delete an SMS, MMS, or WhatsApp message",
          call: "Make a call, or get one call or many calls",
          phoneNumber: "Check a phone number and get data about it",
        },
      }),
    operation: z
      .enum(ALL_OPERATIONS)
      .default("send")
      .meta({
        labels: {
          send: "Send",
          get: "Get",
          list: "List",
          delete: "Delete",
          make: "Make",
          lookup: "Lookup",
        },
        hints: {
          send: "Send an SMS, an MMS, or a WhatsApp message",
          get: "Get one message or call by its SID",
          list: "Get many messages or calls",
          delete: "Delete a message from the Twilio account",
          make: "Start an outbound call",
          lookup: "Check a number and get its line type or caller name",
        },
      }),
    channel: z
      .enum(CHANNELS)
      .default("sms")
      .meta({
        ...on({ message: ["send"] }),
        labels: { sms: "SMS / MMS", whatsapp: "WhatsApp" },
        hints: {
          sms: "A text message. With media, an MMS",
          whatsapp: "Adds the whatsapp: prefix to the numbers",
        },
      }),
    from: z
      .string()
      .optional()
      .meta({
        ...on({ message: ["send"], call: ["make"] }),
        description:
          "A number of your account in E.164 format, such as +14155550100. For a message, empty means that Messaging Service SID sends it",
      }),
    to: z
      .string()
      .optional()
      .meta({
        ...on({ message: ["send"], call: ["make"] }),
        description: "The number to send to, in E.164 format, such as +14155550123",
      }),
    body: z
      .string()
      .optional()
      .meta({
        ...on({ message: ["send"] }),
        ui: "textarea",
        description: "The text. At most 1600 characters. Needed when there is no media",
      }),
    mediaUrls: z
      .string()
      .optional()
      .meta({
        ...on({ message: ["send"] }),
        title: "Media URLs",
        description: "Public URLs of media with commas between, at most 10. Makes an MMS",
      }),
    messagingServiceSid: z
      .string()
      .optional()
      .meta({
        ...on({ message: ["send"] }),
        title: "Messaging Service SID",
        description: "A SID that starts with MG. Use it in place of From",
      }),
    contentSid: z
      .string()
      .optional()
      .meta({
        showWhen: { resource: ["message"], operation: ["send"], channel: ["whatsapp"] },
        title: "Content Template SID",
        description:
          "A SID that starts with HX. Needed for a WhatsApp message outside the 24 hour window",
      }),
    contentVariables: z
      .string()
      .optional()
      .meta({
        showWhen: { resource: ["message"], operation: ["send"], channel: ["whatsapp"] },
        ui: "code",
        description: 'The values of the template as a JSON object, such as {"1":"Ada"}',
      }),
    statusCallback: z
      .url()
      .optional()
      .meta({
        ...on({ message: ["send"], call: ["make"] }),
        title: "Status Callback URL",
        description: "Twilio sends status updates to this address. Use the Twilio Trigger address",
      }),
    // calls
    callMode: z
      .enum(["url", "twiml"])
      .default("twiml")
      .meta({
        ...on({ call: ["make"] }),
        title: "Instructions",
        labels: { url: "TwiML URL", twiml: "TwiML" },
        hints: {
          url: "Twilio gets the instructions from an address",
          twiml: "Write the instructions in the node",
        },
      }),
    twimlUrl: z
      .url()
      .optional()
      .meta({
        showWhen: { resource: ["call"], operation: ["make"], callMode: ["url"] },
        title: "TwiML URL",
      }),
    twiml: z
      .string()
      .optional()
      .meta({
        showWhen: { resource: ["call"], operation: ["make"], callMode: ["twiml"] },
        title: "TwiML",
        ui: "code",
        description: "For example <Response><Say>Hello</Say></Response>",
      }),
    // get, delete
    messageSid: z
      .string()
      .optional()
      .meta({
        ...on({ message: ["get", "delete"] }),
        title: "Message SID",
        description: "A SID that starts with SM or MM",
      }),
    callSid: z
      .string()
      .optional()
      .meta({
        ...on({ call: ["get"] }),
        title: "Call SID",
        description: "A SID that starts with CA",
      }),
    // lists
    filters: z
      .object({
        to: z.string().meta({ title: "To", description: "Only to this number" }),
        from: z.string().meta({ title: "From", description: "Only from this number" }),
        status: z.string().meta({
          description:
            "A call status, such as completed or busy. A message status, such as delivered or failed",
        }),
        dateSentAfter: z.string().meta({
          title: "Sent After",
          description: "Date as YYYY-MM-DD. For messages, and for calls the start date",
        }),
        dateSentBefore: z.string().meta({
          title: "Sent Before",
          description: "Date as YYYY-MM-DD. For messages, and for calls the start date",
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
        showWhen: [
          { resource: ["message"], operation: ["list"], returnAll: [false] },
          { resource: ["call"], operation: ["list"], returnAll: [false] },
        ],
      }),
    // lookup
    phoneNumber: z
      .string()
      .optional()
      .meta({
        ...on({ phoneNumber: ["lookup"] }),
        description: "A number in E.164 format, or a national number with a Country Code",
      }),
    countryCode: z
      .string()
      .optional()
      .meta({
        ...on({ phoneNumber: ["lookup"] }),
        description: "Two letters, such as US. Only for a number that is not in E.164 format",
      }),
    lookupFields: z
      .array(z.enum(LOOKUP_FIELDS))
      .default([])
      .meta({
        ...on({ phoneNumber: ["lookup"] }),
        title: "Data Packages",
        labels: {
          line_type_intelligence: "Line Type",
          caller_name: "Caller Name",
          sms_pumping_risk: "SMS Pumping Risk",
        },
        hints: {
          line_type_intelligence: "Mobile, landline, or VoIP, and the carrier. Costs extra",
          caller_name: "The name of the owner (US). Costs extra",
          sms_pumping_risk: "The risk of fake traffic for this number. Costs extra",
        },
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

export type TwilioConfig = z.output<typeof twilioConfig>;
