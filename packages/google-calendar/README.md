# @zerodot/google-calendar

Create, read, update, and delete events in Google Calendar. List calendars, quick add an event, check free and busy times, and start a workflow on new or changed events. Connect with Google sign-in or a service account.

## Install

In zerodot, go to **System > Nodes** and install **Google Calendar**.

Manual: install `@zerodot/google-calendar` where the web app and the worker run, and add it to `ZERODOT_NODE_PACKAGES`.

## Nodes

### Google Calendar (`google_calendar.api`)

- **Calendar**: get many calendars
- **Event**: get many, get, create, update, delete, quick add
- **Availability**: check the free and busy times of one or more calendars

The calendar is an ID or an email address. `primary` is the main calendar of the account.

**Get many events**: set a time range with **From** and **To** (a date or a date and time), and a text to search for. Recurring events are expanded by default, so each repeat is one event. Results come in order of start time or last change.

**Times**: a time needs an offset, for example `2026-03-31T14:00:00+02:00`. Or give a time without an offset and set **Time Zone** to an IANA name, for example `Europe/Paris`. For an all-day event, use dates. Without an end, an all-day event lasts one day.

**Create and update**: set title, description, location, start, end, attendees, recurrence, reminders, visibility, and color. Update uses PATCH. It changes only the fields that you set. A list of attendees replaces the old list.

- Attendees: email addresses with commas between.
- Recurrence: one rule on each line, for example `RRULE:FREQ=WEEKLY;COUNT=10`.
- Reminders: use the calendar default, set minutes before the event (for example `10,60`), or set none.
- Google Meet: turn on **Add Google Meet Link**. The answer has the link in `hangoutLink`.
- **Send Updates** says who gets an email: all guests, external guests, or nobody (default).

**Quick add**: one line of text, for example `Lunch with Ann tomorrow at 1pm`. Google reads the time.

**Check availability**: the answer has `isFree`, `busy` (all busy times, in order), and `calendars` (busy times and errors for each calendar). Empty **From** is now. Empty **To** is 24 hours after **From**.

### On Google Calendar event (`trigger.google_calendar`)

A polling trigger. It checks a calendar on a timer (default 60 seconds, minimum 15) and starts one run for each event that is new, changed, or cancelled. Choose what starts a run: created, updated, cancelled, or any change. You can also filter with a search text.

The first check only marks the time. Events from before it start no runs. The input of a run is the event, with an extra field `changeType`: `created`, `updated`, or `cancelled`. A repeat of a recurring event is not a separate event. The trigger gives the recurring event itself.

## Credentials

- **Google Calendar OAuth2** (`google_calendar.oauth2`): `clientId` and `clientSecret` of a Google Cloud OAuth client. Scope `https://www.googleapis.com/auth/calendar`. zerodot refreshes the token. The client secret and the tokens are secret.
- **Google Calendar service account** (`google_calendar.service_account`): the JSON key file of a service account, as text. Share each calendar with the email of the service account, and give it the right access (see events, or make changes). The key is secret.

Turn on the Google Calendar API in the Google Cloud project.

A service account has its own calendars. It cannot make Google Meet links for events, and it cannot add guests to an event unless the Google Workspace admin gives it domain-wide delegation. This package does not set a user to act as. Use OAuth2 for these cases.

## License

AGPL-3.0-only
