# @zerodot/postgres

Run SQL queries on a Postgres database, or insert, update, select, and delete rows. Start a workflow when a new row appears or when Postgres sends a notification. Use it to read and write your app data.

## Install

In zerodot, go to **System > Nodes** and install **Postgres**.

Manual: install `@zerodot/postgres` where the web app and the worker run, and add it to `ZERODOT_NODE_PACKAGES`.

## Nodes

### Postgres (`postgres.database`)

- Execute a SQL query, with query parameters
- Select rows from a table, with conditions and sort rules
- Insert rows in a table
- Insert or update rows in a table
- Update rows in a table
- Delete a table or rows (truncate, delete rows, or drop the table)

### On new Postgres row (`trigger.postgres`)

Checks a table on a timer (15 seconds to 1 day) and starts a run for each new row. A tracking column (default `id`) tells which rows are new.

### On Postgres event (`trigger.postgres_listen`)

Starts a run at once when a row is added, changed, or removed. It uses `LISTEN` and `NOTIFY`.

### Postgres Chat Memory (`postgres.memory`)

Keeps the conversation of an AI Agent (`@zerodot/ai-agent`) in a table. Connect it to the **Memory** port of the agent. Each run of the agent adds one row, and the agent reads the last turns of the session. The node makes the table (default `public.zerodot_chat_memory`) when it is not there. It can delete the turns that are older than the turns to remember. The Chat Memory Manager can read, add, and delete its messages.

## Credential

**Postgres** (`postgres`): `host`, `port`, `database`, `user`, `password`, `ssl` (`allow`, `disable`, or `require`), `allowUnauthorizedCerts`. The password is secret.

## License

AGPL-3.0-only
