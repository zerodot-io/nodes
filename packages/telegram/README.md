# @zerodot/telegram

Send messages and files with a Telegram bot, and start a workflow when the bot gets a message or other update. Use it to build chat bots and notifications.

## Install

In zerodot, go to **System > Nodes** and install **Telegram**.

Manual: install `@zerodot/telegram` where the web app and the worker run, and add it to `ZERODOT_NODE_PACKAGES`.

## Nodes

### Telegram (`telegram.bot`)

- **Message**: send, edit, delete, pin, unpin, send a chat action
- **Media**: send a photo, video, audio file, document, animation, sticker, location, or media group
- **Wait for response**: send a message and wait for an approval, a free text, or a form
- **Chat**: get information, get the administrators, get a member, leave, set the title, set the description
- **Callback and inline query**: answer
- **File**: get a file, and download it to binary data

Messages can have inline keyboards and reply keyboards. Files can come from a URL, a `file_id`, or binary data of the input.

### Telegram Trigger (`trigger.telegram`)

Starts a run on a bot update, for example a message, a callback query, or an inline query. You can accept updates only from some chats or users. The trigger sets the webhook of the bot, so Telegram must be able to reach your zerodot instance. A bot has one webhook only.

## Credential

**Telegram bot** (`telegram.bot`): `accessToken` from [@BotFather](https://t.me/BotFather), and an optional `baseUrl` for a local Bot API server. The token is secret.

## License

AGPL-3.0-only
