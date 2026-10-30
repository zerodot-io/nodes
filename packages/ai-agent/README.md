# @zerodot/ai-agent

An AI agent that calls tools until it has an answer. It uses OpenAI, Anthropic, Google Gemini, or any OpenAI-compatible endpoint, runs other workflows and MCP tools as its tools, and keeps chat memory in a data table.

## Install

In zerodot, go to **System > Nodes** and install **AI Agent**.

Manual: install `@zerodot/ai-agent` where the web app and the worker run, and add it to `ZERODOT_NODE_PACKAGES`.

## Nodes

### AI Agent (`agent.run`)

The agent sends the prompt to the model. When the model calls tools, the agent runs them, gives the results to the model, and asks again. It stops when the model answers without a tool call, or after **Max Model Calls** (default 10).

- **Model**: the provider, the model, and optional Max Tokens and Temperature. The model must support tool calls.
- **Tools**:
  - **Workflow**: runs another workflow of the project and waits for it. The input from the model is the trigger input. The output of the last node that finished is the result, so end the workflow with one last node. The nodes of the workflow use their own credentials. The workflow must be published (a test run uses the draft), and it cannot wait (no Wait or form nodes).
  - **MCP Server**: a Streamable HTTP server. The agent lists its tools and gives them to the model as `<name>__<tool>`. Put a secret header value in a variable, such as `{{ $vars.DOCS_TOKEN }}`.
- **Memory**:
  - **None**: each run starts a new conversation.
  - **Data Table**: the table needs the text columns `sessionId` and `messages`. Each run adds one row. The agent reads the last **Turns to Remember** rows of the session. A table holds a limited number of rows, so turn on **Delete Older Turns** for a busy session.
- **Previous Messages**: the `history` of an earlier run, such as `{{ $input.history }}`. It replaces the memory as the earlier messages.

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

Only official `@zerodot/*` packages can run workflows and use data tables, so this package must keep its name.

## Credential

The same credential types as `@zerodot/ai`: `ai.openai`, `ai.anthropic`, `ai.gemini`, and `ai.compatible`. A key saved for one package works in the other.

## License

AGPL-3.0-only
