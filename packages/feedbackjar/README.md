# @zerodot/feedbackjar

Manage feedback posts, comments, votes, boards, and tags in FeedbackJar, and start a workflow when a post or comment changes. Use it to move user feedback into your other tools.

## Install

In zerodot, go to **System > Nodes** and install **FeedbackJar**.

Manual: install `@zerodot/feedbackjar` where the web app and the worker run, and add it to `ZERODOT_NODE_PACKAGES`.

## Nodes

### FeedbackJar (`feedbackjar.api`)

- **Organization**: get many (projects of an account token)
- **Board**: get many, get
- **Tag**: get many
- **Post**: create, get, get many, search, update, update status, set tags, merge
- **Comment**: get many, create (reply to a post)
- **Vote**: create (vote for a person)

Notes:

- **Get many** posts uses the cursor of the API. Turn on **Return All** to get all pages. The limit is 5000 items.
- **Create** a post can use **On Behalf Of**. FeedbackJar then files the post as that person and adds the person as a member if needed. This needs an owner or admin.
- **Merge** moves the votes of the duplicate post (**Post ID**) to the **Target Post ID**.
- **Set Tags** replaces all tags of a post. Use **Get Many** on **Tag** to find the tag IDs.
- **Vote** gives a 409 error if the person voted already. It gives a 400 error if the post is merged.
- The API allows 120 calls each minute for each token.

### FeedbackJar Trigger (`trigger.feedbackjar`)

Starts a run when FeedbackJar sends a webhook. Events: post created, post status changed, comment created (public comments only), member added or removed, tag created or deleted, board created or deleted.

The run input is `{ event, createdAt, data }`. The `data` field depends on the event. For example, `post.created` has `postId`, `title`, `status`, and `boardId`.

When the workflow is active, the trigger makes the webhook at FeedbackJar. It keeps the signing secret and checks each request with it. It removes the webhook when the workflow stops. The credential token needs permission to manage webhooks, and the webhook address must use HTTPS and be reachable from the internet.

To use a webhook that you made by hand in **Settings > Webhooks**, put its signing secret in the **Webhook Signing Secret** field of the credential.

The trigger refuses a request with a wrong signature or a timestamp older than 5 minutes. If a webhook has no signature, the trigger does not check it.

## Credentials

- **FeedbackJar API token** (`feedbackjar.token`):
  - `apiToken`: a project token (`fj_live_`) or an account token (`fj_user_`). Secret. Make it in **Settings > API Tokens**.
  - `organizationId`: the project ID. Needed for an account token. Empty for a project token.
  - `signingSecret`: the webhook secret, for the trigger only. Secret.
  - `server`: the API address. Empty means `https://api.feedbackjar.com/api/v1`.

A token needs the scopes for the operations that you use, for example `posts:read`, `posts:write`, `comments:write`, `boards:read`, and `tags:read`.

## License

AGPL-3.0-only
