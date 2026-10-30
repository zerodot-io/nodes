// SPDX-License-Identifier: AGPL-3.0-only
import { defineNode, readBinary } from "@zerodot/node-sdk";
import {
  type CallOptions,
  callSlack,
  callSlackList,
  SLACK_CREDENTIAL,
  type SlackAccess,
  slackAccess,
  uploadSlackFile,
} from "./api";
import { type SlackConfig, slackConfig } from "./config";
import { SLACK_ICON } from "./icon";
import { buildRequest } from "./request";

/** Slack has a limit of 1 GB for each file. */
const MAX_UPLOAD_BYTES = 1024 * 1024 * 1024;

async function upload(
  access: SlackAccess,
  config: SlackConfig,
  input: unknown,
  options: CallOptions,
) {
  let bytes: Uint8Array;
  let fileName = config.fileName?.trim();
  if (config.binaryData) {
    const file = readBinary(input, config.binaryPropertyName);
    bytes = Buffer.from(file.data, "base64");
    fileName ||= file.fileName;
  } else {
    if (!config.fileContent) throw new Error('Slack file.upload needs "fileContent"');
    bytes = Buffer.from(config.fileContent, "utf8");
  }
  if (!fileName) {
    throw new Error('Slack file.upload needs "fileName", or a file name in the binary data');
  }
  if (bytes.byteLength === 0) throw new Error("The file is empty");
  if (bytes.byteLength > MAX_UPLOAD_BYTES) throw new Error("The file is larger than 1 GB");
  const answer = await uploadSlackFile(
    access,
    {
      bytes,
      fileName,
      title: config.title,
      channelId: config.channelId?.trim() || undefined,
      initialComment: config.initialComment,
      threadTs: config.threadTs?.trim() || undefined,
    },
    options,
  );
  const files = Array.isArray(answer.files) ? answer.files : [];
  return files.length === 1 ? files[0] : files;
}

export default defineNode({
  type: "slack.api",
  label: "Slack",
  description: "Send messages, manage channels, find users, and upload files with a Slack bot",
  category: "integration",
  app: "Slack",
  // The names of the actions of the Slack node.
  actions: [
    { label: "Send a message", config: { resource: "message", operation: "send" } },
    { label: "Update a message", config: { resource: "message", operation: "update" } },
    { label: "Delete a message", config: { resource: "message", operation: "delete" } },
    {
      label: "Get the permalink of a message",
      config: { resource: "message", operation: "getPermalink" },
    },
    { label: "List channels", config: { resource: "channel", operation: "list" } },
    { label: "Get a channel", config: { resource: "channel", operation: "get" } },
    { label: "Create a channel", config: { resource: "channel", operation: "create" } },
    { label: "Archive a channel", config: { resource: "channel", operation: "archive" } },
    { label: "Join a channel", config: { resource: "channel", operation: "join" } },
    { label: "Invite users to a channel", config: { resource: "channel", operation: "invite" } },
    { label: "Get a user", config: { resource: "user", operation: "get" } },
    { label: "List users", config: { resource: "user", operation: "list" } },
    { label: "Find a user by email", config: { resource: "user", operation: "getByEmail" } },
    { label: "Add a reaction", config: { resource: "reaction", operation: "add" } },
    { label: "Remove a reaction", config: { resource: "reaction", operation: "remove" } },
    { label: "Upload a file", config: { resource: "file", operation: "upload" } },
  ],
  icon: "BubbleChatIcon",
  iconUrl: SLACK_ICON,
  config: slackConfig,
  defaultConfig: {
    resource: "message",
    operation: "send",
    channelId: "",
    text: "",
    messageOptions: {},
    returnAll: false,
    limit: 50,
    timeoutMs: 30_000,
  },
  credentialTypes: [SLACK_CREDENTIAL],
  ports: { in: ["in"], out: ["out"] },
  subtitle: (config) =>
    typeof config.operation === "string"
      ? `${String(config.resource ?? "message")}: ${config.operation}`
      : undefined,
  async run({ config, input, credential, signal }) {
    const access = slackAccess(credential);
    const options = { signal, timeoutMs: config.timeoutMs };

    if (config.resource === "file") {
      return { port: "out", data: await upload(access, config, input, options) };
    }

    const request = buildRequest(config);
    if (request.itemsKey) {
      const items = await callSlackList(
        access,
        request.method,
        request.args,
        request.itemsKey,
        config.returnAll ? null : config.limit,
        options,
      );
      return { port: "out", data: items };
    }

    const {
      ok: _ok,
      response_metadata: _meta,
      ...data
    } = await callSlack(access, request.method, request.args, options);
    // An answer with only `ok` (archive, invite, reactions) says that the call worked.
    return { port: "out", data: Object.keys(data).length > 0 ? data : { success: true } };
  },
});
