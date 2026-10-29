// SPDX-License-Identifier: AGPL-3.0-only
import { randomUUID } from "node:crypto";
import type { CalendarRequest } from "./api";

export type SendUpdates = "all" | "externalOnly" | "none";

/** The fields of an event that the user sets. A missing field stays as it is on update. */
export type EventFields = {
  summary?: string;
  description?: string;
  location?: string;
  start?: string;
  end?: string;
  allDay?: boolean;
  timeZone?: string;
  attendees?: string;
  recurrence?: string;
  remindersMode?: "unchanged" | "default" | "custom" | "none";
  reminderMinutes?: string;
  addMeet?: boolean;
  visibility?: string;
  colorId?: string;
};

const seg = encodeURIComponent;

/** The ID of a calendar. Empty means the main calendar of the account. */
export const calendarIdOf = (input: string | undefined): string => input?.trim() || "primary";

/** Items of a comma or line separated text. */
export const splitList = (text: string | undefined): string[] =>
  (text ?? "")
    .split(/[,\n]/)
    .map((part) => part.trim())
    .filter(Boolean);

function fail(message: string): never {
  throw new Error(message);
}

// ---------------------------------------------------------------------------------------------
// Times

const HAS_OFFSET = /(Z|[+-]\d{2}:?\d{2})$/i;
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

function validTime(text: string, name: string): string {
  if (Number.isNaN(Date.parse(text))) throw new Error(`"${name}" is not a valid date: "${text}"`);
  return text;
}

/** The offset (for example `+05:30`) of a zone at a local time. */
function offsetAt(local: string, timeZone: string): string {
  const asUtc = Date.parse(`${local}Z`);
  if (Number.isNaN(asUtc)) return "Z";
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    }).formatToParts(new Date(asUtc));
  } catch {
    throw new Error(`"${timeZone}" is not a time zone name. Use a name like Europe/Paris`);
  }
  const at = (type: string) => Number(parts.find((part) => part.type === type)?.value);
  const zoned = Date.UTC(
    at("year"),
    at("month") - 1,
    at("day"),
    at("hour"),
    at("minute"),
    at("second"),
  );
  const minutes = Math.round((zoned - asUtc) / 60_000);
  const abs = Math.abs(minutes);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${minutes < 0 ? "-" : "+"}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
}

/**
 * A time for a query (`timeMin`, `timeMax`). Google needs an offset. A date gets the start of
 * the day. A time without an offset uses `timeZone`, else UTC.
 */
export function queryTime(
  value: string | undefined,
  name: string,
  timeZone?: string,
): string | undefined {
  const text = value?.trim();
  if (!text) return undefined;
  const full = DATE_ONLY.test(text) ? `${text}T00:00:00` : text;
  if (HAS_OFFSET.test(full)) return validTime(full, name);
  const zone = timeZone?.trim();
  return validTime(`${full}${zone ? offsetAt(full, zone) : "Z"}`, name);
}

/** The start or the end of an event: a date for an all-day event, else a date and time. */
export function eventTime(
  value: string,
  name: string,
  allDay: boolean,
  timeZone?: string,
): Record<string, string> {
  const text = value.trim();
  if (allDay) {
    const date = text.slice(0, 10);
    if (!DATE_ONLY.test(date)) throw new Error(`"${name}" must start with a date like 2026-03-31`);
    return { date };
  }
  const zone = timeZone?.trim();
  const offset = HAS_OFFSET.test(text);
  if (!offset && !zone) {
    throw new Error(`"${name}" needs a time zone offset (for example +02:00), or set "timeZone"`);
  }
  validTime(offset ? text : `${text}Z`, name);
  return zone ? { dateTime: text, timeZone: zone } : { dateTime: text };
}

/** The day after a `YYYY-MM-DD` date. */
export function nextDay(date: string): string {
  const next = new Date(`${date}T00:00:00Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  return next.toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------------------------
// Event body

export type EventBody = { body: Record<string, unknown>; conference: boolean };

/** The body of an insert or a patch. Only the fields that are set go in. */
export function eventBody(fields: EventFields, mode: "create" | "update"): EventBody {
  const body: Record<string, unknown> = {};
  const set = (key: string, value: string | undefined) => {
    if (value !== undefined && value !== "") body[key] = value;
  };
  set("summary", fields.summary);
  set("description", fields.description);
  set("location", fields.location);
  set("visibility", fields.visibility);
  set("colorId", fields.colorId);

  const allDay = fields.allDay === true;
  let start: Record<string, string> | undefined;
  if (fields.start?.trim()) {
    start = eventTime(fields.start, "start", allDay, fields.timeZone);
    body.start = start;
  } else if (mode === "create") {
    fail('"start" is needed to create an event');
  }
  if (fields.end?.trim()) {
    const end = eventTime(fields.end, "end", allDay, fields.timeZone);
    // An all-day end date is not part of the event. The same day means a one-day event.
    if (allDay && start?.date !== undefined && end.date === start.date) {
      end.date = nextDay(start.date);
    }
    body.end = end;
  } else if (mode === "create") {
    if (start?.date === undefined) fail('"end" is needed to create an event');
    body.end = { date: nextDay(start.date) };
  }

  const attendees = splitList(fields.attendees);
  if (attendees.length > 0) {
    for (const email of attendees) {
      if (!/^[^\s@]+@[^\s@]+$/.test(email)) throw new Error(`"${email}" is not an email address`);
    }
    body.attendees = attendees.map((email) => ({ email }));
  }

  const rules = (fields.recurrence ?? "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  if (rules.length > 0) {
    for (const rule of rules) {
      if (!/^(RRULE|EXRULE|RDATE|EXDATE)[:;]/i.test(rule)) {
        throw new Error(`"${rule}" is not a recurrence line. Start it with RRULE: or RDATE:`);
      }
    }
    body.recurrence = rules;
  }

  if (fields.remindersMode === "none") {
    body.reminders = { useDefault: false, overrides: [] };
  } else if (fields.remindersMode === "custom") {
    const overrides = splitList(fields.reminderMinutes).map((text) => {
      const minutes = Number(text);
      if (!Number.isInteger(minutes) || minutes < 0 || minutes > 40_320) {
        throw new Error(`"${text}" is not a reminder time. Use minutes from 0 to 40320`);
      }
      return { method: "popup", minutes };
    });
    body.reminders = { useDefault: false, overrides };
  } else if (fields.remindersMode === "default") {
    body.reminders = { useDefault: true };
  }

  const conference = fields.addMeet === true;
  if (conference) {
    body.conferenceData = {
      createRequest: {
        requestId: randomUUID(),
        conferenceSolutionKey: { type: "hangoutsMeet" },
      },
    };
  }
  return { body, conference };
}

// ---------------------------------------------------------------------------------------------
// Requests

const calendarPath = (calendarId: string) => `/calendars/${seg(calendarId)}`;
const eventPath = (calendarId: string, eventId: string) =>
  `${calendarPath(calendarId)}/events/${seg(eventId)}`;

export const listCalendarsRequest = (
  pageSize: number,
  pageToken?: string,
  minAccessRole?: string,
): CalendarRequest => ({
  method: "GET",
  path: "/users/me/calendarList",
  query: { maxResults: String(pageSize), pageToken, minAccessRole },
  action: "list the calendars",
});

export type ListEventsOptions = {
  timeMin?: string;
  timeMax?: string;
  query?: string;
  singleEvents: boolean;
  orderBy?: "startTime" | "updated";
  showDeleted?: boolean;
  updatedMin?: string;
  timeZone?: string;
};

export const listEventsRequest = (
  calendarId: string,
  options: ListEventsOptions,
  pageSize: number,
  pageToken?: string,
): CalendarRequest => ({
  method: "GET",
  path: `${calendarPath(calendarId)}/events`,
  query: {
    maxResults: String(pageSize),
    pageToken,
    timeMin: options.timeMin,
    timeMax: options.timeMax,
    q: options.query?.trim(),
    singleEvents: String(options.singleEvents),
    orderBy: options.orderBy,
    showDeleted: options.showDeleted ? "true" : undefined,
    updatedMin: options.updatedMin,
    timeZone: options.timeZone?.trim(),
  },
  action: "list the events",
});

export const getEventRequest = (calendarId: string, eventId: string): CalendarRequest => ({
  method: "GET",
  path: eventPath(calendarId, eventId),
  action: "get the event",
});

const eventQuery = (sendUpdates: SendUpdates, conference: boolean) => ({
  sendUpdates,
  conferenceDataVersion: conference ? "1" : undefined,
});

export const createEventRequest = (
  calendarId: string,
  event: EventBody,
  sendUpdates: SendUpdates,
): CalendarRequest => ({
  method: "POST",
  path: `${calendarPath(calendarId)}/events`,
  query: eventQuery(sendUpdates, event.conference),
  body: event.body,
  action: "create the event",
});

export const updateEventRequest = (
  calendarId: string,
  eventId: string,
  event: EventBody,
  sendUpdates: SendUpdates,
): CalendarRequest => ({
  method: "PATCH",
  path: eventPath(calendarId, eventId),
  query: eventQuery(sendUpdates, event.conference),
  body: event.body,
  action: "update the event",
});

export const deleteEventRequest = (
  calendarId: string,
  eventId: string,
  sendUpdates: SendUpdates,
): CalendarRequest => ({
  method: "DELETE",
  path: eventPath(calendarId, eventId),
  query: { sendUpdates },
  action: "delete the event",
});

export const quickAddRequest = (
  calendarId: string,
  text: string,
  sendUpdates: SendUpdates,
): CalendarRequest => ({
  method: "POST",
  path: `${calendarPath(calendarId)}/events/quickAdd`,
  query: { text, sendUpdates },
  action: "quick add the event",
});

export const freeBusyRequest = (
  calendarIds: string[],
  timeMin: string,
  timeMax: string,
  timeZone?: string,
): CalendarRequest => ({
  method: "POST",
  path: "/freeBusy",
  body: {
    timeMin,
    timeMax,
    ...(timeZone?.trim() && { timeZone: timeZone.trim() }),
    items: calendarIds.map((id) => ({ id })),
  },
  action: "check the free and busy times",
});

// ---------------------------------------------------------------------------------------------
// Answers

export type Busy = { start: string; end: string };

export type Availability = {
  timeMin: string;
  timeMax: string;
  /** True when no calendar is busy in the range. */
  isFree: boolean;
  /** The busy times of all calendars, in order of start. */
  busy: Busy[];
  calendars: Record<string, { busy: Busy[]; errors: unknown[] }>;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const toBusy = (value: unknown): Busy[] =>
  Array.isArray(value)
    ? value.flatMap((entry) =>
        isRecord(entry) && typeof entry.start === "string" && typeof entry.end === "string"
          ? [{ start: entry.start, end: entry.end }]
          : [],
      )
    : [];

/** The answer of the freeBusy call in a shape that is easy to use. */
export function toAvailability(answer: unknown, timeMin: string, timeMax: string): Availability {
  const raw = isRecord(answer) && isRecord(answer.calendars) ? answer.calendars : {};
  const calendars: Availability["calendars"] = {};
  const busy: Busy[] = [];
  for (const [id, entry] of Object.entries(raw)) {
    const own = isRecord(entry) ? toBusy(entry.busy) : [];
    const errors = isRecord(entry) && Array.isArray(entry.errors) ? entry.errors : [];
    calendars[id] = { busy: own, errors };
    busy.push(...own);
  }
  busy.sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
  return { timeMin, timeMax, isFree: busy.length === 0, busy, calendars };
}

/** The `items` and the `nextPageToken` of a list answer. */
export function pageOf(answer: unknown): { items: unknown[]; next?: string } {
  if (!isRecord(answer)) return { items: [] };
  return {
    items: Array.isArray(answer.items) ? answer.items : [],
    next: typeof answer.nextPageToken === "string" ? answer.nextPageToken : undefined,
  };
}
