// SPDX-License-Identifier: AGPL-3.0-only
import { type BinaryData, readBinary, toBinary } from "@zerodot/node-sdk";
import { type GmailRequest, isObject, text } from "./api";

export type Call = (request: GmailRequest) => Promise<unknown>;

/** The labels that Gmail makes for every mailbox. Their ID is their name. */
export const SYSTEM_LABELS = [
  "INBOX",
  "SENT",
  "DRAFT",
  "SPAM",
  "TRASH",
  "UNREAD",
  "STARRED",
  "IMPORTANT",
  "CHAT",
  "CATEGORY_PERSONAL",
  "CATEGORY_SOCIAL",
  "CATEGORY_PROMOTIONS",
  "CATEGORY_UPDATES",
  "CATEGORY_FORUMS",
] as const;

/** Names in a list with commas between. Empty parts go away. */
export const splitList = (value: string | undefined): string[] =>
  (value ?? "")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);

// ---------------------------------------------------------------------------------------------
// IDs

const ID = /^[A-Za-z0-9_-]+$/;

/** An ID of a message, thread, draft, or label. It goes in a path, so only safe characters pass. */
export function pathId(value: string | undefined, name: string): string {
  const id = (value ?? "").trim();
  if (!id) throw new Error(`"${name}" is needed`);
  if (!ID.test(id)) throw new Error(`"${id}" is not a valid ${name}`);
  return id;
}

// ---------------------------------------------------------------------------------------------
// Requests

export type ListOptions = {
  query?: string;
  labelIds?: string[];
  includeSpamTrash?: boolean;
  maxResults?: number;
  pageToken?: string;
};

const listQuery = (options: ListOptions) => ({
  q: options.query?.trim() || undefined,
  labelIds: options.labelIds,
  includeSpamTrash: options.includeSpamTrash ? "true" : undefined,
  maxResults: options.maxResults === undefined ? undefined : String(options.maxResults),
  pageToken: options.pageToken,
});

export const profileRequest = (): GmailRequest => ({
  method: "GET",
  path: "/profile",
  action: "read the profile",
});

export const listMessagesRequest = (options: ListOptions): GmailRequest => ({
  method: "GET",
  path: "/messages",
  query: listQuery(options),
  action: "list the messages",
});

export const getMessageRequest = (
  id: string,
  format: "full" | "metadata" | "minimal" = "full",
  headers: string[] = [],
): GmailRequest => ({
  method: "GET",
  path: `/messages/${pathId(id, "messageId")}`,
  query: { format, metadataHeaders: format === "metadata" ? headers : undefined },
  action: "get the message",
});

export const getAttachmentRequest = (messageId: string, attachmentId: string): GmailRequest => ({
  method: "GET",
  path: `/messages/${pathId(messageId, "messageId")}/attachments/${pathId(attachmentId, "attachmentId")}`,
  action: "get the attachment",
});

export const sendRequest = (raw: string, threadId?: string): GmailRequest => ({
  method: "POST",
  path: "/messages/send",
  body: { raw, ...(threadId && { threadId }) },
  action: "send the message",
});

export const modifyMessageRequest = (
  id: string,
  add: string[],
  remove: string[],
): GmailRequest => ({
  method: "POST",
  path: `/messages/${pathId(id, "messageId")}/modify`,
  body: { addLabelIds: add, removeLabelIds: remove },
  action: "change the labels of the message",
});

export const trashMessageRequest = (id: string, undo = false): GmailRequest => ({
  method: "POST",
  path: `/messages/${pathId(id, "messageId")}/${undo ? "untrash" : "trash"}`,
  action: undo ? "restore the message" : "move the message to the trash",
});

export const deleteMessageRequest = (id: string): GmailRequest => ({
  method: "DELETE",
  path: `/messages/${pathId(id, "messageId")}`,
  action: "delete the message",
});

export const createDraftRequest = (raw: string, threadId?: string): GmailRequest => ({
  method: "POST",
  path: "/drafts",
  body: { message: { raw, ...(threadId && { threadId }) } },
  action: "create the draft",
});

export const getDraftRequest = (id: string): GmailRequest => ({
  method: "GET",
  path: `/drafts/${pathId(id, "draftId")}`,
  query: { format: "full" },
  action: "get the draft",
});

export const listDraftsRequest = (options: ListOptions): GmailRequest => ({
  method: "GET",
  path: "/drafts",
  query: listQuery(options),
  action: "list the drafts",
});

export const deleteDraftRequest = (id: string): GmailRequest => ({
  method: "DELETE",
  path: `/drafts/${pathId(id, "draftId")}`,
  action: "delete the draft",
});

export const listLabelsRequest = (): GmailRequest => ({
  method: "GET",
  path: "/labels",
  action: "list the labels",
});

export const getLabelRequest = (id: string): GmailRequest => ({
  method: "GET",
  path: `/labels/${pathId(id, "labelId")}`,
  action: "get the label",
});

export const createLabelRequest = (
  name: string,
  listVisibility: string,
  messageVisibility: string,
): GmailRequest => ({
  method: "POST",
  path: "/labels",
  body: {
    name,
    labelListVisibility: listVisibility,
    messageListVisibility: messageVisibility,
  },
  action: "create the label",
});

export const deleteLabelRequest = (id: string): GmailRequest => ({
  method: "DELETE",
  path: `/labels/${pathId(id, "labelId")}`,
  action: "delete the label",
});

export const getThreadRequest = (id: string): GmailRequest => ({
  method: "GET",
  path: `/threads/${pathId(id, "threadId")}`,
  query: { format: "full" },
  action: "get the thread",
});

export const listThreadsRequest = (options: ListOptions): GmailRequest => ({
  method: "GET",
  path: "/threads",
  query: listQuery(options),
  action: "list the threads",
});

export const modifyThreadRequest = (id: string, add: string[], remove: string[]): GmailRequest => ({
  method: "POST",
  path: `/threads/${pathId(id, "threadId")}/modify`,
  body: { addLabelIds: add, removeLabelIds: remove },
  action: "change the labels of the thread",
});

export const trashThreadRequest = (id: string, undo = false): GmailRequest => ({
  method: "POST",
  path: `/threads/${pathId(id, "threadId")}/${undo ? "untrash" : "trash"}`,
  action: undo ? "restore the thread" : "move the thread to the trash",
});

export const deleteThreadRequest = (id: string): GmailRequest => ({
  method: "DELETE",
  path: `/threads/${pathId(id, "threadId")}`,
  action: "delete the thread",
});

// ---------------------------------------------------------------------------------------------
// Labels

export type Label = { id: string; name: string };

export const labelsOf = (answer: unknown): Label[] => {
  const list = isObject(answer) && Array.isArray(answer.labels) ? answer.labels : [];
  return list.flatMap((entry) => {
    const id = isObject(entry) ? text(entry.id) : undefined;
    const name = isObject(entry) ? text(entry.name) : undefined;
    return id && name ? [{ id, name }] : [];
  });
};

/**
 * Label IDs from IDs or names. A system label (`INBOX`) and an ID (`Label_12`) pass as they are.
 * A name is matched, without case, against the labels of the mailbox. `loadLabels` runs only when
 * a name needs it.
 */
export async function resolveLabelIds(
  values: string[],
  loadLabels: () => Promise<Label[]>,
): Promise<string[]> {
  const known = new Set<string>(SYSTEM_LABELS);
  let labels: Label[] | undefined;
  const ids: string[] = [];
  for (const value of values) {
    if (known.has(value) || /^Label_\d+$/.test(value)) {
      ids.push(value);
      continue;
    }
    labels ??= await loadLabels();
    const found =
      labels.find((label) => label.id === value) ??
      labels.find((label) => label.name.toLowerCase() === value.toLowerCase());
    if (!found) throw new Error(`The label "${value}" does not exist`);
    ids.push(found.id);
  }
  return ids;
}

// ---------------------------------------------------------------------------------------------
// Search

export type SearchFilters = {
  query?: string;
  sender?: string;
  readStatus?: "all" | "unread" | "read";
  /** Unix time in seconds. Only newer mail passes. */
  after?: number;
};

/** The Gmail search text of the filters. The words of the user stay as they are. */
export function searchText(filters: SearchFilters): string | undefined {
  const parts: string[] = [];
  if (filters.query?.trim()) parts.push(filters.query.trim());
  if (filters.sender?.trim()) parts.push(`from:(${filters.sender.trim()})`);
  if (filters.readStatus === "unread") parts.push("is:unread");
  if (filters.readStatus === "read") parts.push("is:read");
  if (filters.after !== undefined) parts.push(`after:${Math.floor(filters.after)}`);
  return parts.length > 0 ? parts.join(" ") : undefined;
}

// ---------------------------------------------------------------------------------------------
// Compose

export type ComposeOptions = {
  from?: string;
  to?: string;
  cc?: string;
  bcc?: string;
  replyTo?: string;
  subject: string;
  format: "text" | "html" | "both";
  text?: string;
  html?: string;
  /** Names of binary properties of the input, with commas between. */
  attachments?: string;
  inReplyTo?: string;
  references?: string;
};

type MailAttachment = { filename: string; content: Buffer; contentType: string; cid: string };

/** The attachments from `input.binary`. The content id of each one is its property name. */
export function attachmentsOf(names: string | undefined, input: unknown): MailAttachment[] {
  return splitList(names).map((name) => {
    const file = readBinary(input, name);
    return {
      filename: file.fileName || "unknown",
      content: Buffer.from(file.data, "base64"),
      contentType: file.mimeType,
      cid: name,
    };
  });
}

/** The message as base64url text of the full MIME source. This is the `raw` field of Gmail. */
export async function buildRaw(options: ComposeOptions, input: unknown): Promise<string> {
  if (!options.to?.trim() && !options.cc?.trim() && !options.bcc?.trim()) {
    throw new Error('The message needs a recipient: "to", "cc", or "bcc"');
  }
  const { default: MailComposer } = await import("nodemailer/lib/mail-composer/index.js");
  const { format } = options;
  const headers: Record<string, string> = {};
  if (options.inReplyTo) headers["In-Reply-To"] = options.inReplyTo;
  if (options.references) headers.References = options.references;
  const composer = new MailComposer({
    from: options.from || undefined,
    to: options.to || undefined,
    cc: options.cc || undefined,
    bcc: options.bcc || undefined,
    replyTo: options.replyTo || undefined,
    subject: options.subject,
    text: format === "text" || format === "both" ? (options.text ?? "") : undefined,
    html: format === "html" || format === "both" ? (options.html ?? "") : undefined,
    attachments: attachmentsOf(options.attachments, input),
    headers,
  });
  const buffer = await new Promise<Buffer>((resolve, reject) => {
    const mime = composer.compile();
    // Gmail reads the recipients from the headers, so Bcc must stay. Gmail removes it when it sends.
    mime.keepBcc = true;
    mime.build((error, message) => (error ? reject(error) : resolve(message)));
  });
  return buffer.toString("base64url");
}

// ---------------------------------------------------------------------------------------------
// Parse

type Header = { name: string; value: string };

type Part = {
  partId?: string;
  mimeType: string;
  filename: string;
  headers: Header[];
  body: { size: number; data?: string; attachmentId?: string };
  parts: Part[];
};

const headersOf = (value: unknown): Header[] =>
  (Array.isArray(value) ? value : []).flatMap((entry) => {
    const name = isObject(entry) ? text(entry.name) : undefined;
    return name && isObject(entry) ? [{ name, value: String(entry.value ?? "") }] : [];
  });

function toPart(value: unknown): Part {
  const part = isObject(value) ? value : {};
  const body = isObject(part.body) ? part.body : {};
  return {
    partId: text(part.partId),
    mimeType: text(part.mimeType) ?? "application/octet-stream",
    filename: typeof part.filename === "string" ? part.filename : "",
    headers: headersOf(part.headers),
    body: {
      size: typeof body.size === "number" ? body.size : 0,
      data: text(body.data),
      attachmentId: text(body.attachmentId),
    },
    parts: (Array.isArray(part.parts) ? part.parts : []).map(toPart),
  };
}

/** The value of a header. The name has no case. */
export const header = (headers: Header[], name: string): string | undefined =>
  headers.find((entry) => entry.name.toLowerCase() === name.toLowerCase())?.value;

function decodeBody(data: string, contentType: string | undefined): string {
  const bytes = Buffer.from(data, "base64url");
  const charset = /charset="?([^";\s]+)/i.exec(contentType ?? "")?.[1] ?? "utf-8";
  try {
    return new TextDecoder(charset).decode(bytes);
  } catch {
    return bytes.toString("utf8");
  }
}

export type AttachmentInfo = {
  attachmentId: string;
  fileName: string;
  mimeType: string;
  size: number;
  /** The content id, if the body shows the file inline. */
  contentId: string | null;
};

type Walked = { text: string[]; html: string[]; attachments: AttachmentInfo[] };

function walk(part: Part, found: Walked): void {
  const type = part.mimeType.toLowerCase();
  const contentType = header(part.headers, "content-type");
  if (part.body.attachmentId && (part.filename || !type.startsWith("text/"))) {
    found.attachments.push({
      attachmentId: part.body.attachmentId,
      fileName: part.filename || "attachment",
      mimeType: part.mimeType,
      size: part.body.size,
      contentId: header(part.headers, "content-id")?.replace(/^<|>$/g, "") ?? null,
    });
  } else if (part.body.data && !part.filename) {
    if (type === "text/plain") found.text.push(decodeBody(part.body.data, contentType));
    if (type === "text/html") found.html.push(decodeBody(part.body.data, contentType));
  }
  for (const child of part.parts) walk(child, found);
}

export type MailItem = {
  id: string;
  threadId: string;
  labelIds: string[];
  snippet: string;
  /** ISO 8601 time at which Gmail got the message. */
  internalDate: string | null;
  messageId: string | null;
  subject: string | null;
  from: string | null;
  to: string | null;
  cc: string | null;
  bcc: string | null;
  replyTo: string | null;
  date: string | null;
  text: string | null;
  html: string | null;
  attachments: AttachmentInfo[];
  binary?: Record<string, BinaryData>;
};

/** The simple fields of a Gmail message that has `format=full` (or `metadata`). */
export function toMailItem(message: unknown): MailItem {
  const raw = isObject(message) ? message : {};
  const payload = toPart(raw.payload);
  const found: Walked = { text: [], html: [], attachments: [] };
  walk(payload, found);
  const millis = Number(raw.internalDate);
  const value = (name: string) => header(payload.headers, name) ?? null;
  return {
    id: text(raw.id) ?? "",
    threadId: text(raw.threadId) ?? "",
    labelIds: (Array.isArray(raw.labelIds) ? raw.labelIds : []).filter(
      (label): label is string => typeof label === "string",
    ),
    snippet: typeof raw.snippet === "string" ? raw.snippet : "",
    internalDate: Number.isFinite(millis) && millis > 0 ? new Date(millis).toISOString() : null,
    messageId: value("message-id"),
    subject: value("subject"),
    from: value("from"),
    to: value("to"),
    cc: value("cc"),
    bcc: value("bcc"),
    replyTo: value("reply-to"),
    date: value("date"),
    text: found.text.length > 0 ? found.text.join("\n") : null,
    html: found.html.length > 0 ? found.html.join("\n") : null,
    attachments: found.attachments,
  };
}

/** Gets the files of a mail. They go in `binary` as `attachment_0`, `attachment_1`, ... */
export async function withAttachments(
  call: Call,
  item: MailItem,
  property = "attachment_",
): Promise<MailItem> {
  if (item.attachments.length === 0) return item;
  const binary: Record<string, BinaryData> = {};
  for (const [index, file] of item.attachments.entries()) {
    const answer = await call(getAttachmentRequest(item.id, file.attachmentId));
    const data = isObject(answer) ? text(answer.data) : undefined;
    binary[`${property}${index}`] = toBinary(
      Buffer.from(data ?? "", "base64url"),
      file.fileName,
      file.mimeType,
    );
  }
  return { ...item, binary };
}

/** The ID of a message in an answer of a list call. */
export const idsOf = (answer: unknown, key: "messages" | "threads" | "drafts"): string[] => {
  const list = isObject(answer) && Array.isArray(answer[key]) ? answer[key] : [];
  return list.flatMap((entry) => {
    const id = isObject(entry) ? text(entry.id) : undefined;
    return id ? [id] : [];
  });
};

// ---------------------------------------------------------------------------------------------
// Reply

/** The email address in `Name <a@b.c>` or `a@b.c`, in lower case. */
export const addressOf = (entry: string): string => {
  const inside = /<([^>]+)>/.exec(entry)?.[1];
  return (inside ?? entry).trim().toLowerCase();
};

/** Splits an address list at the commas that are not in quotes. */
export function splitAddresses(value: string | null | undefined): string[] {
  const out: string[] = [];
  let current = "";
  let quoted = false;
  for (const char of value ?? "") {
    if (char === '"') quoted = !quoted;
    if (char === "," && !quoted) {
      out.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }
  out.push(current.trim());
  return out.filter(Boolean);
}

export const REPLY_HEADERS = [
  "Message-ID",
  "References",
  "Subject",
  "From",
  "To",
  "Cc",
  "Reply-To",
];

export type ReplyTarget = {
  threadId: string;
  to: string;
  cc: string;
  subject: string;
  inReplyTo: string | undefined;
  references: string | undefined;
};

/**
 * What a reply needs from the first message: the thread, the recipients, `Re:` before the
 * subject, and the headers that make the mail a part of the thread. A reply to all also copies
 * the other recipients, except `self`.
 */
export function replyTarget(message: unknown, replyAll: boolean, self?: string): ReplyTarget {
  const mail = toMailItem(message);
  const raw = isObject(message) ? message : {};
  const payload = isObject(raw.payload) ? raw.payload : {};
  const headers = headersOf(payload.headers);
  const messageId = header(headers, "message-id");
  const references = header(headers, "references");
  const subject = mail.subject ?? "";
  const main = mail.replyTo ?? mail.from ?? "";
  const skip = new Set([addressOf(main), self?.toLowerCase()].filter(Boolean));
  const others = replyAll
    ? [...splitAddresses(mail.to), ...splitAddresses(mail.cc)].filter((entry) => {
        const address = addressOf(entry);
        if (skip.has(address)) return false;
        skip.add(address);
        return true;
      })
    : [];
  return {
    threadId: mail.threadId,
    to: main,
    cc: others.join(", "),
    subject: /^re:/i.test(subject) ? subject : `Re: ${subject}`,
    inReplyTo: messageId,
    references: [references, messageId].filter(Boolean).join(" ") || undefined,
  };
}

// ---------------------------------------------------------------------------------------------
// Read

/**
 * A message as the node returns it. `simplify` gives the fields of `toMailItem`, and
 * `download` also adds the files as binary data. Without `simplify` the answer of Gmail stays
 * as it is.
 */
export async function shapeMessage(
  call: Call,
  message: unknown,
  simplify: boolean,
  download: boolean,
): Promise<unknown> {
  if (!simplify) return message;
  const item = toMailItem(message);
  return download ? await withAttachments(call, item) : item;
}

/** The IDs of a search, newest first, over all pages up to `limit`. */
export async function searchIds(
  call: Call,
  options: ListOptions,
  limit: number,
  key: "messages" | "threads" | "drafts" = "messages",
): Promise<string[]> {
  const make =
    key === "messages"
      ? listMessagesRequest
      : key === "threads"
        ? listThreadsRequest
        : listDraftsRequest;
  const ids: string[] = [];
  let pageToken: string | undefined;
  do {
    const answer = await call(
      make({ ...options, maxResults: Math.min(500, limit - ids.length), pageToken }),
    );
    ids.push(...idsOf(answer, key));
    pageToken = isObject(answer) ? text(answer.nextPageToken) : undefined;
  } while (pageToken && ids.length < limit);
  return ids.slice(0, limit);
}
