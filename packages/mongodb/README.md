# @zerodot/mongodb

Find, insert, update, delete, and aggregate documents in a MongoDB collection. Use it to read and write the data of your app in MongoDB.

## Install

In zerodot, go to **System > Nodes** and install **MongoDB**.

Manual: install `@zerodot/mongodb` where the web app and the worker run, and add it to `ZERODOT_NODE_PACKAGES`.

## Nodes

### MongoDB (`mongodb.documents`)

- Find documents, with a query, sort, projection, limit, and skip
- Insert documents
- Update documents
- Delete documents
- Aggregate documents with a pipeline
- Find and update a document
- Find and replace a document

Queries, updates, and pipelines are JSON, for example `{"$set": {"status": "done"}}`.

## Credential

**MongoDB** (`mongodb`): `connectionString` (`mongodb://` or `mongodb+srv://`) and `database`. The connection string is secret.

## License

AGPL-3.0-only
