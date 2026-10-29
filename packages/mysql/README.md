# @zerodot/mysql

Run SQL queries on a MySQL database, or insert, update, select, and delete rows. Use it to read and write the data of your app in MySQL.

## Install

In zerodot, go to **System > Nodes** and install **MySQL**.

Manual: install `@zerodot/mysql` where the web app and the worker run, and add it to `ZERODOT_NODE_PACKAGES`.

## Nodes

### MySQL (`mysql.database`)

- Execute a SQL query, with query parameters
- Select rows from a table, with conditions and sort rules
- Insert rows in a table
- Insert or update rows in a table
- Update rows in a table
- Delete a table or rows (truncate, delete rows, or drop the table)

## Credential

**MySQL** (`mysql`): `host`, `port`, `database`, `user`, `password`, `ssl`, `allowUnauthorizedCerts`. The password is secret.

## License

AGPL-3.0-only
