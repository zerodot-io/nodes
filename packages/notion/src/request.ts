// SPDX-License-Identifier: AGPL-3.0-only
import type { Call } from "./api";
import type { NotionConfig } from "./config";

export type NotionRequest = {
  call: Call;
  /** A list: the items are in `results` of each page. */
  list?: boolean;
};

const need = <T>(value: T | undefined, name: string, operation: string): T => {
  if (value === undefined || (typeof value === "string" && value.trim() === "")) {
    throw new Error(`Notion ${operation} needs "${name}"`);
  }
  return value;
};

/** An ID goes in a path, so it must be an ID: 32 hex digits, with or without hyphens. */
export const id = (value: string | undefined, name: string, operation: string): string => {
  const text = need(value, name, operation).trim().replaceAll("-", "").toLowerCase();
  if (!/^[0-9a-f]{32}$/.test(text)) {
    throw new Error(`Notion ${operation}: "${name}" is not an ID`);
  }
  return text;
};

/** JSON text as a value of the right shape. Empty text gives `undefined`. */
function json(text: string | undefined, name: string, shape: "object" | "array") {
  if (!text?.trim()) return undefined;
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error(`"${name}" must be JSON`);
  }
  const isArray = Array.isArray(value);
  if (typeof value !== "object" || value === null || isArray !== (shape === "array")) {
    throw new Error(`"${name}" must be a JSON ${shape}`);
  }
  return value as Record<string, unknown> & unknown[];
}

const objectOf = (text: string | undefined, name: string, operation: string) =>
  need(json(text, name, "object"), name, operation) as Record<string, unknown>;

/** Notion accepts at most 2000 characters in one rich text part. */
const richText = (text: string) =>
  (text.match(/[\s\S]{1,2000}/g) ?? []).map((part) => ({ type: "text", text: { content: part } }));

/** One block of a type, from plain text. */
export function blockOf(type: NotionConfig["blockType"], text: string): Record<string, unknown> {
  if (type === "divider") return { object: "block", type, divider: {} };
  const content: Record<string, unknown> = { rich_text: richText(text) };
  if (type === "to_do") content.checked = false;
  if (type === "code") content.language = "plain text";
  return { object: "block", type, [type]: content };
}

/**
 * The blocks for a body. JSON blocks win. Else the Text makes one block of the Block Type.
 * Notion accepts at most 100 blocks in one call.
 */
function blocksOf(c: NotionConfig, operation: string): unknown[] {
  const blocks = json(c.children, "children", "array");
  if (blocks !== undefined) {
    if (blocks.length > 100) throw new Error(`Notion ${operation} accepts at most 100 blocks`);
    return blocks;
  }
  if (c.blockType === "divider") return [blockOf("divider", "")];
  return c.text?.trim() ? [blockOf(c.blockType, c.text)] : [];
}

/** The filter of a row query: the JSON filter and the time filters, joined with AND. */
function rowFilter(c: NotionConfig): Record<string, unknown> | undefined {
  const times: Record<string, unknown>[] = [];
  const add = (timestamp: string, rule: string, value: string | undefined) => {
    if (value?.trim()) times.push({ timestamp, [timestamp]: { [rule]: value.trim() } });
  };
  add("created_time", "after", c.filters.createdAfter);
  add("created_time", "before", c.filters.createdBefore);
  add("last_edited_time", "after", c.filters.editedAfter);
  add("last_edited_time", "before", c.filters.editedBefore);
  const own = json(c.filter, "filter", "object");
  const all = own ? [own, ...times] : times;
  return all.length > 1 ? { and: all } : all[0];
}

/** The Notion call for one operation, without the network. */
export function buildRequest(c: NotionConfig): NotionRequest {
  const op = `${c.resource}.${c.operation}`;

  switch (op) {
    case "search.search":
      return {
        call: {
          method: "POST",
          path: "/v1/search",
          body: {
            query: c.query?.trim() || undefined,
            filter:
              c.searchObject === "all"
                ? undefined
                : {
                    property: "object",
                    value: c.searchObject === "dataSource" ? "data_source" : "page",
                  },
          },
        },
        list: true,
      };

    case "page.get":
      return { call: { method: "GET", path: `/v1/pages/${id(c.pageId, "pageId", op)}` } };
    case "page.create": {
      const children = blocksOf(c, op);
      return {
        call: {
          method: "POST",
          path: "/v1/pages",
          body: {
            parent: { page_id: id(c.parentPageId, "parentPageId", op) },
            properties: {
              title: { title: [{ text: { content: need(c.title, "title", op) } }] },
            },
            children: children.length > 0 ? children : undefined,
          },
        },
      };
    }
    case "page.update":
      return {
        call: {
          method: "PATCH",
          path: `/v1/pages/${id(c.pageId, "pageId", op)}`,
          body: { properties: objectOf(c.properties, "properties", op) },
        },
      };
    case "page.archive":
      return {
        call: {
          method: "PATCH",
          path: `/v1/pages/${id(c.pageId, "pageId", op)}`,
          body: { in_trash: true },
        },
      };

    case "database.get":
      return {
        call: { method: "GET", path: `/v1/databases/${id(c.databaseId, "databaseId", op)}` },
      };
    case "database.list":
      return {
        call: {
          method: "POST",
          path: "/v1/search",
          body: {
            query: c.query?.trim() || undefined,
            filter: { property: "object", value: "data_source" },
          },
        },
        list: true,
      };
    case "database.getDataSource":
      return {
        call: { method: "GET", path: `/v1/data_sources/${id(c.dataSourceId, "dataSourceId", op)}` },
      };
    case "database.query":
      return {
        call: {
          method: "POST",
          path: `/v1/data_sources/${id(c.dataSourceId, "dataSourceId", op)}/query`,
          body: {
            filter: rowFilter(c),
            sorts: json(c.sorts, "sorts", "array"),
          },
        },
        list: true,
      };
    case "database.createRow": {
      const children = blocksOf(c, op);
      return {
        call: {
          method: "POST",
          path: "/v1/pages",
          body: {
            parent: {
              type: "data_source_id",
              data_source_id: id(c.dataSourceId, "dataSourceId", op),
            },
            properties: objectOf(c.properties, "properties", op),
            children: children.length > 0 ? children : undefined,
          },
        },
      };
    }

    case "block.get":
      return { call: { method: "GET", path: `/v1/blocks/${id(c.blockId, "blockId", op)}` } };
    case "block.getChildren":
      return {
        call: { method: "GET", path: `/v1/blocks/${id(c.blockId, "blockId", op)}/children` },
        list: true,
      };
    case "block.append": {
      const children = blocksOf(c, op);
      if (children.length === 0) throw new Error(`Notion ${op} needs "children"`);
      const after = c.afterBlockId?.trim();
      return {
        call: {
          method: "PATCH",
          path: `/v1/blocks/${id(c.blockId, "blockId", op)}/children`,
          body: {
            children,
            position: after
              ? { type: "after_block", after_block: { id: id(after, "afterBlockId", op) } }
              : undefined,
          },
        },
      };
    }
    case "block.delete":
      return { call: { method: "DELETE", path: `/v1/blocks/${id(c.blockId, "blockId", op)}` } };

    case "user.get":
      return { call: { method: "GET", path: `/v1/users/${id(c.userId, "userId", op)}` } };
    case "user.list":
      return { call: { method: "GET", path: "/v1/users" }, list: true };
  }
  throw new Error(`Unknown Notion operation "${op}"`);
}
