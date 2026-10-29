// SPDX-License-Identifier: AGPL-3.0-only
import assert from "node:assert/strict";
import { createVerify, generateKeyPairSync } from "node:crypto";
import { afterEach, beforeEach, describe, it, mock } from "node:test";
import type { NodeDefinition } from "@zerodot/node-sdk";
import {
  CALENDAR_SCOPE,
  calendarError,
  clearTokenCache,
  parseServiceAccountKey,
  serviceAccountToken,
  signJwt,
  TOKEN_URL,
} from "./api";
import { calendarConfig } from "./config";
import { credentialTypes, nodes } from "./index";
import { eventBody, eventTime, nextDay, queryTime, splitList, toAvailability } from "./request";
import { changeOf, pickChanges } from "./trigger";

const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const PEM = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
const KEY = {
  client_email: "bot@p.iam.gserviceaccount.com",
  private_key: PEM,
  private_key_id: "k1",
};
const KEY_JSON = JSON.stringify({ type: "service_account", ...KEY });

const signal = new AbortController().signal;
type Cred = { type: string; data: Record<string, unknown> };
const oauth: Cred = { type: "google_calendar.oauth2", data: { accessToken: "ya29.secret" } };

type Call = { url: string; init: RequestInit };
type Answer = { body?: unknown; status?: number };

/** Answers the calls in order. */
function mockFetch(answers: Answer[], calls: Call[] = []) {
  mock.method(globalThis, "fetch", async (url: URL | string, init: RequestInit) => {
    calls.push({ url: String(url), init });
    const answer = answers[calls.length - 1] ?? {};
    if (answer.status === 204) return new Response(null, { status: 204 });
    return new Response(JSON.stringify(answer.body ?? {}), { status: answer.status ?? 200 });
  });
  return calls;
}

const bodyOf = (call: Call | undefined): Record<string, unknown> =>
  JSON.parse(String(call?.init.body));

const paramsOf = (call: Call | undefined) => new URL(call?.url ?? "http://x").searchParams;

const find = (type: string): NodeDefinition => {
  const found = nodes.find((entry) => entry.type === type);
  if (!found) throw new Error(`no node ${type}`);
  return found;
};

const run = async (config: Record<string, unknown>, credential: Cred = oauth) => {
  const definition = find("google_calendar.api");
  return await definition.run({
    config: definition.config.parse(config),
    input: null,
    credential,
    signal,
    scope: {},
    tables: null,
    sandbox: null,
  } as never);
};

const poll = async (config: Record<string, unknown>, cursor: unknown, firstPoll = false) => {
  const definition = find("trigger.google_calendar");
  assert.ok(definition.poll);
  return await definition.poll({
    config: definition.config.parse(config),
    credential: oauth,
    cursor,
    firstPoll,
    workflow: { id: "w", name: "w" },
    node: { id: "n", name: "n" },
    signal,
  } as never);
};

beforeEach(() => clearTokenCache());
afterEach(() => mock.restoreAll());

const decode = (part: string | undefined) =>
  JSON.parse(Buffer.from(part ?? "", "base64url").toString("utf8"));

describe("service account", () => {
  it("signs an RS256 JWT with the Calendar scope", () => {
    const jwt = signJwt(KEY, 1_700_000_000_000);
    const [header, claims, signature] = jwt.split(".");
    assert.deepEqual(decode(header), { alg: "RS256", typ: "JWT", kid: "k1" });
    assert.deepEqual(decode(claims), {
      iss: KEY.client_email,
      scope: CALENDAR_SCOPE,
      aud: TOKEN_URL,
      iat: 1_700_000_000,
      exp: 1_700_003_600,
    });
    const valid = createVerify("RSA-SHA256")
      .update(`${header}.${claims}`)
      .verify(publicKey, Buffer.from(signature ?? "", "base64url"));
    assert.equal(valid, true);
  });

  it("rejects a key without the fields", () => {
    assert.throws(() => parseServiceAccountKey("{}"), /client_email/);
    assert.throws(() => parseServiceAccountKey("nope"), /not valid JSON/);
  });

  it("caches the token until near its end", async () => {
    const calls = mockFetch([
      { body: { access_token: "t1", expires_in: 3600 } },
      { body: { access_token: "t2", expires_in: 3600 } },
    ]);
    let now = 1_000_000;
    const clock = { now: () => now };
    assert.equal(await serviceAccountToken(KEY, clock), "t1");
    now += 3_000_000;
    assert.equal(await serviceAccountToken(KEY, clock), "t1");
    assert.equal(calls.length, 1);
    now += 560_000;
    assert.equal(await serviceAccountToken(KEY, clock), "t2");
  });

  it("runs the node with the token of the service account", async () => {
    const calls = mockFetch([{ body: { access_token: "sa-token" } }, { body: { items: [] } }]);
    await run(
      { authentication: "serviceAccount", resource: "calendar" },
      {
        type: "google_calendar.service_account",
        data: { serviceAccountKey: KEY_JSON },
      },
    );
    const headers = calls[1]?.init.headers as Record<string, string>;
    assert.equal(headers.authorization, "Bearer sa-token");
  });
});

describe("credentials", () => {
  it("has a Google OAuth2 preset with the Calendar scope and offline access", () => {
    const oauth2 = credentialTypes[0]?.oauth2;
    assert.ok(oauth2 && typeof oauth2 === "object");
    assert.deepEqual(oauth2.scopes, [CALENDAR_SCOPE]);
    assert.equal(oauth2.authQuery?.access_type, "offline");
  });

  it("checks the service account key", () => {
    const fields = credentialTypes[1]?.fields;
    assert.equal(fields?.safeParse({ serviceAccountKey: KEY_JSON }).success, true);
    assert.equal(fields?.safeParse({ serviceAccountKey: "{}" }).success, false);
  });

  it("needs a credential", async () => {
    await assert.rejects(run({ resource: "calendar" }, null as never), /needs a Google Calendar/);
  });
});

describe("times", () => {
  it("makes timed and all-day event times", () => {
    assert.deepEqual(eventTime("2026-03-31T14:00:00+02:00", "start", false), {
      dateTime: "2026-03-31T14:00:00+02:00",
    });
    assert.deepEqual(eventTime("2026-03-31T14:00:00", "start", false, "Europe/Paris"), {
      dateTime: "2026-03-31T14:00:00",
      timeZone: "Europe/Paris",
    });
    assert.deepEqual(eventTime("2026-03-31T14:00:00Z", "start", true), { date: "2026-03-31" });
    assert.throws(() => eventTime("2026-03-31T14:00:00", "start", false), /time zone/);
    assert.throws(() => eventTime("tomorrow", "start", true), /date like/);
    assert.equal(nextDay("2026-02-28"), "2026-03-01");
  });

  it("gives query times an offset", () => {
    assert.equal(queryTime("", "timeMin"), undefined);
    assert.equal(queryTime("2026-03-31", "timeMin"), "2026-03-31T00:00:00Z");
    assert.equal(
      queryTime("2026-03-31T10:00:00", "timeMin", "Asia/Kolkata"),
      "2026-03-31T10:00:00+05:30",
    );
    assert.equal(
      queryTime("2026-01-15T10:00:00", "timeMin", "America/New_York"),
      "2026-01-15T10:00:00-05:00",
    );
    assert.equal(queryTime("2026-03-31T10:00:00+01:00", "timeMin"), "2026-03-31T10:00:00+01:00");
    assert.throws(() => queryTime("nope", "timeMin"), /not a valid date/);
    assert.throws(() => queryTime("2026-03-31T10:00:00", "timeMin", "Mars/Base"), /time zone/);
  });
});

describe("event body", () => {
  it("builds attendees, recurrence, reminders, and a Meet request", () => {
    const { body, conference } = eventBody(
      {
        summary: "Sync",
        start: "2026-03-31T14:00:00+02:00",
        end: "2026-03-31T15:00:00+02:00",
        attendees: "a@x.com, b@x.com",
        recurrence: "RRULE:FREQ=WEEKLY;COUNT=3",
        remindersMode: "custom",
        reminderMinutes: "10,60",
        addMeet: true,
      },
      "create",
    );
    assert.equal(conference, true);
    assert.deepEqual(body.attendees, [{ email: "a@x.com" }, { email: "b@x.com" }]);
    assert.deepEqual(body.recurrence, ["RRULE:FREQ=WEEKLY;COUNT=3"]);
    assert.deepEqual(body.reminders, {
      useDefault: false,
      overrides: [
        { method: "popup", minutes: 10 },
        { method: "popup", minutes: 60 },
      ],
    });
    const request = (body.conferenceData as { createRequest: Record<string, unknown> })
      .createRequest;
    assert.deepEqual(request.conferenceSolutionKey, { type: "hangoutsMeet" });
    assert.equal(typeof request.requestId, "string");
  });

  it("makes a one-day event when an all-day event has no end", () => {
    const { body } = eventBody({ start: "2026-03-31", allDay: true }, "create");
    assert.deepEqual(body.end, { date: "2026-04-01" });
    const same = eventBody({ start: "2026-03-31", end: "2026-03-31", allDay: true }, "create");
    assert.deepEqual(same.body.end, { date: "2026-04-01" });
  });

  it("checks the input", () => {
    assert.throws(() => eventBody({ end: "2026-03-31T15:00:00Z" }, "create"), /"start"/);
    assert.throws(() => eventBody({ start: "2026-03-31T15:00:00Z" }, "create"), /"end"/);
    assert.throws(() => eventBody({ attendees: "nope" }, "update"), /not an email/);
    assert.throws(() => eventBody({ recurrence: "WEEKLY" }, "update"), /recurrence/);
    assert.throws(
      () => eventBody({ remindersMode: "custom", reminderMinutes: "x" }, "update"),
      /reminder time/,
    );
  });

  it("sends only the fields that are set on update", () => {
    const { body, conference } = eventBody(
      { summary: "New", remindersMode: "unchanged" },
      "update",
    );
    assert.deepEqual(body, { summary: "New" });
    assert.equal(conference, false);
  });

  it("splits lists", () => {
    assert.deepEqual(splitList(" a, b\nc ,,"), ["a", "b", "c"]);
  });
});

describe("node", () => {
  it("lists calendars with paging and a limit", async () => {
    const calls = mockFetch([
      { body: { items: [{ id: "a" }, { id: "b" }], nextPageToken: "p2" } },
      { body: { items: [{ id: "c" }, { id: "d" }] } },
    ]);
    const out = await run({ resource: "calendar", operation: "getMany", limit: 3 });
    assert.deepEqual(out, { port: "out", data: [{ id: "a" }, { id: "b" }, { id: "c" }] });
    assert.equal(paramsOf(calls[0]).get("maxResults"), "3");
    assert.equal(paramsOf(calls[1]).get("pageToken"), "p2");
    assert.equal(paramsOf(calls[1]).get("maxResults"), "1");
    assert.match(calls[0]?.url ?? "", /\/calendar\/v3\/users\/me\/calendarList/);
    const headers = calls[0]?.init.headers as Record<string, string>;
    assert.equal(headers.authorization, "Bearer ya29.secret");
  });

  it("lists events in a time range with a search", async () => {
    const calls = mockFetch([{ body: { items: [{ id: "e1" }] } }]);
    await run({
      resource: "event",
      operation: "getMany",
      calendarId: "me@x.com",
      timeMin: "2026-03-01",
      timeMax: "2026-03-31T10:00:00",
      timeZone: "Europe/Paris",
      query: "lunch",
      returnAll: true,
    });
    const url = calls[0]?.url ?? "";
    assert.match(url, /\/calendars\/me%40x\.com\/events\?/);
    const params = paramsOf(calls[0]);
    assert.equal(params.get("timeMin"), "2026-03-01T00:00:00+01:00");
    assert.equal(params.get("timeMax"), "2026-03-31T10:00:00+02:00");
    assert.equal(params.get("q"), "lunch");
    assert.equal(params.get("singleEvents"), "true");
    assert.equal(params.get("orderBy"), "startTime");
    assert.equal(params.get("maxResults"), "2500");
  });

  it("drops orderBy when recurring events stay folded", async () => {
    const calls = mockFetch([{ body: { items: [] } }]);
    await run({ resource: "event", operation: "getMany", singleEvents: false });
    assert.equal(paramsOf(calls[0]).get("orderBy"), null);
  });

  it("gets an event and needs its ID", async () => {
    const calls = mockFetch([{ body: { id: "e 1" } }]);
    const out = await run({ resource: "event", operation: "get", eventId: "e 1" });
    assert.deepEqual(out, { port: "out", data: { id: "e 1" } });
    assert.match(calls[0]?.url ?? "", /\/calendars\/primary\/events\/e%201$/);
    await assert.rejects(run({ resource: "event", operation: "get" }), /"eventId" is needed/);
  });

  it("creates an event with guests, a Meet link, and mail to guests", async () => {
    const calls = mockFetch([{ body: { id: "new", hangoutLink: "https://meet.google.com/x" } }]);
    const out = await run({
      resource: "event",
      operation: "create",
      summary: "Sync",
      start: "2026-03-31T14:00:00+02:00",
      end: "2026-03-31T15:00:00+02:00",
      attendees: "a@x.com",
      addMeet: true,
      sendUpdates: "all",
    });
    assert.deepEqual(out, {
      port: "out",
      data: { id: "new", hangoutLink: "https://meet.google.com/x" },
    });
    assert.equal(calls[0]?.init.method, "POST");
    const params = paramsOf(calls[0]);
    assert.equal(params.get("conferenceDataVersion"), "1");
    assert.equal(params.get("sendUpdates"), "all");
    const body = bodyOf(calls[0]);
    assert.equal(body.summary, "Sync");
    assert.deepEqual(body.attendees, [{ email: "a@x.com" }]);
    assert.ok(body.conferenceData);
  });

  it("updates with PATCH and changes only the set fields", async () => {
    const calls = mockFetch([{ body: { id: "e1" } }]);
    await run({ resource: "event", operation: "update", eventId: "e1", location: "Room 2" });
    assert.equal(calls[0]?.init.method, "PATCH");
    assert.deepEqual(bodyOf(calls[0]), { location: "Room 2" });
    assert.equal(paramsOf(calls[0]).get("conferenceDataVersion"), null);
  });

  it("deletes an event", async () => {
    const calls = mockFetch([{ status: 204 }]);
    const out = await run({ resource: "event", operation: "delete", eventId: "e1" });
    assert.deepEqual(out, {
      port: "out",
      data: { success: true, calendarId: "primary", eventId: "e1" },
    });
    assert.equal(calls[0]?.init.method, "DELETE");
    assert.equal(paramsOf(calls[0]).get("sendUpdates"), "none");
  });

  it("quick adds an event from text", async () => {
    const calls = mockFetch([{ body: { id: "q1" } }]);
    await run({ resource: "event", operation: "quickAdd", text: "Lunch at 1pm" });
    assert.match(calls[0]?.url ?? "", /\/events\/quickAdd\?/);
    assert.equal(paramsOf(calls[0]).get("text"), "Lunch at 1pm");
    await assert.rejects(run({ resource: "event", operation: "quickAdd" }), /"text" is needed/);
  });

  it("checks availability of several calendars", async () => {
    const calls = mockFetch([
      {
        body: {
          calendars: {
            a: { busy: [{ start: "2026-03-31T12:00:00Z", end: "2026-03-31T13:00:00Z" }] },
            b: { busy: [{ start: "2026-03-31T09:00:00Z", end: "2026-03-31T10:00:00Z" }] },
          },
        },
      },
    ]);
    const out = (await run({
      resource: "availability",
      operation: "check",
      calendarIds: "a, b",
      timeMin: "2026-03-31T00:00:00Z",
      timeMax: "2026-04-01T00:00:00Z",
    })) as { data: { isFree: boolean; busy: { start: string }[] } };
    assert.match(calls[0]?.url ?? "", /\/calendar\/v3\/freeBusy$/);
    assert.deepEqual(bodyOf(calls[0]).items, [{ id: "a" }, { id: "b" }]);
    assert.equal(out.data.isFree, false);
    assert.deepEqual(
      out.data.busy.map((entry) => entry.start),
      ["2026-03-31T09:00:00Z", "2026-03-31T12:00:00Z"],
    );
    await assert.rejects(
      run({
        resource: "availability",
        operation: "check",
        timeMin: "2026-04-01T00:00:00Z",
        timeMax: "2026-03-01T00:00:00Z",
      }),
      /after "timeMin"/,
    );
  });

  it("reports free when nothing is busy", () => {
    const result = toAvailability({ calendars: { primary: { busy: [] } } }, "a", "b");
    assert.equal(result.isFree, true);
  });

  it("gives a clear error without the token", async () => {
    mockFetch([
      {
        status: 404,
        body: { error: { code: 404, message: "Not Found", status: "NOT_FOUND" } },
      },
    ]);
    await assert.rejects(
      run({ resource: "event", operation: "get", eventId: "x" }),
      (error: Error) =>
        /Google Calendar could not get the event \(404 NOT_FOUND\): Not Found\. Check the calendar ID/.test(
          error.message,
        ) && !error.message.includes("ya29"),
    );
    assert.match(calendarError(401, null, "x").message, /Connect the credential again/);
  });

  it("rejects an operation that the resource does not have", () => {
    assert.equal(
      calendarConfig.safeParse({ resource: "calendar", operation: "get" }).success,
      false,
    );
  });
});

describe("trigger", () => {
  const event = (id: string, created: string, updated: string, status = "confirmed") => ({
    id,
    created,
    updated,
    status,
  });

  it("is a poll trigger", () => {
    assert.equal(typeof find("trigger.google_calendar").poll, "function");
  });

  it("sets the cursor on the first poll and starts no runs", async () => {
    const calls = mockFetch([]);
    const result = await poll({}, null, true);
    assert.equal(result.items.length, 0);
    assert.equal(typeof result.cursor, "string");
    assert.equal(calls.length, 0);
  });

  it("tells created, updated, and cancelled events apart", () => {
    const since = Date.parse("2026-03-01T00:00:00Z");
    assert.equal(
      changeOf(event("a", "2026-03-02T00:00:00Z", "2026-03-02T00:00:00Z"), since),
      "created",
    );
    assert.equal(
      changeOf(event("a", "2026-02-01T00:00:00Z", "2026-03-02T00:00:00Z"), since),
      "updated",
    );
    assert.equal(
      changeOf(event("a", "2026-02-01T00:00:00Z", "2026-03-02T00:00:00Z", "cancelled"), since),
      "cancelled",
    );
  });

  it("skips old events, sorts, filters by kind, and moves the cursor", () => {
    const cursor = "2026-03-01T00:00:00.000Z";
    const events = [
      event("late", "2026-02-01T00:00:00Z", "2026-03-03T00:00:00.000Z"),
      event("old", "2026-02-01T00:00:00Z", "2026-03-01T00:00:00.000Z"),
      event("new", "2026-03-02T00:00:00Z", "2026-03-02T00:00:00.000Z"),
    ];
    const any = pickChanges(events, cursor, "any");
    assert.deepEqual(
      any.items.map((item) => item.key),
      ["new:2026-03-02T00:00:00.000Z", "late:2026-03-03T00:00:00.000Z"],
    );
    assert.equal(any.cursor, "2026-03-03T00:00:00.000Z");
    assert.equal(any.items[0]?.data.changeType, "created");

    const created = pickChanges(events, cursor, "created");
    assert.equal(created.items.length, 1);
    // The cursor moves past events that the filter skips.
    assert.equal(created.cursor, "2026-03-03T00:00:00.000Z");
    assert.equal(pickChanges([], cursor, "any").cursor, cursor);
  });

  it("asks for the events changed since the cursor", async () => {
    const cursor = "2026-03-01T00:00:00.000Z";
    const calls = mockFetch([
      {
        body: {
          items: [event("e1", "2026-03-02T00:00:00Z", "2026-03-02T00:00:00.000Z")],
          nextPageToken: "p2",
        },
      },
      { body: { items: [event("e2", "2026-01-01T00:00:00Z", "2026-03-03T00:00:00.000Z")] } },
    ]);
    const result = await poll({ calendarId: "me@x.com", trigger: "any" }, cursor);
    const params = paramsOf(calls[0]);
    assert.equal(params.get("updatedMin"), cursor);
    assert.equal(params.get("showDeleted"), "true");
    assert.equal(params.get("orderBy"), "updated");
    assert.equal(params.get("singleEvents"), "false");
    assert.equal(paramsOf(calls[1]).get("pageToken"), "p2");
    assert.deepEqual(
      result.items.map((item) => (item.data as { changeType: string }).changeType),
      ["created", "updated"],
    );
    assert.equal(result.cursor, "2026-03-03T00:00:00.000Z");
  });
});
