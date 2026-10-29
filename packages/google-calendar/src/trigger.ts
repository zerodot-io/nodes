// SPDX-License-Identifier: AGPL-3.0-only
import { defineNode, isRecord, POLL_MAX_ITEMS } from "@zerodot/node-sdk";
import { z } from "zod";
import {
  CALENDAR_OAUTH2_CREDENTIAL,
  CALENDAR_SERVICE_ACCOUNT_CREDENTIAL,
  type CallOptions,
  calendarToken,
  callCalendar,
} from "./api";
import { authenticationField, calendarField } from "./config";
import { CALENDAR_ICON } from "./icon";
import { calendarIdOf, listEventsRequest, pageOf } from "./request";

const TIMEOUT_MS = 30_000;
/** The most events in one page of Google. */
const PAGE_SIZE = 250;

export const CHANGES = ["created", "updated", "cancelled", "any"] as const;
export type Change = "created" | "updated" | "cancelled";

export const triggerConfig = z.object({
  authentication: authenticationField,
  calendarId: calendarField,
  trigger: z
    .enum(CHANGES)
    .default("any")
    .meta({
      title: "Trigger On",
      labels: {
        created: "Event Created",
        updated: "Event Updated",
        cancelled: "Event Cancelled",
        any: "Any Change",
      },
      hints: {
        created: "A new event",
        updated: "An event that was changed",
        cancelled: "An event that was deleted or cancelled",
        any: "A new, changed, or cancelled event",
      },
    }),
  query: z.string().optional().meta({
    title: "Search",
    description: "Give only events with this text in the title, description, place, or guests",
  }),
  intervalSeconds: z.number().int().min(15).max(86_400).default(60).meta({
    title: "Check every (seconds)",
  }),
});

export type TriggerConfig = z.output<typeof triggerConfig>;

const time = (value: unknown): number | undefined => {
  const parsed = typeof value === "string" ? Date.parse(value) : Number.NaN;
  return Number.isNaN(parsed) ? undefined : parsed;
};

/**
 * What happened to an event, from its fields and the time of the last poll. An event that
 * was made after that time is new. Else it was changed.
 */
export function changeOf(event: Record<string, unknown>, since: number): Change {
  if (event.status === "cancelled") return "cancelled";
  const created = time(event.created);
  return created !== undefined && created > since ? "created" : "updated";
}

export type Polled = {
  items: { key: string; data: Record<string, unknown> }[];
  /** The `updated` time of the last event that was read. */
  cursor: string | null;
};

/** Picks the events after the cursor that the user wants, oldest first. */
export function pickChanges(
  events: unknown[],
  cursor: string | null,
  wanted: TriggerConfig["trigger"],
): Polled {
  const since = time(cursor) ?? 0;
  const items: Polled["items"] = [];
  let last = cursor;
  const sorted = events
    .filter(isRecord)
    .filter((event) => (time(event.updated) ?? 0) > since)
    .sort((a, b) => (time(a.updated) ?? 0) - (time(b.updated) ?? 0));
  for (const event of sorted) {
    const updated = String(event.updated);
    const change = changeOf(event, since);
    last = updated;
    if (wanted !== "any" && wanted !== change) continue;
    items.push({ key: `${String(event.id)}:${updated}`, data: { ...event, changeType: change } });
  }
  return { items, cursor: last };
}

export default defineNode({
  type: "trigger.google_calendar",
  label: "On Google Calendar event",
  description: "Check a calendar on a timer and start a run for each new or changed event",
  category: "trigger",
  app: "Google Calendar",
  icon: "Calendar",
  iconUrl: CALENDAR_ICON,
  config: triggerConfig,
  defaultConfig: {
    authentication: "oAuth2",
    calendarId: "primary",
    trigger: "any",
    intervalSeconds: 60,
  },
  credentialTypes: [CALENDAR_OAUTH2_CREDENTIAL, CALENDAR_SERVICE_ACCOUNT_CREDENTIAL],
  credentialRules: {
    [CALENDAR_OAUTH2_CREDENTIAL]: { showWhen: { authentication: ["oAuth2"] } },
    [CALENDAR_SERVICE_ACCOUNT_CREDENTIAL]: { showWhen: { authentication: ["serviceAccount"] } },
  },
  ports: { in: [], out: ["out"] },
  subtitle: (config) =>
    typeof config.calendarId === "string" && config.calendarId !== ""
      ? config.calendarId
      : undefined,
  // The input is the event, with `changeType`: created, updated, or cancelled.
  run: ({ input }) => ({ port: "out", data: input }),
  async poll({ config: raw, credential, cursor, firstPoll, signal }) {
    const config = triggerConfig.parse(raw);
    // The first poll only marks the time. Events from before it start no runs.
    if (firstPoll) return { items: [], cursor: new Date().toISOString() };
    const last = typeof cursor === "string" ? cursor : new Date().toISOString();

    const options: CallOptions = { signal, timeoutMs: TIMEOUT_MS };
    const token = await calendarToken(credential, options);
    const calendarId = calendarIdOf(config.calendarId);
    const events: unknown[] = [];
    let pageToken: string | undefined;
    do {
      const page = pageOf(
        await callCalendar(
          token,
          listEventsRequest(
            calendarId,
            {
              query: config.query,
              // Repeats of a recurring event are not separate events here.
              singleEvents: false,
              orderBy: "updated",
              showDeleted: true,
              updatedMin: last,
            },
            PAGE_SIZE,
            pageToken,
          ),
          options,
        ),
      );
      events.push(...page.items);
      pageToken = page.next;
    } while (pageToken && events.length < POLL_MAX_ITEMS);

    // Oldest first. More than the limit waits for the next poll.
    return pickChanges(events.slice(0, POLL_MAX_ITEMS), last, config.trigger);
  },
});
