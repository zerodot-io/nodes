# @zerodot/ai-agent

An AI agent with ports for a chat model, memory, and tools. Chat models of OpenAI, Anthropic, Google Gemini, or any OpenAI-compatible endpoint. Memory in a data table. Other workflows, MCP servers, JavaScript, and HTTP requests as tools. Needs zerodot with node SDK 1.4.

## Install

In zerodot, go to **System > Nodes** and install **AI Agent**.

Manual: install `@zerodot/ai-agent` where the web app and the worker run, and add it to `ZERODOT_NODE_PACKAGES`.

## Nodes

The agent has ports at the bottom, and small supply nodes connect to them. A supply node is not a step. zerodot builds its value each time the agent runs, with the input of the agent, so a field such as `{{ $input.chatId }}` reads the agent input.

### AI Agent (`agent.run`)

The agent sends the prompt to the model. When the model calls tools, the agent runs them, gives the results to the model, and asks again. It stops when the model answers without a tool call, or after **Max Model Calls** (default 10).

Ports:

- **Chat Model** (required): one chat model node.
- **Memory**: one memory node. Without it, each run starts a new conversation.
- **Tool**: any number of tool nodes.

**Previous Messages** takes the `history` of an earlier run, such as `{{ $input.history }}`. It replaces the memory as the earlier messages.

At most 3 tools run at the same time. A tool that fails gives its error to the model, which can try again. A tool result longer than **Max Tool Result Length** is cut. The whole run has the time limit of the workflow, and workflow tools count toward it.

The output:

```json
{
  "output": "The final answer",
  "finishReason": "stop",
  "steps": [{ "tool": "find_customer", "input": {}, "result": "...", "error": false }],
  "history": [],
  "usage": { "inputTokens": 0, "outputTokens": 0 }
}
```

`finishReason` is `stop`, `length`, `content_filter`, `other`, or `max_iterations`.

### Chat Memory Manager (`agent.memory.manage`)

A normal step with a **Memory** port (required). It works on the memory of a conversation outside the agent, for example to clear a chat on `/reset`, or to add context as if the user said it. The Session ID of the memory node reads the input of this node.

- **Get Messages**: all messages of the session, or only the turns that the agent reads.
- **Insert Messages**: add User or AI messages, or replace all messages of the session.
- **Delete Messages**: the last N messages, or all. A tool call never stays without its result: when the cut separates them, the tool call goes too.

The output is `{ messages }`: the messages of the session after the operation. **Simplify Output** (on by default) keeps only `role` and `content`.

### Chat models

`agent.model.openai`, `agent.model.anthropic`, `agent.model.gemini`, and `agent.model.compatible`. Each one has the credential of its provider, the model, Max Tokens, Temperature (not for Anthropic), and a timeout for each call. The model must support tool calls.

### Data Table Memory (`agent.memory.table`)

The table needs the text columns `sessionId` and `messages`. Each run adds one row. The agent reads the last **Turns to Remember** rows of the session. A table holds a limited number of rows, so turn on **Delete Older Turns** for a busy session.

### Workflow Tool (`agent.tool.workflow`)

Runs another workflow of the project and waits for it. The input from the model is the trigger input. The output of the last node that finished is the result, so end the workflow with one last node. The nodes of the workflow use their own credentials. The workflow must be published (a test run uses the draft), and it cannot wait (no Wait or form nodes).

### MCP Client Tool (`agent.tool.mcp`)

Gives the tools of a Streamable HTTP MCP server to the agent. The credential is optional: `http.bearer`, `http.header`, or `http.basic`. Use **Tool Name Prefix** when two servers have a tool with the same name.

### Code Tool (`agent.tool.code`)

Runs your JavaScript as a tool, in the code sandbox of zerodot. The code is the body of an async function. The input from the model is in `input`, and the scope of the agent (`$input`, `$vars`, and others) is there too. The return value is the result. The worker needs a sandbox (`SANDBOX_URL`).

### HTTP Request Tool (`agent.tool.http`)

Sends one HTTP request. Put `{name}` in the URL or the JSON body where the model gives a value. A value in the URL is encoded, and a value in the body goes in as JSON, so `{"email": {email}}` gets quotes for text. Describe each placeholder and set its type (string, number, boolean, or json) in **Placeholders**. The credential is optional: `http.bearer`, `http.header`, or `http.basic`. An error status gives the model the status and the start of the body.

Supply nodes and supply ports work only in official `@zerodot/*` packages, so this package must keep its name.

## Credential

The chat models use the same credential types as `@zerodot/ai`: `ai.openai`, `ai.anthropic`, `ai.gemini`, and `ai.compatible`. A key saved for one package works in the other.

## License

AGPL-3.0-only
