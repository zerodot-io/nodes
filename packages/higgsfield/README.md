# @zerodot/higgsfield

Make images and videos with the Higgsfield API: run any Higgsfield model, wait for the result or check it later, and cancel or delete a request. Use it for AI video, ads, and image steps in a workflow.

## Install

In zerodot, go to **System > Nodes** and install **Higgsfield**.

Manual: install `@zerodot/higgsfield` where the web app and the worker run, and add it to `ZERODOT_NODE_PACKAGES`.

## Nodes

### Higgsfield (`higgsfield.api`)

- **Generate**: send a request to a model and, by default, wait until the files are ready
- **Get**: read the status and the files of a request
- **Cancel**: stop a request that still waits in the queue
- **Delete**: delete the files and the prompt of a finished request

For **Generate**, set **Model** to the path of the model from [Higgsfield Console](https://console.higgsfield.ai), such as `higgsfield-ai/soul/v2/standard`. Put the text in **Prompt**. Put the other fields of the model in **Parameters** as a JSON object, such as `{"aspect_ratio":"16:9"}`. A field in **Parameters** replaces the same field of the node. Each model has its own fields, so read the page of the model in the Higgsfield docs.

By default the node waits for the result. It checks the status with a growing pause (2 to 10 seconds) until the request is `completed`, or until **Wait Timeout**. A request that ends as `failed`, `nsfw`, or `canceled` makes the node fail with the reason. The output is the answer of Higgsfield plus `urls`, a list of the file URLs. Higgsfield keeps the files for seven days, so copy them to your own storage if you need them longer.

For a long video, turn **Wait for the result** off. The node gives the `request_id` at once. Use **Get** later to read the result.

The node sends an `Idempotency-Key` with each Generate. If you leave **Idempotency Key** empty, the node makes a random key for each run, and uses it to repeat a call after a network error, a timeout, a 500, or a 503, so one run never starts two requests. Set your own key if you want a repeated workflow run to give the first request again.

When Higgsfield gives an error, the node fails with the message and a short help text. A full queue (HTTP 429) gives the time to wait from `Retry-After`.

## Credential

**Higgsfield API key** (`higgsfield.account`): `keyId` and `keySecret`, both from [Higgsfield Console](https://console.higgsfield.ai). `keySecret` is secret. The **Test** button asks for a request that does not exist: a "not found" answer means that the key works.

## License

AGPL-3.0-only
