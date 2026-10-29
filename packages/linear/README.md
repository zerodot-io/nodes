# @zerodot/linear

Work with issues, comments, projects, teams, and cycles in Linear, and start a workflow on an event, such as a new issue or comment. Use it to automate your product work.

## Install

In zerodot, go to **System > Nodes** and install **Linear**.

Manual: install `@zerodot/linear` where the web app and the worker run, and add it to `ZERODOT_NODE_PACKAGES`.

## Nodes

### Linear (`linear.api`)

The node uses the Linear GraphQL API (`https://api.linear.app/graphql`).

- **Issue**: create, get, get many, update, archive, delete
- **Comment**: create, get many (of one issue)
- **Project**: create, get, get many
- **Team**: get many
- **Workflow State**: get many (can filter by team)
- **Label**: get many (can filter by team)
- **User**: get many
- **Cycle**: get many (can filter by team)

An issue can be set by its ID or by its identifier, for example `ENG-123`.

A list operation has **Return All** and **Limit**. The node follows the cursors of Linear until it has enough items. The most it returns is 5000 items.

To filter issues, use the fields (team, assignee, state, project, priority, title text). For other filters, put a JSON object in **Filter**. It follows the Linear `IssueFilter` and adds to the fields.

**Delete** moves an issue to the trash. Turn on **Permanent** to delete it for good. **Archive** keeps the issue, and you can restore it.

### Linear Trigger (`trigger.linear`)

Starts a run on an event in Linear for issues, comments, projects, cycles, or labels. You can keep only some actions (create, update, remove). The trigger makes a webhook in Linear and removes it when you turn off the workflow. Linear must be able to reach your zerodot instance.

- If **Team ID** is empty, the webhook covers all public teams.
- The trigger checks the `Linear-Signature` header (HMAC-SHA256 of the raw body). It rejects a request with a bad signature, or with a `webhookTimestamp` older than 1 minute.
- To make a webhook, the credential needs admin rights. An API key of an admin works. For OAuth2, add the `admin` scope.

The output is `{ event, action, delivery, body }`. `body` is the payload from Linear.

## Credentials

- **Linear API key** (`linear.apiKey`): `apiKey`. Make a key in Linear at **Settings > Account > Security & access**. The key is secret.
- **Linear OAuth2** (`linear.oauth2`): `clientId`, `clientSecret`, and `scope` (default `read write`). The client secret and the tokens are secret.

## License

AGPL-3.0-only
