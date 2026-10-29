# @zerodot/notion

Search a Notion workspace. Read and write pages, databases, and blocks. Use it to keep notes, tasks, and records the same in other tools.

## Install

In zerodot, go to **System > Nodes** and install **Notion**.

Manual: install `@zerodot/notion` where the web app and the worker run, and add it to `ZERODOT_NODE_PACKAGES`.

## Nodes

### Notion (`notion.api`)

- **Search**: find pages and data sources by title
- **Page**: get, create (below a page, with a title and optional blocks), update the properties, archive
- **Database**: get a database, list the data sources, get a data source (with the type of each property), query a data source (JSON filter, time filters, sort), create a row
- **Block**: get a block, get the children of a page or block, append blocks, delete a block
- **User**: get a user, list the users of the workspace

The node uses the Notion API version `2026-03-11`. In this version, a database holds one or more data sources. To query a database or add a row, use the ID of a data source. **Get** on a database shows the data sources and their IDs.

Simplify is on by default. It gives the main values: the text of a title, the name of a select, the email of a person. Turn it off to get the raw Notion data.

To add content, choose a **Block Type** and write the **Text**. It makes one block (paragraph, heading, list item, to-do, toggle, quote, callout, code, or divider). For more blocks, use **Content Blocks (JSON)**. It replaces the Text.

Filters, sorts, properties, and blocks are JSON. Use the formats from the Notion API reference. A list can return all items (at most 5000) or a limit. **Archive** and **Delete** move the item to the Notion trash. When Notion gives an error, the node fails with the message, the error code, and a short help text. A rate limit (HTTP 429) gives the time to wait from `Retry-After`.

The integration can see only the pages that you share with it. In Notion, open the page, choose **Connections**, and add the integration.

### Notion Trigger (`trigger.notion`)

Checks a data source on a timer (default 60 seconds) and starts a run for each page:

- **Page Added**: a new row in the data source
- **Page Updated**: a row changed (a new row also counts)

The first check only marks the time, so the rows that exist then start no runs. Notion keeps times with an accuracy of one minute. A row can come twice from the same minute, but the trigger starts one run for it.

## Credential

**Notion integration** (`notion.integration`): `token`, the integration token from notion.so/profile/integrations. `token` is secret. The **Test** button reads the bot user of the token.

## License

AGPL-3.0-only
