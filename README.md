# zerodot-nodes

Official node packages for [zerodot](https://github.com/zerodot-io/zerodot). zerodot ships with the core nodes only. Install the rest when you need them.

| Package               | Nodes                                                                                     |
| --------------------- | ----------------------------------------------------------------------------------------- |
| `@zerodot/redis`      | `redis.database`, `trigger.redis`, `redis` credential                                     |
| `@zerodot/postgres`   | `postgres.database`, `trigger.postgres`, `trigger.postgres_listen`, `postgres` credential |
| `@zerodot/mysql`      | `mysql.database`, `mysql` credential                                                      |
| `@zerodot/mongodb`    | `mongodb.documents`, `mongodb` credential                                                 |
| `@zerodot/email`      | `email.send`, `trigger.email_imap`, `smtp` and `imap` credentials                         |
| `@zerodot/ssh`        | `ssh.execute`, `ftp.files`, `sftp.files`, `ssh` and `ftp` credentials                     |
| `@zerodot/s3`         | `s3.storage`, `s3` credential                                                             |
| `@zerodot/edit-image` | `file.edit_image`                                                                         |
| `@zerodot/mcp`        | `mcp.call_tool`                                                                           |
| `@zerodot/telegram`   | `telegram.bot`, `trigger.telegram`, `telegram.bot` credential                             |
| `@zerodot/github`     | `github.api`, `trigger.github`, `github.token` and `github.oauth2` credentials            |

## Use a package

Install the package where the web app and the worker run, and list it:

```sh
ZERODOT_NODE_PACKAGES=@zerodot/redis
```

## Write a package

One folder in `packages/`. The `package.json` has:

- `"zerodot": { "sdk": "^1.0", "label": "…", "summary": "…" }`: the node contract versions it works with, the name, and a short line (under 60 characters) for lists. `description` is the long text: what the package does and what it is for. zerodot checks this before it runs the code.
- `peerDependencies` on `@zerodot/node-sdk` and `zod`. zerodot gives both.
- `files` with `dist` and every icon file.

The code exports `nodes` (a list from `defineNode`) and `credentialTypes`. An icon is a file in the package. Read it with `fileIcon(import.meta.url, "../icon.svg")` and set `iconUrl`. A credential type can have `test()` for the Test button. A trigger with `webhook.activate` can set `webhookTest: { hint }` (SDK 1.2): the editor then registers the test address at the service for a test run, and shows the hint instead of the address.

```sh
pnpm install
pnpm run check-types && pnpm test && pnpm run build
```

## Package notes

### @zerodot/github

`GitHub` has the resources `issue` (create, createComment, edit, get, lock), `repository` (getProfile, getIssues, getPullRequests), `file` (get, list, create, edit), and `release` (create, get, getAll). The names follow the GitHub REST API. A list returns an array, with `limit` items or all items (`returnAll`). `file.get` adds the decoded text of the file as `text`.

`GitHub Trigger` starts a run on events of one repository (`push`, `issues`, `pull_request`, and others, or all). Activate makes the webhook at GitHub. Deactivate removes it. The run input is `{ event, action, delivery, body }`, where `body` is the payload from GitHub. Zerodot checks the `X-Hub-Signature-256` header of each delivery.

- The `Authentication` field of the node says which credential to use. `Access Token` uses a personal access token (`GitHub access token`). `OAuth2` uses the `GitHub OAuth2` credential (see "OAuth2 credentials").
- For GitHub Enterprise Server, set `server` in the credential to its API address, for example `https://ghe.example.com/api/v3`.
- GitHub sends webhook deliveries only to a public HTTPS address. Set `ZERODOT_BASE_URL` to it.
- The token needs the scope `repo` (classic token) or "Webhooks: read and write" and "Issues: read and write" (fine-grained token) to use the webhook, issues, and files. The default OAuth2 scopes are `repo read:user`.

### @zerodot/email, @zerodot/ssh, @zerodot/mongodb

- `On new email (IMAP)` is a trigger. It keeps an IMAP connection in IDLE state and starts one run for each unread mail in the mailbox, oldest first. `Action` can mark the mail as read. `Format` is `simple` (parsed fields), `resolved` (also the attachments as binary data), or `raw` (the whole message as base64). It needs an `IMAP` credential. If the connection closes, the worker starts the trigger again.
- `SSH` runs a command on a server and returns `exitCode`, `stdout`, and `stderr`. `SFTP` and `FTP` list, download, upload, rename, and delete files. SSH and SFTP use an `SSH` credential (password or private key). FTP uses an `FTP` credential (FTPS with `secure`). The server host key is not checked.
- `MongoDB` finds, inserts, updates, deletes, and aggregates documents, and has find-and-update and find-and-replace. Queries are JSON. Extended JSON works for ids and dates, for example `{"_id": {"$oid": "..."}}`. Ids and dates in the result are text. It needs a `MongoDB` credential (connection string and database).

- **Edit Image** (`@zerodot/edit-image`) gets the size of an image, or resizes, crops, rotates, blurs, makes it gray, or converts it to JPEG, PNG, WebP, or AVIF (`sharp`).

### @zerodot/telegram

`Telegram` follows the Bot API: resources `message`, `chat`, `callback`, `file`, with the same operation and parameter names. `Telegram Trigger` receives updates on the webhook route. Publish or activate sets the Telegram webhook. Deactivate, or a publish that removes the trigger or changes its bot, removes it. A bot has one webhook, so one active workflow for each bot.

- Telegram sends updates only to a public HTTPS address. Set `ZERODOT_BASE_URL` to it.
- **Binary data.** zerodot has no binary store. A node puts a file in its output as `binary.<property>` (`data` as base64, `mimeType`, `fileName`). The node output limit (`ZERODOT_MAX_NODE_OUTPUT_BYTES`, 5 MB) is the file size limit, and base64 adds about a third.
- **Send and wait.** `sendAndWait` sends a message with link buttons, and the run stops. A person opens a signed link (`/resume/<run>/<node>`), and the run goes on with the answer as the node output. After `limitWaitTimeHours` (default 168) the run goes on with `{ "data": { "timedOut": true } }`. The worker needs `ZERODOT_BASE_URL` to build the link.
