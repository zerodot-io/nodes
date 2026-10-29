// SPDX-License-Identifier: AGPL-3.0-only
import { defineNode } from "@zerodot/node-sdk";
import {
  type CallOptions,
  callGmail,
  GMAIL_OAUTH2_CREDENTIAL,
  GMAIL_SERVICE_ACCOUNT_CREDENTIAL,
  gmailToken,
  isObject,
  text,
} from "./api";
import { type GmailConfig, gmailConfig } from "./config";
import { GMAIL_ICON } from "./icon";
import {
  buildRaw,
  type Call,
  createDraftRequest,
  createLabelRequest,
  deleteDraftRequest,
  deleteLabelRequest,
  deleteMessageRequest,
  deleteThreadRequest,
  getDraftRequest,
  getLabelRequest,
  getMessageRequest,
  getThreadRequest,
  type ListOptions,
  labelsOf,
  listLabelsRequest,
  modifyMessageRequest,
  modifyThreadRequest,
  profileRequest,
  REPLY_HEADERS,
  replyTarget,
  resolveLabelIds,
  searchIds,
  sendRequest,
  shapeMessage,
  splitList,
  toMailItem,
  trashMessageRequest,
  trashThreadRequest,
  withAttachments,
} from "./request";

const need = <T>(value: T | undefined, name: string, operation: string): T => {
  if (value === undefined || value === "" || (typeof value === "string" && !value.trim())) {
    throw new Error(`"${name}" is needed to ${operation}`);
  }
  return value;
};

const success = (extra: Record<string, unknown>) => ({ success: true, ...extra });

async function runMessage(
  call: Call,
  config: GmailConfig,
  input: unknown,
  labelIds: () => Promise<string[]>,
  listOptions: () => Promise<ListOptions>,
): Promise<unknown> {
  const { operation } = config;
  const messageId = () => need(config.messageId, "messageId", operation);
  const body = {
    from: config.fromEmail,
    replyTo: config.replyTo,
    format: config.emailFormat,
    text: config.text,
    html: config.html,
    attachments: config.attachments,
  };

  switch (operation) {
    case "send": {
      const raw = await buildRaw(
        {
          ...body,
          to: config.to,
          cc: config.ccEmail,
          bcc: config.bccEmail,
          subject: config.subject ?? "",
        },
        input,
      );
      return await call(sendRequest(raw));
    }
    case "reply": {
      const original = await call(getMessageRequest(messageId(), "metadata", REPLY_HEADERS));
      const self = config.replyAll
        ? text(((await call(profileRequest())) as Record<string, unknown>).emailAddress)
        : undefined;
      const target = replyTarget(original, config.replyAll, self);
      const raw = await buildRaw(
        {
          ...body,
          to: target.to,
          cc: target.cc,
          subject: target.subject,
          inReplyTo: target.inReplyTo,
          references: target.references,
        },
        input,
      );
      return await call(sendRequest(raw, target.threadId));
    }
    case "get":
      return await shapeMessage(
        call,
        await call(getMessageRequest(messageId())),
        config.simplify,
        config.downloadAttachments,
      );
    case "getMany": {
      const ids = await searchIds(call, await listOptions(), config.limit);
      const out: unknown[] = [];
      for (const id of ids) {
        const message = await call(getMessageRequest(id));
        out.push(await shapeMessage(call, message, config.simplify, config.downloadAttachments));
      }
      return out;
    }
    case "markAsRead":
      return await call(modifyMessageRequest(messageId(), [], ["UNREAD"]));
    case "markAsUnread":
      return await call(modifyMessageRequest(messageId(), ["UNREAD"], []));
    case "trash":
      return await call(trashMessageRequest(messageId()));
    case "untrash":
      return await call(trashMessageRequest(messageId(), true));
    case "delete": {
      const id = messageId();
      await call(deleteMessageRequest(id));
      return success({ id });
    }
    case "addLabels":
      return await call(modifyMessageRequest(messageId(), await labelIds(), []));
    case "removeLabels":
      return await call(modifyMessageRequest(messageId(), [], await labelIds()));
  }
  throw new Error(`"${operation}" is not an operation of "message"`);
}

async function runDraft(
  call: Call,
  config: GmailConfig,
  input: unknown,
  listOptions: () => Promise<ListOptions>,
): Promise<unknown> {
  const { operation } = config;
  const shape = async (answer: unknown) => {
    if (!config.simplify || !isObject(answer)) return answer;
    const item = toMailItem(answer.message);
    const mail = config.downloadAttachments ? await withAttachments(call, item) : item;
    return { draftId: text(answer.id) ?? "", ...mail };
  };

  switch (operation) {
    case "create": {
      const raw = await buildRaw(
        {
          from: config.fromEmail,
          replyTo: config.replyTo,
          to: config.to,
          cc: config.ccEmail,
          bcc: config.bccEmail,
          subject: config.subject ?? "",
          format: config.emailFormat,
          text: config.text,
          html: config.html,
          attachments: config.attachments,
        },
        input,
      );
      return await call(createDraftRequest(raw, config.threadId?.trim() || undefined));
    }
    case "get":
      return await shape(await call(getDraftRequest(need(config.draftId, "draftId", operation))));
    case "getMany": {
      const ids = await searchIds(call, await listOptions(), config.limit, "drafts");
      const out: unknown[] = [];
      for (const id of ids) out.push(await shape(await call(getDraftRequest(id))));
      return out;
    }
    case "delete": {
      const id = need(config.draftId, "draftId", operation);
      await call(deleteDraftRequest(id));
      return success({ id });
    }
  }
  throw new Error(`"${operation}" is not an operation of "draft"`);
}

async function runLabel(call: Call, config: GmailConfig): Promise<unknown> {
  const { operation } = config;
  switch (operation) {
    case "create":
      return await call(
        createLabelRequest(
          need(config.labelName, "labelName", operation).trim(),
          config.labelListVisibility,
          config.messageListVisibility,
        ),
      );
    case "get":
      return await call(getLabelRequest(need(config.labelId, "labelId", operation)));
    case "getMany": {
      const answer = await call(listLabelsRequest());
      const labels = isObject(answer) && Array.isArray(answer.labels) ? answer.labels : [];
      return labels.slice(0, config.limit);
    }
    case "delete": {
      const id = need(config.labelId, "labelId", operation);
      await call(deleteLabelRequest(id));
      return success({ id });
    }
  }
  throw new Error(`"${operation}" is not an operation of "label"`);
}

async function runThread(
  call: Call,
  config: GmailConfig,
  labelIds: () => Promise<string[]>,
  listOptions: () => Promise<ListOptions>,
): Promise<unknown> {
  const { operation } = config;
  const threadId = () => need(config.threadId, "threadId", operation);
  switch (operation) {
    case "get": {
      const answer = await call(getThreadRequest(threadId()));
      if (!config.simplify || !isObject(answer)) return answer;
      const messages = Array.isArray(answer.messages) ? answer.messages : [];
      const items: unknown[] = [];
      for (const message of messages) {
        items.push(await shapeMessage(call, message, true, config.downloadAttachments));
      }
      return {
        id: text(answer.id) ?? "",
        historyId: text(answer.historyId) ?? "",
        messages: items,
      };
    }
    case "getMany": {
      // The list gives the ID, the snippet, and the history ID of each thread.
      const ids = await searchIds(call, await listOptions(), config.limit, "threads");
      return ids.map((id) => ({ id }));
    }
    case "trash":
      return await call(trashThreadRequest(threadId()));
    case "untrash":
      return await call(trashThreadRequest(threadId(), true));
    case "delete": {
      const id = threadId();
      await call(deleteThreadRequest(id));
      return success({ id });
    }
    case "addLabels":
      return await call(modifyThreadRequest(threadId(), await labelIds(), []));
    case "removeLabels":
      return await call(modifyThreadRequest(threadId(), [], await labelIds()));
  }
  throw new Error(`"${operation}" is not an operation of "thread"`);
}

export default defineNode({
  type: "gmail.api",
  label: "Gmail",
  description: "Send, read, search, and label emails in Gmail",
  category: "integration",
  app: "Gmail",
  // The names of the actions of the Gmail node.
  actions: [
    { label: "Send a message", config: { resource: "message", operation: "send" } },
    { label: "Reply to a message", config: { resource: "message", operation: "reply" } },
    { label: "Get a message", config: { resource: "message", operation: "get" } },
    { label: "Get many messages", config: { resource: "message", operation: "getMany" } },
    { label: "Mark a message as read", config: { resource: "message", operation: "markAsRead" } },
    {
      label: "Mark a message as unread",
      config: { resource: "message", operation: "markAsUnread" },
    },
    { label: "Move a message to the trash", config: { resource: "message", operation: "trash" } },
    { label: "Delete a message", config: { resource: "message", operation: "delete" } },
    { label: "Add labels to a message", config: { resource: "message", operation: "addLabels" } },
    {
      label: "Remove labels from a message",
      config: { resource: "message", operation: "removeLabels" },
    },
    { label: "Create a draft", config: { resource: "draft", operation: "create" } },
    { label: "Get a draft", config: { resource: "draft", operation: "get" } },
    { label: "Get many drafts", config: { resource: "draft", operation: "getMany" } },
    { label: "Delete a draft", config: { resource: "draft", operation: "delete" } },
    { label: "Create a label", config: { resource: "label", operation: "create" } },
    { label: "Get a label", config: { resource: "label", operation: "get" } },
    { label: "Get many labels", config: { resource: "label", operation: "getMany" } },
    { label: "Delete a label", config: { resource: "label", operation: "delete" } },
    { label: "Get a thread", config: { resource: "thread", operation: "get" } },
    { label: "Get many threads", config: { resource: "thread", operation: "getMany" } },
    { label: "Move a thread to the trash", config: { resource: "thread", operation: "trash" } },
    { label: "Delete a thread", config: { resource: "thread", operation: "delete" } },
    { label: "Add labels to a thread", config: { resource: "thread", operation: "addLabels" } },
    {
      label: "Remove labels from a thread",
      config: { resource: "thread", operation: "removeLabels" },
    },
  ],
  icon: "Mail",
  iconUrl: GMAIL_ICON,
  config: gmailConfig,
  defaultConfig: {
    authentication: "oAuth2",
    resource: "message",
    operation: "send",
    emailFormat: "html",
    replyAll: false,
    includeSpamTrash: false,
    limit: 20,
    simplify: true,
    downloadAttachments: false,
    labelListVisibility: "labelShow",
    messageListVisibility: "show",
    timeoutMs: 30_000,
  },
  credentialTypes: [GMAIL_OAUTH2_CREDENTIAL, GMAIL_SERVICE_ACCOUNT_CREDENTIAL],
  // The Authentication field says which credential type the user picks.
  credentialRules: {
    [GMAIL_OAUTH2_CREDENTIAL]: { showWhen: { authentication: ["oAuth2"] } },
    [GMAIL_SERVICE_ACCOUNT_CREDENTIAL]: { showWhen: { authentication: ["serviceAccount"] } },
  },
  ports: { in: ["in"], out: ["out"] },
  subtitle: (config) =>
    typeof config.operation === "string"
      ? `${String(config.resource ?? "message")}: ${config.operation}`
      : undefined,
  async run({ config, input, credential, signal }) {
    const options: CallOptions = { signal, timeoutMs: config.timeoutMs };
    const token = await gmailToken(credential, options);
    const call: Call = (request) => callGmail(token, request, options);

    const labelIds = () =>
      resolveLabelIds(splitList(need(config.labelIds, "labelIds", config.operation)), async () =>
        labelsOf(await call(listLabelsRequest())),
      );
    const listOptions = async (): Promise<ListOptions> => ({
      query: config.query,
      labelIds: config.labelIds
        ? await resolveLabelIds(splitList(config.labelIds), async () =>
            labelsOf(await call(listLabelsRequest())),
          )
        : undefined,
      includeSpamTrash: config.includeSpamTrash,
    });

    switch (config.resource) {
      case "message":
        return {
          port: "out",
          data: await runMessage(call, config, input, labelIds, listOptions),
        };
      case "draft":
        return { port: "out", data: await runDraft(call, config, input, listOptions) };
      case "label":
        return { port: "out", data: await runLabel(call, config) };
      case "thread":
        return { port: "out", data: await runThread(call, config, labelIds, listOptions) };
    }
  },
});
