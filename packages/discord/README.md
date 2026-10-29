# @zerodot/discord

Send, edit, and react to messages, manage channels, members, and roles with a Discord bot, post with a webhook, and start a workflow on a slash command or a button click. Use it to build Discord bots, alerts, and moderation flows.

## Install

In zerodot, go to **System > Nodes** and install **Discord**.

Manual: install `@zerodot/discord` where the web app and the worker run, and add it to `ZERODOT_NODE_PACKAGES`.

## Nodes

### Discord (`discord.api`)

- **Message**: send, edit, delete, get, list, react
- **Channel**: list, get, create, delete
- **Member**: get, list, add a role, remove a role, kick
- **Server**: get
- **Webhook**: execute, with a username, an avatar, and embeds

Messages can have embeds, components, allowed mentions, and up to 10 files from binary data of the input. Moderation operations can write a reason to the audit log. When Discord answers 429, the node waits `retry_after` and tries again.

To reply to an interaction from the trigger, use **Webhook > Execute** with a bot credential. Set **Webhook ID** to `applicationId` and **Webhook Token** to `token` of the trigger output.

### Discord Trigger (`trigger.discord`)

Starts a run on an interaction of your Discord app: a slash command, a button or select menu, or a modal. The trigger checks the Ed25519 signature of each request with the public key of the application, and answers the PING of Discord.

Discord wants an answer in 3 seconds, so the trigger answers at once: a deferred message, a deferred private message, a deferred update, or a fixed text. The workflow then replies with a webhook execute.

Copy the webhook URL of the trigger to **Interactions Endpoint URL** in the Developer Portal (General Information). Discord must be able to reach your zerodot instance. By default the trigger does not change the application. With **Set Interactions Endpoint** on, the trigger sets the address itself. When the workflow stops, it clears the address only if the address is still the one that it set.

## Credentials

- **Discord bot** (`discord.bot`): `botToken` from the Developer Portal, and an optional `publicKey` of the application. Without the public key, the trigger gets it from Discord. The token is secret.
- **Discord webhook** (`discord.webhook`): `webhookUrl` of a channel webhook. It can only post messages. The address is secret.

## License

AGPL-3.0-only
