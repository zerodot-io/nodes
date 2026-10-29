# @zerodot/anthropic

Ask Claude models, count tokens, and list models with Anthropic. Send a system prompt, text, and images. Get text or JSON back. Use it to add AI steps to a workflow.

## Install

In zerodot, go to **System > Nodes** and install **Anthropic**.

Manual: install `@zerodot/anthropic` where the web app and the worker run, and add it to `ZERODOT_NODE_PACKAGES`.

## Nodes

### Anthropic (`anthropic.api`)

- **Message**: create (ask Claude), count tokens
- **File**: upload, get, list, delete (the Anthropic Files API)
- **Model**: list the models that your account can use

For **Create**, set the model, an optional system prompt, and the prompt. You can add images as public URLs or as one Base64 image. Set **Max Tokens** to limit the answer. The output has `text` (all text of the answer) and the full API answer, such as `usage` and `stop_reason`.

To read an image, set **Image URLs**, **Image File IDs**, or **Image (Base64)**. To read a PDF, set **PDF URLs**, **PDF (Base64)**, or **Document File IDs**. Claude reads the text and the pictures of a PDF. A document file ID can also be a plain text file. **Effort** sets how much work Claude does.

To use a file many times, use **File** > **Upload** with the file as Base64 text and a name. Use the returned `id` in a message. A file can expire after 3600 seconds to 90 days. All keys of a workspace can use all files of that workspace, so do not take file IDs from untrusted sources. The node does not fetch a file from a URL, to keep the worker safe. Use a download step before it.

For JSON, set **JSON Schema**. Claude answers with JSON that fits the schema, and the output has it in `json`.

**Count Tokens** takes the same model, system prompt, prompt, and images. It returns `input_tokens` and does not make an answer.

The model list is: Claude Fable 5.1 (`claude-fable-5-1`), Claude Opus 5.5 (`claude-opus-5-5`), Claude Sonnet 5.5 (`claude-sonnet-5-5`), and Claude Haiku 5.5 (`claude-haiku-5-5`). It was checked on 2026-10-29. For any other model, choose **Custom ID** and type the ID. Use the **Model** list operation to see the IDs. A node cannot load this list into the editor.

The node sends API version `2026-10-21`. This version has no `temperature`, `top_p`, or `top_k`, so the node has no field for them. A list can return all items (at most 5000) or a limit. When Anthropic gives an error, the node fails with the message, the error type, the request ID, and a short help text. A rate limit (HTTP 429) gives the time to wait from `Retry-After`.

## Credential

**Anthropic API key** (`anthropic.apiKey`): `apiKey` from the Anthropic Console, and an optional `baseUrl` for a proxy or a gateway. `apiKey` is secret. The **Test** button reads one model.

## License

AGPL-3.0-only
