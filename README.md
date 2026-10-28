# zerodot-nodes

Official node packages for [zerodot](https://github.com/zerodot-io/zerodot). zerodot ships with the core nodes only. Install the rest when you need them.

`redis` · `postgres` · `mysql` · `mongodb` · `email` · `ssh` · `s3` · `edit-image` · `mcp` · `telegram` · `github`

## Use

**Recommended:** in zerodot, go to **System > Nodes** and install the package.

Manual: install the package where the web app and the worker run, and list it:

```sh
ZERODOT_NODE_PACKAGES=@zerodot/redis
```

## Develop

```sh
pnpm install
pnpm run check-types && pnpm test && pnpm run build
```

## Verified community packages

`verified.json` lists versions of community packages that the zerodot team reviewed. zerodot reads it from this repository. A version in the list shows a "Verified" badge, and an instance with `ZERODOT_UNVERIFIED_NODES=false` installs only versions in the list.

```json
{
  "packages": [
    {
      "name": "@acme/zerodot-slack",
      "version": "1.2.0",
      "integrity": "sha512-...",
      "source": "https://github.com/acme/zerodot-slack/tree/v1.2.0"
    }
  ]
}
```

A version matches only when the name, the version, and the npm checksum (`integrity`) are all the same.

To ask for a review, open an issue with the package name, the version, the checksum from its `registry.json`, and the address of the source at that version. The reviewer:

1. Reads the source at that tag: what the nodes send, to which hosts, and what the dependencies are.
2. Builds the package from the source and checks that the files are the files on npm (`npm pack` of the version, then compare).
3. Checks that `integrity` is the one that npm has for the version (`npm view <name>@<version> dist.integrity`).
4. Adds the entry in a pull request.

Each new version needs a new review. A version that turns out to be bad is removed from the list.
