// SPDX-License-Identifier: AGPL-3.0-only
import { createHmac, timingSafeEqual } from "node:crypto";
import { defineNode, type ResolvedCredential, type WebhookVerdict } from "@zerodot/node-sdk";
import { z } from "zod";
import { callSlack, SLACK_CREDENTIAL, slackAccess } from "./api";
import { SLACK_ICON } from "./icon";

export const EVENT_TYPES = [
  "*",
  "message",
  "app_mention",
  "reaction_added",
  "reaction_removed",
  "member_joined_channel",
  "member_left_channel",
  "channel_created",
  "channel_archive",
  "channel_rename",
  "file_shared",
  "team_join",
] as const;

export const triggerConfig = z.object({
  events: z
    .array(z.enum(EVENT_TYPES))
    .min(1)
    .default(["message"])
    .meta({
      title: "Trigger On",
      labels: {
        "*": "All Events",
        message: "Message",
        app_mention: "App Mention",
        reaction_added: "Reaction Added",
        reaction_removed: "Reaction Removed",
        member_joined_channel: "Member Joined Channel",
        member_left_channel: "Member Left Channel",
        channel_created: "Channel Created",
        channel_archive: "Channel Archived",
        channel_rename: "Channel Renamed",
        file_shared: "File Shared",
        team_join: "User Joined Workspace",
      },
      hints: {
        "*": "All events that the app subscribes to",
        message: "A message was sent in a channel that the app is in",
        app_mention: "Someone mentioned the app in a message",
        reaction_added: "Someone added an emoji reaction",
        reaction_removed: "Someone removed an emoji reaction",
        member_joined_channel: "A user joined a channel",
        member_left_channel: "A user left a channel",
        channel_created: "A public channel was created",
        channel_archive: "A channel was archived",
        channel_rename: "A channel was renamed",
        file_shared: "A file was shared",
        team_join: "A new member joined the workspace",
      },
    }),
  additionalFields: z
    .object({
      channelIds: z
        .string()
        .meta({ description: "Only these channels, as IDs with commas between" }),
      includeBotMessages: z
        .boolean()
        .meta({ description: "Also start on messages from bots, and from this app" }),
    })
    .partial()
    .default({}),
});

export type SlackTriggerConfig = z.output<typeof triggerConfig>;

/** Slack signs each request. A request older than this is a replay. */
export const MAX_AGE_SECONDS = 5 * 60;

/** The `x-slack-signature` value of a request. */
export function slackSignature(secret: string, timestamp: string, rawBody: string): string {
  return `v0=${createHmac("sha256", secret).update(`v0:${timestamp}:${rawBody}`).digest("hex")}`;
}

/** Checks the signature and the age of a request. `now` is in seconds. */
export function verifySlackRequest(
  secret: string,
  request: { headers: Record<string, string>; rawBody?: string },
  now: number = Math.floor(Date.now() / 1000),
): boolean {
  const timestamp = request.headers["x-slack-request-timestamp"] ?? "";
  const seconds = Number(timestamp);
  if (!/^\d+$/.test(timestamp) || Math.abs(now - seconds) > MAX_AGE_SECONDS) return false;
  const wanted = Buffer.from(slackSignature(secret, timestamp, request.rawBody ?? ""));
  const given = Buffer.from(request.headers["x-slack-signature"] ?? "");
  return given.byteLength === wanted.byteLength && timingSafeEqual(given, wanted);
}

function signingSecretOf(credential: Pick<ResolvedCredential, "type" | "data"> | null) {
  if (!credential || credential.type !== SLACK_CREDENTIAL) return undefined;
  const secret = credential.data.signingSecret;
  return typeof secret === "string" && secret !== "" ? secret : undefined;
}

type SlackEvent = {
  type?: string;
  subtype?: string;
  bot_id?: string;
  channel?: string | { id?: string };
  channel_id?: string;
  item?: { channel?: string };
};

type EventBody = {
  type?: string;
  challenge?: string;
  team_id?: string;
  api_app_id?: string;
  event_id?: string;
  event_time?: number;
  event?: SlackEvent;
};

const channelOf = (event: SlackEvent): string | undefined => {
  if (typeof event.channel === "string") return event.channel;
  return event.channel?.id ?? event.channel_id ?? event.item?.channel;
};

/** Decides about a request that has a valid signature. */
export function checkSlackEvent(
  config: SlackTriggerConfig,
  body: unknown,
  retryNum: string | undefined,
): WebhookVerdict {
  const payload = (body ?? {}) as EventBody;
  // Slack sends a challenge when you set the Request URL. The answer must echo it.
  if (payload.type === "url_verification") {
    return {
      verdict: "ignore",
      response: { status: 200, body: { challenge: String(payload.challenge ?? "") } },
    };
  }
  if (payload.type !== "event_callback" || !payload.event) return { verdict: "ignore" };
  const { event } = payload;
  const type = event.type ?? "";
  if (!config.events.includes("*") && !(config.events as readonly string[]).includes(type)) {
    return { verdict: "ignore" };
  }
  const { channelIds, includeBotMessages } = config.additionalFields;
  if (!includeBotMessages && (event.bot_id || event.subtype === "bot_message")) {
    return { verdict: "ignore" };
  }
  const channels = channelIds
    ?.split(",")
    .map((id) => id.trim())
    .filter(Boolean);
  if (channels?.length) {
    const channel = channelOf(event);
    if (!channel || !channels.includes(channel)) return { verdict: "ignore" };
  }
  return {
    verdict: "accept",
    input: {
      type,
      event,
      teamId: payload.team_id ?? null,
      appId: payload.api_app_id ?? null,
      eventId: payload.event_id ?? null,
      eventTime: payload.event_time ?? null,
      retry: retryNum === undefined ? 0 : Number(retryNum),
    },
  };
}

export default defineNode({
  type: "trigger.slack",
  label: "Slack Trigger",
  description: "Start the workflow on a Slack event, such as a message or a mention",
  category: "trigger",
  app: "Slack",
  icon: "MessageSquare",
  iconUrl: SLACK_ICON,
  config: triggerConfig,
  defaultConfig: { events: ["message"], additionalFields: {} },
  credentialTypes: [SLACK_CREDENTIAL],
  ports: { in: [], out: ["out"] },
  subtitle: (config) =>
    Array.isArray(config.events) ? `Events: ${config.events.join(", ")}` : undefined,
  // The input is { type, event, teamId, appId, eventId, eventTime, retry }.
  run: ({ input }) => ({ port: "out", data: input }),
  // Slack sends the events to the Request URL in the Event Subscriptions of the app. The app
  // settings hold that address, so the trigger cannot set it. Each request has a signature.
  webhook: {
    async receive({ config: raw, credential, request }) {
      const secret = signingSecretOf(credential);
      if (!secret || !verifySlackRequest(secret, request)) {
        return { verdict: "forbidden", status: 401 };
      }
      return checkSlackEvent(
        triggerConfig.parse(raw),
        request.body,
        request.headers["x-slack-retry-num"],
      );
    },
    /** Checks the credential: the trigger needs the signing secret, and a token that works. */
    async activate({ credential, signal }) {
      if (!signingSecretOf(credential)) {
        throw new Error('The Slack credential needs the "signingSecret" for the trigger');
      }
      const answer = await callSlack(
        slackAccess(credential),
        "auth.test",
        {},
        {
          signal,
          timeoutMs: 15_000,
        },
      );
      return { teamId: answer.team_id ?? null };
    },
  },
  // No `webhookTest`: Slack sends events only to the saved Request URL, so a test address gets none.
});
