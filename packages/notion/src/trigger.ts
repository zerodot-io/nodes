// SPDX-License-Identifier: AGPL-3.0-only
import { defineNode, POLL_MAX_ITEMS } from "@zerodot/node-sdk";
import { z } from "zod";
import { callNotionList, NOTION_CREDENTIAL, notionAccess } from "./api";
import { NOTION_ICON } from "./icon";
import { id } from "./request";
import { isObject, simplifyItem } from "./simplify";

export const EVENTS = ["pageAdded", "pageUpdated"] as const;
export type Event = (typeof EVENTS)[number];

export const triggerConfig = z.object({
  event: z
    .enum(EVENTS)
    .default("pageAdded")
    .meta({
      title: "Trigger On",
      labels: { pageAdded: "Page Added", pageUpdated: "Page Updated" },
      hints: {
        pageAdded: "A new row in the data source",
        pageUpdated: "A row of the data source changed. A new row also counts",
      },
    }),
  dataSourceId: z.string().min(1).meta({
    title: "Data Source ID",
    description: "The data source to watch. Share its database with the integration",
  }),
  simplify: z.boolean().default(true).meta({
    description: "Give the main values, such as the text of a title. Turn it off to get raw data",
  }),
  intervalSeconds: z.number().int().min(15).max(86_400).default(60).meta({
    title: "Check every (seconds)",
  }),
});

export type NotionTriggerConfig = z.output<typeof triggerConfig>;

const FIELD_OF = { pageAdded: "created_time", pageUpdated: "last_edited_time" } as const;

/** Notion keeps the times with an accuracy of one minute, so the poll rounds down to a minute. */
export const minuteOf = (date: Date): string => {
  const copy = new Date(date);
  copy.setUTCSeconds(0, 0);
  return copy.toISOString();
};

/** The query for the pages that are new since the cursor, oldest first. */
export function pollBody(event: Event, cursor: string): Record<string, unknown> {
  const field = FIELD_OF[event];
  return {
    filter: { timestamp: field, [field]: { on_or_after: cursor } },
    sorts: [{ timestamp: field, direction: "ascending" }],
  };
}

/**
 * The key of a page. A new page has one key for ever. An updated page has a new key for each
 * edit. The engine skips a key that it has seen, so a page from the same minute starts one run.
 */
export const keyOf = (event: Event, page: Record<string, unknown>): string =>
  event === "pageAdded" ? String(page.id) : `${String(page.id)}:${String(page.last_edited_time)}`;

export default defineNode({
  type: "trigger.notion",
  label: "Notion Trigger",
  description: "Check a Notion data source on a timer and start a run for each new or changed page",
  category: "trigger",
  app: "Notion",
  icon: "File01Icon",
  iconUrl: NOTION_ICON,
  config: triggerConfig,
  defaultConfig: { event: "pageAdded", dataSourceId: "", simplify: true, intervalSeconds: 60 },
  credentialTypes: [NOTION_CREDENTIAL],
  ports: { in: [], out: ["out"] },
  subtitle: (config) => (typeof config.event === "string" ? config.event : undefined),
  // The input is the page that started the run.
  run: ({ input }) => ({ port: "out", data: input }),
  async poll({ config, credential, cursor, firstPoll, signal }) {
    const access = notionAccess(credential);
    const now = minuteOf(new Date());
    // The first poll only marks the time. The pages that exist now start no runs.
    if (firstPoll) return { items: [], cursor: now };
    const last = typeof cursor === "string" ? cursor : now;
    const pages = await callNotionList(
      access,
      {
        method: "POST",
        path: `/v1/data_sources/${id(config.dataSourceId, "dataSourceId", "trigger")}/query`,
        body: pollBody(config.event, last),
      },
      POLL_MAX_ITEMS,
      { signal, timeoutMs: 30_000 },
    );
    const field = FIELD_OF[config.event];
    const items = pages.filter(isObject).map((page) => ({
      key: keyOf(config.event, page),
      data: config.simplify ? simplifyItem(page) : page,
    }));
    const newest = pages.filter(isObject).at(-1)?.[field];
    return { items, cursor: typeof newest === "string" ? minuteOf(new Date(newest)) : last };
  },
});
