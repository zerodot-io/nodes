// SPDX-License-Identifier: AGPL-3.0-only
import { z } from "zod";

// Resource and operation names follow the Google Calendar API v3.

export const RESOURCES = ["calendar", "event", "availability"] as const;
export type Resource = (typeof RESOURCES)[number];

export const OPERATIONS_OF = {
  calendar: ["getMany"],
  event: ["getMany", "get", "create", "update", "delete", "quickAdd"],
  availability: ["check"],
} as const satisfies Record<Resource, readonly string[]>;

const ALL_OPERATIONS = [...new Set(Object.values(OPERATIONS_OF).flat())] as [string, ...string[]];

export const AUTHENTICATION = ["oAuth2", "serviceAccount"] as const;

/** Show a field only for these operations of the event resource. */
const onEvent = (...operations: string[]) => ({
  showWhen: { resource: ["event"], operation: operations },
});

const WRITE = ["create", "update"];
const WITH_CALENDAR = ["getMany", "get", "create", "update", "delete", "quickAdd"];
const WITH_UPDATES = ["create", "update", "delete", "quickAdd"];

export const authenticationField = z
  .enum(AUTHENTICATION)
  .default("oAuth2")
  .meta({
    title: "Authentication",
    labels: { oAuth2: "OAuth2", serviceAccount: "Service Account" },
    hints: {
      oAuth2: "Sign in with a Google account",
      serviceAccount: "Use the JSON key of a service account",
    },
  });

export const calendarField = z.string().default("primary").meta({
  title: "Calendar",
  description: "The ID of the calendar, or its email address. primary: the main calendar",
});

export const calendarConfig = z
  .object({
    authentication: authenticationField,
    resource: z
      .enum(RESOURCES)
      .default("event")
      .meta({
        labels: { calendar: "Calendar", event: "Event", availability: "Availability" },
        hints: {
          calendar: "List the calendars of the account",
          event: "Read, create, change, and delete events",
          availability: "Check when calendars are free or busy",
        },
      }),
    operation: z
      .enum(ALL_OPERATIONS)
      .default("getMany")
      .meta({
        labels: {
          getMany: "Get Many",
          get: "Get",
          create: "Create",
          update: "Update",
          delete: "Delete",
          quickAdd: "Quick Add",
          check: "Check",
        },
        hints: {
          getMany: "Get a list of calendars or events",
          get: "Get one event",
          create: "Create an event",
          update: "Change the fields that you set, and keep the others",
          delete: "Remove an event",
          quickAdd: "Create an event from one line of text, for example: Lunch with Ann at 1pm",
          check: "Get the busy times of one or more calendars in a time range",
        },
      }),
    calendarId: calendarField.meta({
      showWhen: { resource: ["event"], operation: WITH_CALENDAR },
      title: "Calendar",
      description: "The ID of the calendar, or its email address. Empty: the main calendar",
    }),
    calendarIds: z
      .string()
      .optional()
      .meta({
        showWhen: { resource: ["availability"] },
        title: "Calendars",
        description: "IDs of calendars, with commas between. Empty: the main calendar",
      }),
    eventId: z
      .string()
      .optional()
      .meta({
        ...onEvent("get", "update", "delete"),
        title: "Event ID",
        description: "The ID of the event",
      }),
    text: z
      .string()
      .optional()
      .meta({
        ...onEvent("quickAdd"),
        title: "Text",
        description: "One line that says what and when, for example: Lunch with Ann at 1pm",
      }),
    returnAll: z
      .boolean()
      .default(false)
      .meta({
        showWhen: [{ resource: ["calendar"] }, { resource: ["event"], operation: ["getMany"] }],
        title: "Return All",
        description: "Get all results. Else get up to the limit",
      }),
    limit: z
      .number()
      .int()
      .min(1)
      .max(10_000)
      .default(50)
      .meta({
        showWhen: [
          { resource: ["calendar"], returnAll: [false] },
          { resource: ["event"], operation: ["getMany"], returnAll: [false] },
        ],
        title: "Limit",
      }),
    minAccessRole: z
      .enum(["", "freeBusyReader", "reader", "writer", "owner"])
      .default("")
      .meta({
        showWhen: { resource: ["calendar"] },
        title: "Minimum Access",
        labels: {
          "": "Any",
          freeBusyReader: "Free/Busy Reader",
          reader: "Reader",
          writer: "Writer",
          owner: "Owner",
        },
        hints: {
          "": "All calendars in the list",
          freeBusyReader: "Calendars where you see free and busy times",
          reader: "Calendars where you read events",
          writer: "Calendars where you change events",
          owner: "Calendars that you own",
        },
      }),
    timeMin: z
      .string()
      .optional()
      .meta({
        showWhen: [{ resource: ["event"], operation: ["getMany"] }, { resource: ["availability"] }],
        title: "From",
        description:
          "Start of the time range. A date (2026-03-31) or a date and time. Availability: empty is now",
      }),
    timeMax: z
      .string()
      .optional()
      .meta({
        showWhen: [{ resource: ["event"], operation: ["getMany"] }, { resource: ["availability"] }],
        title: "To",
        description:
          "End of the time range. A date or a date and time. Availability: empty is 24 hours after From",
      }),
    query: z
      .string()
      .optional()
      .meta({
        ...onEvent("getMany"),
        title: "Search",
        description: "Give only events with this text in the title, description, place, or guests",
      }),
    singleEvents: z
      .boolean()
      .default(true)
      .meta({
        ...onEvent("getMany"),
        title: "Expand Recurring Events",
        description: "Give each repeat of a recurring event as its own event",
      }),
    orderBy: z
      .enum(["startTime", "updated"])
      .default("startTime")
      .meta({
        showWhen: { resource: ["event"], operation: ["getMany"], singleEvents: [true] },
        title: "Order By",
        labels: { startTime: "Start Time", updated: "Last Change" },
      }),
    summary: z
      .string()
      .optional()
      .meta({ ...onEvent(...WRITE), title: "Title" }),
    description: z
      .string()
      .optional()
      .meta({ ...onEvent(...WRITE), title: "Description" }),
    location: z
      .string()
      .optional()
      .meta({ ...onEvent(...WRITE), title: "Location" }),
    allDay: z
      .boolean()
      .default(false)
      .meta({
        ...onEvent(...WRITE),
        title: "All Day",
        description: "Use dates and no times. The end date is the last day of the event",
      }),
    start: z
      .string()
      .optional()
      .meta({
        ...onEvent(...WRITE),
        title: "Start",
        description:
          "Date and time, for example 2026-03-31T14:00:00+02:00. All day: a date. Update: empty keeps the start",
      }),
    end: z
      .string()
      .optional()
      .meta({
        ...onEvent(...WRITE),
        title: "End",
        description:
          "Date and time, like Start. All day: empty is a one-day event. Update: empty keeps the end",
      }),
    timeZone: z
      .string()
      .optional()
      .meta({
        showWhen: [
          { resource: ["event"], operation: [...WRITE, "getMany"] },
          { resource: ["availability"] },
        ],
        title: "Time Zone",
        description:
          "An IANA name, for example Europe/Paris. Used for times without an offset, and for repeats",
      }),
    attendees: z
      .string()
      .optional()
      .meta({
        ...onEvent(...WRITE),
        title: "Attendees",
        description: "Email addresses, with commas between. Update: this list replaces the guests",
      }),
    recurrence: z
      .string()
      .optional()
      .meta({
        ...onEvent(...WRITE),
        title: "Recurrence",
        ui: "textarea",
        description: "One rule on each line, for example RRULE:FREQ=WEEKLY;COUNT=10",
      }),
    remindersMode: z
      .enum(["unchanged", "default", "custom", "none"])
      .default("unchanged")
      .meta({
        ...onEvent(...WRITE),
        title: "Reminders",
        labels: {
          unchanged: "Not Set",
          default: "Calendar Default",
          custom: "Custom",
          none: "None",
        },
        hints: {
          unchanged: "Do not set reminders. Create: the calendar default. Update: no change",
          default: "Use the default reminders of the calendar",
          custom: "Set the minutes before the event",
          none: "No reminders",
        },
      }),
    reminderMinutes: z
      .string()
      .optional()
      .meta({
        showWhen: { resource: ["event"], operation: WRITE, remindersMode: ["custom"] },
        title: "Reminder Minutes",
        description: "Minutes before the event, with commas between, for example 10,60",
      }),
    addMeet: z
      .boolean()
      .default(false)
      .meta({
        ...onEvent(...WRITE),
        title: "Add Google Meet Link",
        description: "Make a video call link for the event. A service account cannot do this",
      }),
    visibility: z
      .enum(["", "default", "public", "private", "confidential"])
      .default("")
      .meta({
        ...onEvent(...WRITE),
        title: "Visibility",
        labels: {
          "": "Not Set",
          default: "Default",
          public: "Public",
          private: "Private",
          confidential: "Confidential",
        },
      }),
    colorId: z
      .string()
      .optional()
      .meta({ ...onEvent(...WRITE), title: "Color ID", description: "A number from 1 to 11" }),
    sendUpdates: z
      .enum(["all", "externalOnly", "none"])
      .default("none")
      .meta({
        ...onEvent(...WITH_UPDATES),
        title: "Send Updates",
        labels: { all: "All Guests", externalOnly: "External Guests", none: "None" },
        hints: {
          all: "Send an email to all guests",
          externalOnly: "Send an email to guests that do not use Google Calendar",
          none: "Send no email",
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

export type CalendarConfig = z.output<typeof calendarConfig>;
