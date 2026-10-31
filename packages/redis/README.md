# @zerodot/redis

Work with a Redis database: get, set, and delete keys, use lists and counters, and publish messages. Start a workflow when a message arrives on a channel. Use it for caches, counters, and simple queues.

## Install

In zerodot, go to **System > Nodes** and install **Redis**.

Manual: install `@zerodot/redis` where the web app and the worker run, and add it to `ZERODOT_NODE_PACKAGES`.

## Nodes

### Redis (`redis.database`)

- Get, set, and delete a key (string, hash, list, set, or sorted set), with an optional time to live
- Return all the keys that match a pattern (`*` and `?`)
- Increment a key
- Push, pop, and get the length of a list
- Publish data to a channel
- Return information about the server

### On Redis message (`trigger.redis`)

Starts a run when a message arrives on one or more channels. It can read the message as JSON, and it can return only the message without the channel name.

### Redis Chat Memory (`redis.memory`)

Keeps the conversation of an AI Agent (`@zerodot/ai-agent`) in a Redis list. Connect it to the **Memory** port of the agent. The key is the session ID, and each run of the agent adds one item. The agent reads the last turns of the session. The node can delete the turns that are older than the turns to remember, and it can set a time to live for the session. The Chat Memory Manager can read, add, and delete its messages.

## Credential

**Redis** (`redis`): `host`, `port`, `user`, `password`, `database`, `ssl`. Empty fields mean port 6379, database 0, and no TLS. The password is secret.

## License

AGPL-3.0-only
