# zerodot-nodes

Official node packages for [zerodot](https://github.com/zerodot-io/zerodot). zerodot ships with the core nodes only. Install the rest when you need them.

## Usage

**Recommended:** in zerodot, go to **System > Nodes** and install the package.

Manual: install the package where the web app and the worker run, and list it:

```sh
ZERODOT_NODE_PACKAGES=@zerodot/redis
```

## Nodes

- [`ai`](packages/ai): text, images, audio, and embeddings from OpenAI, Anthropic, Gemini, and compatible APIs
- [`ai-agent`](packages/ai-agent): an AI agent with ports for a chat model, memory, and tools
- [`discord`](packages/discord): bot messages, webhooks, and slash commands
- [`edit-image`](packages/edit-image): resize, crop, rotate, and convert images
- [`email`](packages/email): send email and react to new mail
- [`feedbackjar`](packages/feedbackjar): posts, comments, votes, and webhook triggers
- [`github`](packages/github): issues, repos, files, and webhook triggers
- [`gmail`](packages/gmail): send, read, and label emails in Gmail
- [`google-calendar`](packages/google-calendar): events, availability, and new-event triggers
- [`google-drive`](packages/google-drive): find, upload, download, and share files
- [`google-sheets`](packages/google-sheets): read and write rows in spreadsheets
- [`higgsfield`](packages/higgsfield): AI image and video generation
- [`linear`](packages/linear): issues, comments, projects, and webhook triggers
- [`mcp`](packages/mcp): call tools on an MCP server
- [`mongodb`](packages/mongodb): documents in MongoDB
- [`mysql`](packages/mysql): queries and rows in MySQL
- [`notion`](packages/notion): pages, databases, blocks, and search
- [`pdf`](packages/pdf): create, read, merge, split, and rotate PDF files
- [`postgres`](packages/postgres): queries, rows, and change triggers for Postgres
- [`redis`](packages/redis): keys, lists, and messages in Redis
- [`s3`](packages/s3): files and buckets in S3 and compatible storage
- [`slack`](packages/slack): messages, channels, files, and Slack events
- [`spreadsheet`](packages/spreadsheet): read and write CSV and XLSX files
- [`ssh`](packages/ssh): remote commands and file transfer over SSH, FTP, and SFTP
- [`stripe`](packages/stripe): customers, payments, subscriptions, and events
- [`telegram`](packages/telegram): send messages and react to bot updates
- [`twilio`](packages/twilio): SMS, WhatsApp, calls, lookups, and message events

## Create your own node

Start from the [create](https://github.com/zerodot-io/create) template:

1. Click **Use this template** on GitHub.
2. Rename `packages/example`, and set `name`, `description`, and `zerodot.label` in its `package.json`. The name must start with `zerodot-`, such as `zerodot-slack` or `@acme/zerodot-slack`.
3. Change the nodes in `src`. Start each node type with your own prefix, such as `acme.slack.send`.
4. Run `pnpm test`, then publish the package to npm.

The template explains the package contract and how to list the package in a registry. The packages in this repository are working examples of triggers, polling, webhooks, and binary data.

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
