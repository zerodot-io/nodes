# @zerodot/ai-agent

An AI agent with ports for a chat model, memory, and tools. Chat models of OpenAI, Anthropic, Google Gemini, or any OpenAI-compatible endpoint. Memory in a data table. Other workflows, MCP servers, JavaScript, and vector stores as tools. Embedding models, text splitters, a data loader, and a reranker for vector stores. Needs zerodot with node SDK 1.5.

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

### Embeddings

`agent.embedding.openai`, `agent.embedding.gemini`, and `agent.embedding.compatible` give an embedding model (kind `ai.embedding`) to a vector store. Settings: the model, **Dimensions** (optional, it must be the same as the vector store), and a timeout. Big inputs go to the provider in batches.

### Text splitters

They cut text into chunks (kind `ai.textSplitter`). Connect one to the **Text Splitter** port of the Default Data Loader.

- **Recursive Character Text Splitter** (`agent.splitter.recursive`): keeps paragraphs, then sentences, then words together. **Text Format** is Plain Text, Markdown, HTML, or Code. Default: 1000 characters, 200 overlap.
- **Character Text Splitter** (`agent.splitter.character`): splits at a separator. Write `\n` for a new line.
- **Token Text Splitter** (`agent.splitter.token`): counts tokens (`o200k_base` or `cl100k_base`).

### Default Data Loader (`agent.document.default`)

Makes the chunks for a vector store (kind `ai.document`). **Type of Data** is JSON or Binary. JSON: **Load All Input Data** (one line for each value of the item) or **Load Specific Data** (a text with expressions, such as `{{ $json.body }}`). Binary: PDF, Text, Markdown, HTML, or JSON, or found from the MIME type. **Metadata Fields** and **Extra Metadata** go with each chunk. With no text splitter, it uses the recursive splitter with 1000 characters and 200 overlap.

### Reranker Cohere (`agent.reranker.cohere`)

Orders the chunks of a search by relevance to the query (kind `ai.reranker`). Needs a Cohere API key.

### Vector Store Tool (`agent.tool.vectorStore`)

Lets the agent search a vector store. Connect a store in a retrieve mode, such as **Postgres Vector Store** of `@zerodot/postgres` with **Retrieve Documents (As Vector Store for Chain/Tool)**, to **Vector Store**. To give the store to the agent with no Answer Model, use the store mode **Retrieve Documents (As Tool for AI Agent)**. Settings: Tool Name, Description, Limit, Include Metadata, and Metadata Filter. A reranker is optional. **Answer Model** is optional, and is not the model of the agent. With a chat model there, the tool answers the question from the chunks, and the agent gets only the answer.

### Data Table Memory (`agent.memory.table`)

The table needs the text columns `sessionId` and `messages`. Each run adds one row. The agent reads the last **Turns to Remember** rows of the session. A table holds a limited number of rows, so turn on **Delete Older Turns** for a busy session.

### Workflow Tool (`agent.tool.workflow`)

Runs another workflow of the project and waits for it. The input from the model is the trigger input. The output of the last node that finished is the result, so end the workflow with one last node. The nodes of the workflow use their own credentials. The workflow must be published (a test run uses the draft), and it cannot wait (no Wait or form nodes).

### MCP Client Tool (`agent.tool.mcp`)

Gives the tools of a Streamable HTTP MCP server to the agent. The credential is optional: `http.bearer`, `http.header`, or `http.basic`. **Tools to Include** is All, Selected, or All Except. Use **Tool Name Prefix** when two servers have a tool with the same name.

### Code Tool (`agent.tool.code`)

Runs your JavaScript as a tool, in the code sandbox of zerodot. The code is the body of an async function. The input from the model is in `input`, and the scope of the agent (`$input`, `$vars`, and others) is there too. The return value is the result. The worker needs a sandbox (`SANDBOX_URL`).

Supply nodes and supply ports work only in official `@zerodot/*` packages, so this package must keep its name.

## Credential

The chat models and the embedding models use the same credential types as `@zerodot/ai`: `ai.openai`, `ai.anthropic`, `ai.gemini`, and `ai.compatible`. A key saved for one package works in the other.

**Cohere API key** (`cohere`): `apiKey`, and an optional `baseUrl`. The key is secret.

## License

AGPL-3.0-only
