// SPDX-License-Identifier: AGPL-3.0-only
import { defineNode } from "@zerodot/node-sdk";
import { z } from "zod";
import {
  type CallOptions,
  callGmail,
  GMAIL_OAUTH2_CREDENTIAL,
  GMAIL_SERVICE_ACCOUNT_CREDENTIAL,
  gmailToken,
  isObject,
} from "./api";
import { AUTHENTICATION } from "./config";
import { GMAIL_ICON } from "./icon";
import {
  type Call,
  getMessageRequest,
  labelsOf,
  listLabelsRequest,
  modifyMessageRequest,
  resolveLabelIds,
  type SearchFilters,
  searchIds,
  searchText,
  shapeMessage,
  splitList,
  toMailItem,
} from "./request";

const config = z.object({
  authentication: z
    .enum(AUTHENTICATION)
    .default("oAuth2")
    .meta({
      title: "Authentication",
      labels: { oAuth2: "OAuth2", serviceAccount: "Service Account" },
    }),
  intervalSeconds: z
    .number()
    .int()
    .min(10)
    .max(86_400)
    .default(60)
    .meta({ title: "Check Every (Seconds)" }),
  query: z.string().optional().meta({
    title: "Search",
    placeholder: "has:attachment subject:invoice",
    description: "A Gmail search. Only new mail that matches it starts a run",
  }),
  labelIds: z.string().optional().meta({
    title: "Labels",
    placeholder: "INBOX, Invoices",
    description: "Label names or IDs, with commas between. Only mail with all of them starts a run",
  }),
  sender: z.string().optional().meta({
    title: "Sender",
    placeholder: "ann@example.com",
    description: "Only mail from this sender starts a run",
  }),
  readStatus: z
    .enum(["all", "unread", "read"])
    .default("unread")
    .meta({
      title: "Read Status",
      labels: { all: "All", unread: "Unread", read: "Read" },
    }),
  includeSpamTrash: z.boolean().default(false).meta({ title: "Include Spam and Trash" }),
  simplify: z.boolean().default(true).meta({
    title: "Simplify",
    description:
      "Return subject, addresses, text, html, and a list of attachments. Off: the full answer of Gmail",
  }),
  downloadAttachments: z.boolean().default(false).meta({
    title: "Download Attachments",
    description: "Add the files as binary data: attachment_0, attachment_1, and so on",
  }),
  postProcessAction: z
    .enum(["nothing", "read"])
    .default("nothing")
    .meta({
      title: "Action",
      description: "What to do with a mail after the run starts",
      labels: { nothing: "Nothing", read: "Mark as read" },
    }),
  maxPerPoll: z.number().int().min(1).max(500).default(50).meta({
    title: "Most Mails per Check",
    description: "If more mails are new, the next check gets the others",
  }),
  timeoutMs: z.number().int().min(1).max(300_000).default(30_000),
});

type TriggerConfig = z.output<typeof config>;

/** Where the poll stopped: the time of the last mail that started a run, and the IDs at that time. */
export type Cursor = { after: number; ids: string[] };

export const isCursor = (value: unknown): value is Cursor =>
  isObject(value) &&
  typeof value.after === "number" &&
  Array.isArray(value.ids) &&
  value.ids.every((id) => typeof id === "string");

/** Gmail finds mail by whole seconds. One second back, so that no mail is lost. */
const searchFrom = (cursor: Cursor): number => Math.floor(cursor.after / 1000) - 1;

type Found = { id: string; time: number; message: unknown };

/** The new mails after the cursor, oldest first. `call` is the Gmail call of the poll. */
export async function newMails(
  call: Call,
  cfg: Pick<
    TriggerConfig,
    "query" | "labelIds" | "sender" | "readStatus" | "includeSpamTrash" | "maxPerPoll"
  >,
  cursor: Cursor,
): Promise<Found[]> {
  const filters: SearchFilters = {
    query: cfg.query,
    sender: cfg.sender,
    readStatus: cfg.readStatus,
    after: searchFrom(cursor),
  };
  const labels = splitList(cfg.labelIds);
  const ids = await searchIds(
    call,
    {
      query: searchText(filters),
      labelIds:
        labels.length > 0
          ? await resolveLabelIds(labels, async () => labelsOf(await call(listLabelsRequest())))
          : undefined,
      includeSpamTrash: cfg.includeSpamTrash,
    },
    1000,
  );
  const seen = new Set(cursor.ids);
  const found: Found[] = [];
  for (const id of ids) {
    if (seen.has(id)) continue;
    const message = await call(getMessageRequest(id));
    const time = Date.parse(toMailItem(message).internalDate ?? "");
    if (!Number.isFinite(time) || time < cursor.after) continue;
    found.push({ id, time, message });
  }
  found.sort((a, b) => a.time - b.time);
  return found.slice(0, cfg.maxPerPoll);
}

/** The cursor after the mails in `sent`. The mails with the last time are kept by ID. */
export function nextCursor(cursor: Cursor, sent: Found[]): Cursor {
  const last = sent.at(-1);
  if (!last) return cursor;
  return { after: last.time, ids: sent.filter((mail) => mail.time === last.time).map((m) => m.id) };
}

export default defineNode({
  type: "gmail.trigger",
  label: "On new email (Gmail)",
  description: "Start a run when a new email matches a search or a label",
  category: "trigger",
  app: "Gmail",
  icon: "Mail01Icon",
  iconUrl: GMAIL_ICON,
  config,
  defaultConfig: {
    authentication: "oAuth2",
    intervalSeconds: 60,
    readStatus: "unread",
    includeSpamTrash: false,
    simplify: true,
    downloadAttachments: false,
    postProcessAction: "nothing",
    maxPerPoll: 50,
    timeoutMs: 30_000,
  },
  credentialTypes: [GMAIL_OAUTH2_CREDENTIAL, GMAIL_SERVICE_ACCOUNT_CREDENTIAL],
  credentialRules: {
    [GMAIL_OAUTH2_CREDENTIAL]: { showWhen: { authentication: ["oAuth2"] } },
    [GMAIL_SERVICE_ACCOUNT_CREDENTIAL]: { showWhen: { authentication: ["serviceAccount"] } },
  },
  ports: { in: [], out: ["out"] },
  subtitle: (cfg) => (typeof cfg.query === "string" && cfg.query !== "" ? cfg.query : undefined),
  // The input is the mail that started the run.
  run: ({ input }) => ({ port: "out", data: input }),
  async poll({ config: cfg, credential, cursor, firstPoll, signal }) {
    const now = Date.now();
    // The mails that are already there do not start runs.
    if (firstPoll || !isCursor(cursor)) {
      return { items: [], cursor: { after: now, ids: [] } satisfies Cursor };
    }
    const options: CallOptions = { signal, timeoutMs: cfg.timeoutMs };
    const token = await gmailToken(credential, options);
    const call: Call = (request) => callGmail(token, request, options);

    const mails = await newMails(call, cfg, cursor);
    const items = [];
    for (const mail of mails) {
      const data = await shapeMessage(call, mail.message, cfg.simplify, cfg.downloadAttachments);
      items.push({ key: mail.id, data });
      if (cfg.postProcessAction === "read") {
        await call(modifyMessageRequest(mail.id, [], ["UNREAD"]));
      }
    }
    return { items, cursor: nextCursor(cursor, mails) };
  },
});
