// SPDX-License-Identifier: AGPL-3.0-only
import { defineNode } from "@zerodot/node-sdk";
import { callNotion, callNotionList, NOTION_CREDENTIAL, notionAccess } from "./api";
import { notionConfig } from "./config";
import { NOTION_ICON } from "./icon";
import { buildRequest } from "./request";
import { simplifyItem } from "./simplify";
import { withChildren } from "./tree";

export default defineNode({
  type: "notion.api",
  label: "Notion",
  description: "Search a workspace, and read and write pages, databases, and blocks in Notion",
  category: "integration",
  app: "Notion",
  // The names of the actions of the Notion node.
  actions: [
    { label: "Search", config: { resource: "search", operation: "search" } },
    { label: "Get a page", config: { resource: "page", operation: "get" } },
    { label: "Create a page", config: { resource: "page", operation: "create" } },
    { label: "Update a page", config: { resource: "page", operation: "update" } },
    { label: "Archive a page", config: { resource: "page", operation: "archive" } },
    { label: "Get a page as Markdown", config: { resource: "page", operation: "getMarkdown" } },
    {
      label: "Update a page with Markdown",
      config: { resource: "page", operation: "updateMarkdown" },
    },
    { label: "Get a database", config: { resource: "database", operation: "get" } },
    { label: "List data sources", config: { resource: "database", operation: "list" } },
    {
      label: "Get a data source",
      config: { resource: "database", operation: "getDataSource" },
    },
    { label: "Query a database", config: { resource: "database", operation: "query" } },
    { label: "Create a database row", config: { resource: "database", operation: "createRow" } },
    { label: "Get a block", config: { resource: "block", operation: "get" } },
    { label: "Get the blocks of a page", config: { resource: "block", operation: "getChildren" } },
    { label: "Append blocks", config: { resource: "block", operation: "append" } },
    { label: "Delete a block", config: { resource: "block", operation: "delete" } },
    { label: "Get a user", config: { resource: "user", operation: "get" } },
    { label: "List users", config: { resource: "user", operation: "list" } },
  ],
  icon: "FileText",
  iconUrl: NOTION_ICON,
  config: notionConfig,
  defaultConfig: {
    resource: "search",
    operation: "search",
    query: "",
    searchObject: "all",
    returnAll: false,
    limit: 50,
    simplify: true,
    timeoutMs: 30_000,
  },
  credentialTypes: [NOTION_CREDENTIAL],
  ports: { in: ["in"], out: ["out"] },
  subtitle: (config) =>
    typeof config.operation === "string"
      ? `${String(config.resource ?? "search")}: ${config.operation}`
      : undefined,
  async run({ config, credential, signal }) {
    const access = notionAccess(credential);
    const options = { signal, timeoutMs: config.timeoutMs, retries: 2 };
    const request = buildRequest(config);

    if (request.list) {
      const items = await callNotionList(
        access,
        request.call,
        config.returnAll ? null : config.limit,
        options,
      );
      if (config.resource === "block" && config.recursive) {
        const tree = await withChildren(
          access,
          items,
          config.maxDepth,
          config.simplify ? simplifyItem : (item) => item,
          options,
        );
        return { port: "out", data: tree };
      }
      return { port: "out", data: config.simplify ? items.map(simplifyItem) : items };
    }

    const data = await callNotion(access, request.call, options);
    return { port: "out", data: config.simplify ? simplifyItem(data) : data };
  },
});
