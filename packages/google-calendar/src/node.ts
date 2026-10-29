// SPDX-License-Identifier: AGPL-3.0-only
import { defineNode } from "@zerodot/node-sdk";
import {
  CALENDAR_OAUTH2_CREDENTIAL,
  CALENDAR_SERVICE_ACCOUNT_CREDENTIAL,
  type CalendarRequest,
  type CallOptions,
  calendarToken,
  callCalendar,
} from "./api";
import { type CalendarConfig, calendarConfig } from "./config";
import { CALENDAR_ICON } from "./icon";
import {
  calendarIdOf,
  createEventRequest,
  deleteEventRequest,
  eventBody,
  freeBusyRequest,
  getEventRequest,
  listCalendarsRequest,
  listEventsRequest,
  pageOf,
  queryTime,
  quickAddRequest,
  splitList,
  toAvailability,
  updateEventRequest,
} from "./request";

type Call = (request: CalendarRequest) => Promise<unknown>;

const need = <T>(value: T | undefined, name: string, operation: string): T => {
  if (value === undefined || value === "" || (typeof value === "string" && !value.trim())) {
    throw new Error(`"${name}" is needed to ${operation}`);
  }
  return value;
};

/** The pages of a list call, until there are enough items or no more pages. */
async function collect(
  call: Call,
  maxPage: number,
  limit: number | undefined,
  request: (pageSize: number, pageToken?: string) => CalendarRequest,
): Promise<unknown[]> {
  const items: unknown[] = [];
  let token: string | undefined;
  do {
    const size = limit === undefined ? maxPage : Math.min(maxPage, limit - items.length);
    const page = pageOf(await call(request(size, token)));
    items.push(...page.items);
    token = page.next;
  } while (token && (limit === undefined || items.length < limit));
  return limit === undefined ? items : items.slice(0, limit);
}

async function runEvent(call: Call, config: CalendarConfig): Promise<unknown> {
  const { operation } = config;
  const calendarId = calendarIdOf(config.calendarId);
  const limit = config.returnAll ? undefined : config.limit;

  switch (operation) {
    case "getMany": {
      const timeMin = queryTime(config.timeMin, "timeMin", config.timeZone);
      const timeMax = queryTime(config.timeMax, "timeMax", config.timeZone);
      return await collect(call, 2500, limit, (size, token) =>
        listEventsRequest(
          calendarId,
          {
            timeMin,
            timeMax,
            query: config.query,
            singleEvents: config.singleEvents,
            // Google allows `startTime` order only with expanded recurring events.
            orderBy: config.singleEvents ? config.orderBy : undefined,
            timeZone: config.timeZone,
          },
          size,
          token,
        ),
      );
    }
    case "get":
      return await call(getEventRequest(calendarId, need(config.eventId, "eventId", operation)));
    case "create":
      return await call(
        createEventRequest(calendarId, eventBody(config, "create"), config.sendUpdates),
      );
    case "update":
      return await call(
        updateEventRequest(
          calendarId,
          need(config.eventId, "eventId", operation),
          eventBody(config, "update"),
          config.sendUpdates,
        ),
      );
    case "delete": {
      const eventId = need(config.eventId, "eventId", operation);
      await call(deleteEventRequest(calendarId, eventId, config.sendUpdates));
      return { success: true, calendarId, eventId };
    }
    case "quickAdd":
      return await call(
        quickAddRequest(calendarId, need(config.text, "text", operation), config.sendUpdates),
      );
  }
  throw new Error(`"${operation}" is not an operation of "event"`);
}

async function runAvailability(call: Call, config: CalendarConfig): Promise<unknown> {
  const from = queryTime(config.timeMin, "timeMin", config.timeZone) ?? new Date().toISOString();
  const to =
    queryTime(config.timeMax, "timeMax", config.timeZone) ??
    new Date(Date.parse(from) + 24 * 3_600_000).toISOString();
  if (Date.parse(to) <= Date.parse(from)) throw new Error('"timeMax" must be after "timeMin"');
  const ids = splitList(config.calendarIds);
  const answer = await call(
    freeBusyRequest(ids.length > 0 ? ids : ["primary"], from, to, config.timeZone),
  );
  return toAvailability(answer, from, to);
}

export default defineNode({
  type: "google_calendar.api",
  label: "Google Calendar",
  description: "Create, read, and change events in Google Calendar, and check availability",
  category: "integration",
  app: "Google Calendar",
  // The names of the actions of the Google Calendar node.
  actions: [
    { label: "Get many calendars", config: { resource: "calendar", operation: "getMany" } },
    { label: "Get many events", config: { resource: "event", operation: "getMany" } },
    { label: "Get an event", config: { resource: "event", operation: "get" } },
    { label: "Create an event", config: { resource: "event", operation: "create" } },
    { label: "Update an event", config: { resource: "event", operation: "update" } },
    { label: "Delete an event", config: { resource: "event", operation: "delete" } },
    { label: "Quick add an event", config: { resource: "event", operation: "quickAdd" } },
    { label: "Check availability", config: { resource: "availability", operation: "check" } },
  ],
  icon: "Calendar",
  iconUrl: CALENDAR_ICON,
  config: calendarConfig,
  defaultConfig: {
    authentication: "oAuth2",
    resource: "event",
    operation: "getMany",
    calendarId: "primary",
    returnAll: false,
    limit: 50,
    singleEvents: true,
    orderBy: "startTime",
    allDay: false,
    remindersMode: "unchanged",
    addMeet: false,
    visibility: "",
    sendUpdates: "none",
    minAccessRole: "",
    timeoutMs: 30_000,
  },
  credentialTypes: [CALENDAR_OAUTH2_CREDENTIAL, CALENDAR_SERVICE_ACCOUNT_CREDENTIAL],
  // The Authentication field says which credential type the user picks.
  credentialRules: {
    [CALENDAR_OAUTH2_CREDENTIAL]: { showWhen: { authentication: ["oAuth2"] } },
    [CALENDAR_SERVICE_ACCOUNT_CREDENTIAL]: { showWhen: { authentication: ["serviceAccount"] } },
  },
  ports: { in: ["in"], out: ["out"] },
  subtitle: (config) =>
    typeof config.operation === "string"
      ? `${String(config.resource ?? "event")}: ${config.operation}`
      : undefined,
  async run({ config, credential, signal }) {
    const options: CallOptions = { signal, timeoutMs: config.timeoutMs };
    const token = await calendarToken(credential, options);
    const call: Call = (request) => callCalendar(token, request, options);

    switch (config.resource) {
      case "calendar":
        return {
          port: "out",
          data: await collect(call, 250, config.returnAll ? undefined : config.limit, (size, t) =>
            listCalendarsRequest(size, t, config.minAccessRole || undefined),
          ),
        };
      case "availability":
        return { port: "out", data: await runAvailability(call, config) };
      case "event":
        return { port: "out", data: await runEvent(call, config) };
    }
  },
});
