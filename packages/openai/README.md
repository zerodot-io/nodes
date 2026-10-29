# @zerodot/openai

Write text, make embeddings and images, check content, change images, turn speech into text and text into speech, and manage files with OpenAI. Use it to add AI steps to a workflow.

## Install

In zerodot, go to **System > Nodes** and install **OpenAI**.

Manual: install `@zerodot/openai` where the web app and the worker run, and add it to `ZERODOT_NODE_PACKAGES`.

## Nodes

### OpenAI (`openai.api`)

- **Text**: generate text with a chat model. Set a system prompt, a temperature, and a limit for output tokens. Use JSON mode or a JSON Schema to get a JSON answer. Add images as URLs or from a binary field
- **Embedding**: turn a text into a vector. You can set a shorter size
- **Image**: generate an image from a prompt, or edit an image from a binary field
- **Moderation**: check a text or images for harmful content
- **Audio**: transcribe a file, translate a file to English, or turn a text into speech
- **File**: upload, list, or delete files of the account
- **Model**: list the models that the key can use. You can filter by name

Each operation that makes or reads a file uses binary fields. A file goes in from `binary.<property>` of the input. A new image or a speech file goes out in `binary.<property>` of the output. If you make more than one image, the fields are `<property>_1`, `<property>_2`, and so on.

The text operation uses the Chat Completions API. It sends `temperature` and `max_completion_tokens` only when you set them, because some models do not accept them. The output has `text`, `json` (in JSON modes), `finishReason`, `model`, and `usage`.

When OpenAI gives an error, the node fails with the message, the error code, and a short help text. A rate limit (HTTP 429) gives the time to wait from `Retry-After`.

### Models

Each operation has a **Model** list with the current models from the OpenAI model docs (checked on 2026-10-29). The list is in `src/models.ts`. To use another model, choose **Custom** and type the model id in **Custom Model**. Use the **Model > List** operation to see the ids that your key can use.

## Credential

**OpenAI API** (`openai.api`):

- `apiKey`: from the API keys page of the OpenAI platform. It is secret
- `organization` and `project`: optional. They set which organization and project get the bill
- `baseUrl`: optional. Use it for a service that is compatible with OpenAI. The default is `https://api.openai.com/v1`

The **Test** button reads the model list.

## License

AGPL-3.0-only
