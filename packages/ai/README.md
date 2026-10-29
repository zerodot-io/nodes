# @zerodot/ai

Generate text, embeddings, images, and audio with OpenAI, Anthropic, Google Gemini, or any OpenAI-compatible service, in one node. Use it to add AI steps to a workflow.

## Install

In zerodot, go to **System > Nodes** and install **AI**.

Manual: install `@zerodot/ai` where the web app and the worker run, and add it to `ZERODOT_NODE_PACKAGES`.

## Nodes

### AI (`ai.api`)

Choose a **Provider**. The provider decides which fields and operations the node shows. The **Model** list shows only the models of that provider. Choose **Custom** to type any model ID.

| Operation                                                                   | OpenAI | Anthropic     | Gemini        | Compatible |
| --------------------------------------------------------------------------- | ------ | ------------- | ------------- | ---------- |
| Text: generate (system prompt, max tokens, JSON schema, image input, tools) | yes    | yes           | yes           | yes        |
| Text: count tokens                                                          | -      | yes           | yes           | -          |
| Embedding: create                                                           | yes    | -             | yes           | yes        |
| Image: generate, edit                                                       | yes    | -             | yes           | -          |
| Moderation, audio (transcribe, translate, speak)                            | yes    | -             | -             | -          |
| File: upload, list, delete                                                  | yes    | yes (and get) | yes (and get) | -          |
| Conversation and conversation item                                          | yes    | -             | -             | -          |
| Model: list                                                                 | yes    | yes           | yes           | yes        |

Provider notes:

- **OpenAI**: models `gpt-6-astra`, `gpt-6.1-sol`, `gpt-6.1-terra`, `gpt-6-luna`, `gpt-5.5`, `gpt-5.4-mini`. Embeddings, image, moderation, audio, and file models have their own lists.
- **Anthropic**: models `claude-fable-5-1`, `claude-opus-5-5`, `claude-sonnet-5-5`, `claude-haiku-5-5`. The node can read PDF files and uploaded file IDs, set the **Effort**, and continue after a tool call with **Previous Answer Content** and **Tool Results**. The API version 2026-10-21 has no `temperature`, so the node does not show it. Some models answer 400 to the tool choices **Any Tool** and **One Tool**.
- **Gemini**: models `gemini-4-argon`, `gemini-3.8-flash`, `gemini-3.6-flash`, `gemini-3.5-flash-lite`, `gemini-3.1-flash-lite`, `gemini-3.1-pro-preview`. Embeddings `gemini-embedding-2` and `gemini-embedding-001`. Image models `gemini-nano-banana-2.1`, `gemini-3.1-flash-image`, `gemini-3.1-flash-lite-image`, `gemini-3-pro-image`. Gemini reads images from data URLs, from the binary field, and from File URIs. Use **File Upload** to get a `uri`, and put it in **File URIs** to send a PDF or other media.
- **OpenAI-compatible**: type the model ID in **Custom Model ID**. The node uses `/chat/completions`, `/embeddings`, and `/models`.

Output of **Text: generate**, the same for all providers: `text`, `json` (when the format is JSON), `toolCalls` (`id`, `name`, `input`), `finishReason` (`stop`, `length`, `tool_calls`, `content_filter`, or `other`), `stopReason` (the value of the provider), `usage` (`inputTokens`, `outputTokens`, `totalTokens`), `model`, and `id`. Turn on **Include Raw Answer** to add the full answer as `raw`. Anthropic adds `assistantContent`, to continue after a tool call.

Tools are a JSON array. Each tool has `name`, `description`, and `input_schema` (a JSON Schema with type `object`). The node changes the format for each provider. A tool choice other than **Auto** needs tools.

A list can return all items (at most 5000) or a limit. Lists of URLs and IDs have one value on each line. When a provider gives an error, the node fails with the message, the error code, and a short help text. A rate limit (HTTP 429) gives the time to wait from `Retry-After`.

## Credentials

The node uses the credential that matches the **Provider**.

- **OpenAI API** (`ai.openai`): `apiKey`, and optional `organization`, `project`, and `baseUrl`.
- **Anthropic API key** (`ai.anthropic`): `apiKey`, and optional `baseUrl`.
- **Google Gemini API key** (`ai.gemini`): `apiKey` from Google AI Studio, and optional `baseUrl`.
- **OpenAI-compatible service** (`ai.compatible`): `baseUrl` up to the version, and an optional `apiKey`.

A `baseUrl` must start with `https://`. Plain `http://` works only for `localhost`, `127.0.0.1`, and `[::1]`. The keys are secret. The **Test** button reads one model.

## License

AGPL-3.0-only
