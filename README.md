# zerodot-nodes

Official node packages for [zerodot](https://github.com/zerodot-io/zerodot). zerodot ships with the core nodes only. Install the rest when you need them.

`redis` · `postgres` · `mysql` · `mongodb` · `email` · `ssh` · `s3` · `edit-image` · `mcp` · `telegram` · `github`

## Use

Install the package where the web app and the worker run, and list it:

```sh
ZERODOT_NODE_PACKAGES=@zerodot/redis
```

## Develop

```sh
pnpm install
pnpm run check-types && pnpm test && pnpm run build
```
