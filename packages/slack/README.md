# @zerodot/slack

Send and change messages, manage channels, find users, add reactions, and upload files with a Slack bot, and start a workflow on a Slack event, such as a new message or a mention. Use it for team notifications and chat bots.

## Install

In zerodot, go to **System > Nodes** and install **Slack**.

Manual: install `@zerodot/slack` where the web app and the worker run, and add it to `ZERODOT_NODE_PACKAGES`.

## Nodes

### Slack (`slack.api`)

- **Message**: send, update, delete, get the permalink
- **Channel**: list, get, create, archive, join, invite users
- **User**: get, list, get by email
- **Reaction**: add, remove
- **File**: upload binary data or text, and share it in a channel or a thread

Messages can have Block Kit blocks as JSON. When Slack answers with `ok: false`, the node fails with the error code of Slack and a short help text. A rate limit (HTTP 429) gives the time to wait from `Retry-After`.

### Slack Trigger (`trigger.slack`)

Starts a run on an event of the Events API, for example a message, a mention of the app, or a reaction. You can accept events only from some channels. Messages from bots are ignored, unless you turn on **Include Bot Messages**.

Set the webhook address of the trigger as the **Request URL** in **Event Subscriptions** of your Slack app, and subscribe to the bot events that you need. The trigger answers the `url_verification` challenge. Each request must have a valid `X-Slack-Signature` and a timestamp that is at most 5 minutes old.

Slack sends events only to the saved Request URL, so test listening is not available. Publish the workflow to get events.

## Credential

**Slack bot** (`slack.bot`): `accessToken` is the Bot User OAuth Token (`xoxb-…`). `signingSecret` is from **Basic Information > App Credentials**, and only the trigger needs it. Both are secret. The **Test** button calls `auth.test`.

Scopes for the node: `chat:write`, `channels:read`, `groups:read`, `im:read`, `mpim:read`, `channels:manage`, `groups:write`, `channels:join`, `users:read`, `users:read.email`, `reactions:write`, `files:write`. Give only the scopes of the operations that you use.

## License

AGPL-3.0-only
