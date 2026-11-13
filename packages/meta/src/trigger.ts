// SPDX-License-Identifier: AGPL-3.0-only
import { createHmac, timingSafeEqual } from "node:crypto";
import { defineNode, type ResolvedCredential, type WebhookVerdict } from "@zerodot/node-sdk";
import { z } from "zod";
import { callGraph, GRAPH_HOST, META_CREDENTIAL, metaAccess } from "./api";
import { META_ICON } from "./icon";

export const WEBHOOK_OBJECTS = ["page", "instagram", "threads"] as const;

export const EVENT_FIELDS = [
  "*",
  "comments",
  "mentions",
  "messages",
  "message_reactions",
  "story_insights",
  "feed",
  "live_comments",
] as const;

export const triggerConfig = z.object({
  object: z
    .enum(WEBHOOK_OBJECTS)
    .default("instagram")
    .meta({
      title: "Object",
      labels: { page: "Facebook Page", instagram: "Instagram", threads: "Threads" },
      hints: {
        page: "Events of a Facebook Page, such as feed posts",
        instagram: "Events of an Instagram account, such as comments and mentions",
        threads: "Events of a Threads profile",
      },
    }),
  fields: z
    .array(z.enum(EVENT_FIELDS))
    .min(1)
    .default(["comments"])
    .meta({
      title: "Trigger On",
      labels: {
        "*": "All Events",
        comments: "Comments",
        mentions: "Mentions",
        messages: "Messages",
        message_reactions: "Message Reactions",
        story_insights: "Story Insights",
        feed: "Feed",
        live_comments: "Live Comments",
      },
      hints: {
        "*": "All events that the app subscribes to",
        comments: "Someone commented on a post or a media of the account",
        mentions: "Someone @mentioned the account in a comment or a caption",
        messages: "Someone messaged the account",
        message_reactions: "Someone reacted to a message",
        story_insights: "Metrics of an expired story",
        feed: "The Page feed changed, for example on a new post",
        live_comments: "Someone commented on a live video",
      },
    }),
});

export type MetaTriggerConfig = z.output<typeof triggerConfig>;

/** The `X-Hub-Signature-256` value of a webhook request from Meta. */
export function metaSignature(secret: string, rawBody: string): string {
  return `sha256=${createHmac("sha256", secret).update(rawBody, "utf8").digest("hex")}`;
}

/** Checks the signature of a request. The body must be the raw text that Meta sent. */
export function verifyMetaRequest(
  secret: string,
  request: { headers: Record<string, string>; rawBody?: string },
): boolean {
  const given = Buffer.from(request.headers["x-hub-signature-256"] ?? "");
  const wanted = Buffer.from(metaSignature(secret, request.rawBody ?? ""));
  return given.byteLength === wanted.byteLength && timingSafeEqual(given, wanted);
}

type WebhookChange = { field?: string; value?: unknown };

type WebhookEntry = {
  id?: string;
  time?: number;
  changes?: WebhookChange[];
  /** Events of messaging and standby come as this field, not as changes. */
  messaging?: unknown;
  standby?: unknown;
};

export type WebhookBody = {
  object?: string;
  entry?: WebhookEntry[];
};

/** The event fields of one entry: the `field` of each change, plus `messaging` and `standby`. */
export function fieldsOf(entry: WebhookEntry): string[] {
  const fields = (entry.changes ?? [])
    .map((change) => (typeof change?.field === "string" ? change.field : ""))
    .filter(Boolean);
  if (entry.messaging !== undefined) fields.push("messages");
  if (entry.standby !== undefined) fields.push("standby");
  return fields;
}

/** Decides about a request that has a valid signature. */
export function checkMetaWebhook(config: MetaTriggerConfig, body: unknown): WebhookVerdict {
  const payload = (body ?? {}) as WebhookBody;
  if (payload.object !== config.object) return { verdict: "ignore" };
  const wanted = config.fields;
  const wantedAll = wanted.includes("*");
  const entries = Array.isArray(payload.entry) ? payload.entry : [];
  const accepted = entries.filter((entry) => {
    if (wantedAll) return true;
    return fieldsOf(entry).some((field) => (wanted as readonly string[]).includes(field));
  });
  if (accepted.length === 0) return { verdict: "ignore" };
  return {
    verdict: "accept",
    input: { object: payload.object ?? null, entry: accepted },
  };
}

function appSecretOf(credential: Pick<ResolvedCredential, "type" | "data"> | null) {
  if (!credential || credential.type !== META_CREDENTIAL) return undefined;
  const secret = credential.data.appSecret;
  return typeof secret === "string" && secret !== "" ? secret : undefined;
}

export default defineNode({
  type: "trigger.meta",
  label: "Meta Trigger",
  description:
    "Start the workflow on a Meta webhook, such as a comment, a mention, or a message on Instagram, Facebook, or Threads",
  category: "trigger",
  app: "Meta",
  icon: "Share2Icon",
  iconUrl: META_ICON,
  config: triggerConfig,
  defaultConfig: { object: "instagram", fields: ["comments"] },
  credentialTypes: [META_CREDENTIAL],
  ports: { in: [], out: ["out"] },
  subtitle: (config) =>
    Array.isArray(config.fields)
      ? `${String(config.object ?? "instagram")}: ${config.fields.join(", ")}`
      : undefined,
  // Meta sends the events to the Callback URL in the Webhooks settings of the app. The app
  // settings hold that address, so the trigger cannot set it. Each event request has a
  // signature, and the registration sends a GET with a challenge to echo.
  webhook: {
    async receive({ config: raw, credential, request }) {
      if (request.method === "GET") {
        // Meta sends `hub.challenge` when you save the Callback URL. The answer must be that text.
        const challenge = request.query["hub.challenge"];
        if (
          request.query["hub.mode"] === "subscribe" &&
          typeof challenge === "string" &&
          challenge !== ""
        ) {
          const secret = appSecretOf(credential);
          const verifyToken = request.query["hub.verify_token"];
          if (!secret || verifyToken !== secret) {
            return { verdict: "forbidden", status: 403 };
          }
          return {
            verdict: "ignore",
            response: { status: 200, body: challenge },
          };
        }
        return { verdict: "ignore", response: { status: 400, body: "" } };
      }
      const secret = appSecretOf(credential);
      if (!secret || !verifyMetaRequest(secret, request)) {
        return { verdict: "forbidden", status: 401 };
      }
      return checkMetaWebhook(triggerConfig.parse(raw), request.body);
    },
    /** Checks the credential: the trigger needs the app secret, and a token that works. */
    async activate({ credential, signal }) {
      if (!appSecretOf(credential)) {
        throw new Error('The Meta credential needs the "appSecret" for the trigger');
      }
      await callGraph(
        metaAccess(credential),
        {
          host: GRAPH_HOST,
          version: "v23.0",
          path: "/me",
          method: "GET",
          params: { fields: "id" },
        },
        { signal, timeoutMs: 15_000 },
      );
      return null;
    },
  },
  webhookTest: {
    hint: "Subscribe the Callback URL in the Webhooks settings of your Meta app, then comment on a post",
  },
  // The input is { object, entry }, and each entry is the webhook payload from Meta.
  run: ({ input }) => ({ port: "out", data: input }),
});
