# @zerodot/mcp

Call a tool on an MCP server over Streamable HTTP, and use the result in your workflow. Use it to connect to any service that has an MCP server.

## Install

In zerodot, go to **System > Nodes** and install **MCP Call Tool**.

Manual: install `@zerodot/mcp` where the web app and the worker run, and add it to `ZERODOT_NODE_PACKAGES`.

## Nodes

### MCP Call Tool (`mcp.call_tool`)

Calls one tool on an MCP server. Set the server URL, the tool name, and the arguments. The editor makes the form from the JSON Schema of the tool. The result of the tool is the output. When the tool reports an error, the node fails.

Only Streamable HTTP servers. No stdio servers.

## Credential

Optional. Use a built-in HTTP credential: `http.bearer`, `http.header`, or `http.basic`.

## License

AGPL-3.0-only
