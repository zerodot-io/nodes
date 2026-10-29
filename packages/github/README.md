# @zerodot/github

Work with issues, repositories, files, and releases on GitHub, and start a workflow on an event in a repository, such as a push or a new issue. Use it to automate your development work.

## Install

In zerodot, go to **System > Nodes** and install **GitHub**.

Manual: install `@zerodot/github` where the web app and the worker run, and add it to `ZERODOT_NODE_PACKAGES`.

## Nodes

### GitHub (`github.api`)

- **Issue**: create, comment, edit, get, lock
- **Repository**: get, get issues, get pull requests, get the community profile
- **File**: create, edit, delete, get, list
- **Release**: create, update, delete, get, get many
- **Workflow**: list, dispatch

### GitHub Trigger (`trigger.github`)

Starts a run on an event in a repository, for example push, issues, pull request, or release. The trigger makes a webhook in the repository and removes it when you turn off the workflow. GitHub must be able to reach your zerodot instance.

## Credentials

- **GitHub access token** (`github.token`): `accessToken` and an optional `server` for GitHub Enterprise. The token is secret.
- **GitHub OAuth2** (`github.oauth2`): `clientId`, `clientSecret`, an optional `server`, and `scope` (default `repo read:user`). The client secret and the tokens are secret.

## License

AGPL-3.0-only
