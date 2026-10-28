# zerodot-nodes

Official node packages for [zerodot](https://github.com/zerodot-io/zerodot). zerodot ships with the core nodes only. Install the rest when you need them.

| Package             | Nodes                                                                                     |
| ------------------- | ----------------------------------------------------------------------------------------- |
| `@zerodot/redis`    | `redis.database`, `trigger.redis`, `redis` credential                                     |
| `@zerodot/postgres` | `postgres.database`, `trigger.postgres`, `trigger.postgres_listen`, `postgres` credential |
| `@zerodot/mysql`    | `mysql.database`, `mysql` credential                                                      |

## Use a package

Install the package where the web app and the worker run, and list it:

```sh
ZERODOT_NODE_PACKAGES=@zerodot/redis
```

## Write a package

One folder in `packages/`. The `package.json` has:

- `"zerodot": { "sdk": "^1.0" }`: the node contract versions it works with. zerodot checks this before it runs the code.
- `peerDependencies` on `@zerodot/node-sdk` and `zod`. zerodot gives both.
- `files` with `dist` and every icon file.

The code exports `nodes` (a list from `defineNode`) and `credentialTypes`. An icon is a file in the package. Read it with `fileIcon(import.meta.url, "../icon.svg")` and set `iconUrl`. A credential type can have `test()` for the Test button.

```sh
pnpm install
pnpm run check-types && pnpm test && pnpm run build
```
