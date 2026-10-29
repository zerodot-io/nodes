// SPDX-License-Identifier: AGPL-3.0-only
import { accountUrl, type Call, TWILIO_LOOKUP_API } from "./api";
import type { TwilioConfig } from "./config";

export type TwilioRequest = {
  call: Call;
  /** A list: the items are in this key of each page. */
  itemsKey?: string;
};

const list = (text: string | undefined): string[] =>
  (text ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

const need = <T>(value: T | undefined, name: string, operation: string): T => {
  if (value === undefined || (typeof value === "string" && value.trim() === "")) {
    throw new Error(`Twilio ${operation} needs "${name}"`);
  }
  return value;
};

/** A SID goes in a path, so it must be a SID: letters and digits only. */
const sid = (value: string | undefined, name: string, operation: string): string => {
  const text = need(value, name, operation).trim();
  if (!/^[A-Za-z0-9]{10,64}$/.test(text)) {
    throw new Error(`Twilio ${operation}: "${name}" is not a SID`);
  }
  return text;
};

const WHATSAPP = "whatsapp:";

/** The number for a channel. WhatsApp numbers have the `whatsapp:` prefix. */
export const addressOf = (channel: TwilioConfig["channel"], number: string): string => {
  const text = number.trim();
  if (channel !== "whatsapp" || text.startsWith(WHATSAPP)) return text;
  return `${WHATSAPP}${text}`;
};

/** A JSON object as text. Twilio wants the text. */
function contentVariables(text: string | undefined): string | undefined {
  if (!text?.trim()) return undefined;
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error('"contentVariables" must be JSON');
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error('"contentVariables" must be a JSON object');
  }
  return JSON.stringify(value);
}

/** The Twilio call for one operation, without the network. */
export function buildRequest(c: TwilioConfig, accountSid: string): TwilioRequest {
  const op = `${c.resource}.${c.operation}`;

  switch (op) {
    case "message.send": {
      const media = list(c.mediaUrls);
      if (media.length > 10) throw new Error("Twilio message.send accepts at most 10 media URLs");
      const body = c.body?.trim() ? c.body : undefined;
      const template = c.channel === "whatsapp" ? c.contentSid?.trim() : undefined;
      if (!body && media.length === 0 && !template) {
        throw new Error(`Twilio ${op} needs "body", "mediaUrls", or "contentSid"`);
      }
      const service = c.messagingServiceSid?.trim();
      const from = c.from?.trim();
      if (!from && !service) throw new Error(`Twilio ${op} needs "from" or "messagingServiceSid"`);
      return {
        call: {
          method: "POST",
          url: accountUrl(accountSid, "Messages.json"),
          args: {
            To: addressOf(c.channel, need(c.to, "to", op)),
            // The Messaging Service picks the sender, so From is left out.
            From: service ? undefined : addressOf(c.channel, from ?? ""),
            MessagingServiceSid: service,
            Body: body,
            MediaUrl: media,
            ContentSid: template,
            ContentVariables: template ? contentVariables(c.contentVariables) : undefined,
            StatusCallback: c.statusCallback,
          },
        },
      };
    }
    case "message.get":
      return {
        call: {
          method: "GET",
          url: accountUrl(accountSid, `Messages/${sid(c.messageSid, "messageSid", op)}.json`),
        },
      };
    case "message.delete":
      return {
        call: {
          method: "DELETE",
          url: accountUrl(accountSid, `Messages/${sid(c.messageSid, "messageSid", op)}.json`),
        },
      };
    case "message.list":
      return {
        call: {
          method: "GET",
          url: accountUrl(accountSid, "Messages.json"),
          args: {
            To: c.filters.to?.trim(),
            From: c.filters.from?.trim(),
            "DateSent>": c.filters.dateSentAfter?.trim(),
            "DateSent<": c.filters.dateSentBefore?.trim(),
          },
        },
        itemsKey: "messages",
      };

    case "call.make": {
      const url = c.callMode === "url" ? need(c.twimlUrl, "twimlUrl", op) : undefined;
      const twiml = c.callMode === "twiml" ? need(c.twiml, "twiml", op) : undefined;
      return {
        call: {
          method: "POST",
          url: accountUrl(accountSid, "Calls.json"),
          args: {
            To: need(c.to, "to", op).trim(),
            From: need(c.from, "from", op).trim(),
            Url: url,
            Twiml: twiml,
            StatusCallback: c.statusCallback,
          },
        },
      };
    }
    case "call.get":
      return {
        call: {
          method: "GET",
          url: accountUrl(accountSid, `Calls/${sid(c.callSid, "callSid", op)}.json`),
        },
      };
    case "call.list":
      return {
        call: {
          method: "GET",
          url: accountUrl(accountSid, "Calls.json"),
          args: {
            To: c.filters.to?.trim(),
            From: c.filters.from?.trim(),
            Status: c.filters.status?.trim(),
            "StartTime>": c.filters.dateSentAfter?.trim(),
            "StartTime<": c.filters.dateSentBefore?.trim(),
          },
        },
        itemsKey: "calls",
      };

    case "phoneNumber.lookup": {
      const number = need(c.phoneNumber, "phoneNumber", op).trim();
      return {
        call: {
          method: "GET",
          url: `${TWILIO_LOOKUP_API}/v2/PhoneNumbers/${encodeURIComponent(number)}`,
          args: {
            Fields: c.lookupFields.length > 0 ? c.lookupFields.join(",") : undefined,
            CountryCode: c.countryCode?.trim(),
          },
        },
      };
    }
  }
  throw new Error(`Unknown Twilio operation "${op}"`);
}
