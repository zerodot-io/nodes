// SPDX-License-Identifier: AGPL-3.0-only
import { z } from "zod";

// Resource and operation names follow the Notion API.

export const RESOURCES = ["search", "page", "database", "block", "user"] as const;
export type Resource = (typeof RESOURCES)[number];

export const OPERATIONS_OF = {
  search: ["search"],
  page: ["get", "create", "update", "archive", "getMarkdown", "updateMarkdown"],
  database: ["get", "list", "getDataSource", "query", "createRow"],
  block: ["get", "getChildren", "append", "delete"],
  user: ["get", "list"],
} as const satisfies Record<Resource, readonly string[]>;

const ALL_OPERATIONS = [...new Set(Object.values(OPERATIONS_OF).flat())] as [string, ...string[]];

export const MARKDOWN_COMMANDS = ["replace", "edit"] as const;
/** The deepest level of child blocks that Get Children reads. */
export const MAX_DEPTH = 3;

export const SEARCH_OBJECTS = ["all", "page", "dataSource"] as const;

export const BLOCK_TYPES = [
  "paragraph",
  "heading_1",
  "heading_2",
  "heading_3",
  "bulleted_list_item",
  "numbered_list_item",
  "to_do",
  "toggle",
  "quote",
  "callout",
  "code",
  "divider",
] as const;

type Operations = { [R in Resource]?: readonly (typeof OPERATIONS_OF)[R][number][] };

/** Show a field for these operations of these resources. */
const on = (operations: Operations) => ({
  showWhen: Object.entries(operations).map(([resource, ops]) => ({
    resource: [resource],
    operation: [...(ops ?? [])],
  })),
});

const isList = on({
  search: ["search"],
  database: ["list", "query"],
  block: ["getChildren"],
  user: ["list"],
});

/** The fields that make blocks: a new page, a new row, or an append. */
const content = on({ page: ["create"], database: ["createRow"], block: ["append"] });

export const notionConfig = z
  .object({
    resource: z
      .enum(RESOURCES)
      .default("search")
      .meta({
        labels: {
          search: "Search",
          page: "Page",
          database: "Database",
          block: "Block",
          user: "User",
        },
        hints: {
          search: "Find the pages and data sources that you shared with the integration",
          page: "Get, create, change, or archive a page",
          database: "Get or list databases and data sources, read rows, or add a row",
          block: "Read, add, or delete the content of a page or block",
          user: "List the users of the workspace",
        },
      }),
    operation: z
      .enum(ALL_OPERATIONS)
      .default("search")
      .meta({
        labels: {
          search: "Search",
          get: "Get",
          create: "Create",
          update: "Update",
          archive: "Archive",
          getMarkdown: "Get Markdown",
          updateMarkdown: "Update Markdown",
          getDataSource: "Get Data Source",
          query: "Query",
          createRow: "Create Row",
          getChildren: "Get Children",
          append: "Append",
          delete: "Delete",
          list: "List",
        },
        hints: {
          search: "Search by title",
          get: "Get one item by its ID",
          create: "Create a page below another page",
          update: "Change the properties of a page",
          archive: "Move a page to the trash",
          getMarkdown: "Get the content of a page as Markdown",
          updateMarkdown: "Replace the content of a page, or change a part of it, with Markdown",
          getDataSource: "Get a data source with the type of each property",
          query: "Get the rows of a data source. You can use a filter and a sort",
          createRow: "Add a row (a page) to a data source",
          getChildren: "Get the blocks inside a page or a block",
          append: "Add blocks to the end of a page or block",
          delete: "Move a block to the trash",
          list: "Get many items: the data sources that are shared, or the users",
        },
      }),
    // search
    query: z
      .string()
      .optional()
      .meta({
        ...on({ search: ["search"], database: ["list"] }),
        description: "The text to find in titles. If empty, the node gets all shared items",
      }),
    searchObject: z
      .enum(SEARCH_OBJECTS)
      .default("all")
      .meta({
        ...on({ search: ["search"] }),
        title: "Object Type",
        labels: { all: "All", page: "Pages", dataSource: "Data Sources" },
        hints: {
          all: "Pages and data sources",
          page: "Only pages",
          dataSource: "Only the data sources of databases",
        },
      }),
    // pages
    pageId: z
      .string()
      .optional()
      .meta({
        ...on({ page: ["get", "update", "archive", "getMarkdown", "updateMarkdown"] }),
        title: "Page ID",
        description: "The ID of the page, with or without hyphens",
      }),
    parentPageId: z
      .string()
      .optional()
      .meta({
        ...on({ page: ["create"] }),
        title: "Parent Page ID",
        description: "The page that holds the new page. Share it with the integration",
      }),
    title: z
      .string()
      .optional()
      .meta({ ...on({ page: ["create"] }), description: "The title of the new page" }),
    properties: z
      .string()
      .optional()
      .meta({
        ...on({ page: ["update"], database: ["createRow"] }),
        ui: "code",
        description:
          'The properties as a JSON object. For example {"Name":{"title":[{"text":{"content":"Task"}}]}}',
      }),
    markdownCommand: z
      .enum(MARKDOWN_COMMANDS)
      .default("replace")
      .meta({
        ...on({ page: ["updateMarkdown"] }),
        title: "Update Mode",
        labels: { replace: "Replace All", edit: "Find and Replace" },
        hints: {
          replace: "Replace all the content of the page with the Markdown",
          edit: "Replace one text in the content with a new text",
        },
      }),
    markdown: z
      .string()
      .optional()
      .meta({
        ...on({ page: ["updateMarkdown"] }),
        ui: "textarea",
        description:
          "The new content of the page, as Markdown. Use it with Replace All. Empty text clears the page, only if Allow Deleting Content is on",
      }),
    oldStr: z
      .string()
      .optional()
      .meta({
        ...on({ page: ["updateMarkdown"] }),
        title: "Text to Find",
        description: "The Markdown text to replace. Use it with Find and Replace",
      }),
    newStr: z
      .string()
      .optional()
      .meta({
        ...on({ page: ["updateMarkdown"] }),
        title: "New Text",
        description: "The Markdown text to put in its place. Use it with Find and Replace",
      }),
    replaceAllMatches: z
      .boolean()
      .default(false)
      .meta({
        ...on({ page: ["updateMarkdown"] }),
        title: "Replace All Matches",
        description: "If off, Notion fails when the text to find is in the page more than once",
      }),
    allowDeletingContent: z
      .boolean()
      .default(false)
      .meta({
        ...on({ page: ["updateMarkdown"] }),
        title: "Allow Deleting Content",
        description: "Let the update delete child pages and child databases",
      }),
    blockType: z
      .enum(BLOCK_TYPES)
      .default("paragraph")
      .meta({
        ...content,
        title: "Block Type",
        labels: {
          paragraph: "Paragraph",
          heading_1: "Heading 1",
          heading_2: "Heading 2",
          heading_3: "Heading 3",
          bulleted_list_item: "Bulleted List Item",
          numbered_list_item: "Numbered List Item",
          to_do: "To-do",
          toggle: "Toggle",
          quote: "Quote",
          callout: "Callout",
          code: "Code",
          divider: "Divider",
        },
        hints: {
          paragraph: "Plain text",
          heading_1: "A large heading",
          heading_2: "A medium heading",
          heading_3: "A small heading",
          bulleted_list_item: "One item of a bulleted list",
          numbered_list_item: "One item of a numbered list",
          to_do: "A task with a check box",
          toggle: "A line that opens and closes",
          quote: "A quote",
          callout: "A text in a colored box",
          code: "A block of code",
          divider: "A horizontal line. It has no text",
        },
      }),
    text: z
      .string()
      .optional()
      .meta({
        ...content,
        ui: "textarea",
        description:
          "The text of one block of the Block Type. A text that is longer than 2000 characters becomes more rich text parts",
      }),
    children: z
      .string()
      .optional()
      .meta({
        ...content,
        title: "Content Blocks (JSON)",
        ui: "code",
        description:
          'Use this for more than one block, or for other block types. It replaces Text. A JSON array of blocks. Use 100 blocks at most. For example [{"type":"paragraph","paragraph":{"rich_text":[{"text":{"content":"Hi"}}]}}]',
      }),
    // databases
    databaseId: z
      .string()
      .optional()
      .meta({
        ...on({ database: ["get"] }),
        title: "Database ID",
        description: "The result shows the data sources of the database, each with an ID",
      }),
    dataSourceId: z
      .string()
      .optional()
      .meta({
        ...on({ database: ["getDataSource", "query", "createRow"] }),
        title: "Data Source ID",
        description: "The data source of a database. Use Get on the database to see the IDs",
      }),
    filter: z
      .string()
      .optional()
      .meta({
        ...on({ database: ["query"] }),
        ui: "code",
        description:
          'A Notion filter as a JSON object. For example {"property":"Status","select":{"equals":"Done"}}',
      }),
    filters: z
      .object({
        createdAfter: z.string().meta({
          title: "Created After",
          description: "A date or a date and time in ISO 8601, such as 2026-01-31",
        }),
        createdBefore: z.string().meta({
          title: "Created Before",
          description: "A date or a date and time in ISO 8601",
        }),
        editedAfter: z.string().meta({
          title: "Edited After",
          description: "A date or a date and time in ISO 8601",
        }),
        editedBefore: z.string().meta({
          title: "Edited Before",
          description: "A date or a date and time in ISO 8601",
        }),
      })
      .partial()
      .default({})
      .meta({
        ...on({ database: ["query"] }),
        description: "Simple filters on the times. The node adds them to the Filter with AND",
      }),
    sorts: z
      .string()
      .optional()
      .meta({
        ...on({ database: ["query"] }),
        ui: "code",
        description:
          'A JSON array. For example [{"property":"Name","direction":"ascending"}] or [{"timestamp":"last_edited_time","direction":"descending"}]',
      }),
    // blocks
    blockId: z
      .string()
      .optional()
      .meta({
        ...on({ block: ["get", "getChildren", "append", "delete"] }),
        title: "Block ID",
        description: "The ID of a block. For Get Children and Append, you can use a page ID",
      }),
    afterBlockId: z
      .string()
      .optional()
      .meta({
        ...on({ block: ["append"] }),
        title: "After Block ID",
        description:
          "Add the new blocks after this child block. If empty, the node adds them at the end",
      }),
    recursive: z
      .boolean()
      .default(false)
      .meta({
        ...on({ block: ["getChildren"] }),
        title: "Get Nested Blocks",
        description: "Also get the children of each block that has children, as `children`",
      }),
    maxDepth: z
      .number()
      .int()
      .min(1)
      .max(MAX_DEPTH)
      .default(MAX_DEPTH)
      .meta({
        showWhen: [{ resource: ["block"], operation: ["getChildren"], recursive: [true] }],
        title: "Max Depth",
        description: `The number of levels below the first level. At most ${MAX_DEPTH}`,
      }),
    // users
    userId: z
      .string()
      .optional()
      .meta({ ...on({ user: ["get"] }), title: "User ID", description: "The ID of the user" }),
    // lists
    returnAll: z.boolean().default(false).meta(isList),
    limit: z
      .number()
      .int()
      .min(1)
      .max(5000)
      .default(50)
      .meta({
        showWhen: [
          { resource: ["search"], operation: ["search"], returnAll: [false] },
          { resource: ["database"], operation: ["list", "query"], returnAll: [false] },
          { resource: ["block"], operation: ["getChildren"], returnAll: [false] },
          { resource: ["user"], operation: ["list"], returnAll: [false] },
        ],
      }),
    simplify: z.boolean().default(true).meta({
      description:
        "Give the main values, such as the text of a title, and not the full Notion data. Turn it off to get the raw data",
    }),
    timeoutMs: z.number().int().min(1).max(300_000).default(30_000),
  })
  .superRefine((config, context) => {
    const operations: readonly string[] = OPERATIONS_OF[config.resource];
    if (!operations.includes(config.operation)) {
      context.addIssue({
        code: "custom",
        path: ["operation"],
        message: `"${config.operation}" is not an operation of "${config.resource}"`,
      });
    }
  });

export type NotionConfig = z.output<typeof notionConfig>;
