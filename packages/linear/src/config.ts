// SPDX-License-Identifier: AGPL-3.0-only
import { z } from "zod";

// Resource and operation names follow the Linear GraphQL API.

export const RESOURCES = [
  "issue",
  "comment",
  "project",
  "team",
  "workflowState",
  "label",
  "user",
  "cycle",
] as const;
export type Resource = (typeof RESOURCES)[number];

export const OPERATIONS_OF = {
  issue: ["create", "get", "getAll", "update", "archive", "delete"],
  comment: ["create", "getAll"],
  project: ["create", "get", "getAll"],
  team: ["getAll"],
  workflowState: ["getAll"],
  label: ["getAll"],
  user: ["getAll"],
  cycle: ["getAll"],
} as const satisfies Record<Resource, readonly string[]>;

const ALL_OPERATIONS = [...new Set(Object.values(OPERATIONS_OF).flat())] as [string, ...string[]];

export const AUTHENTICATION = ["apiKey", "oAuth2"] as const;

/** Show a field only for these operations of a resource. */
const on = (resource: Resource, ...operations: string[]) => ({
  showWhen: { resource: [resource], operation: operations },
});

/** The operations that return a list. */
const LIST_RESOURCES = [...RESOURCES];
const LIST_SHOW = { resource: LIST_RESOURCES, operation: ["getAll"] };

export const linearConfig = z
  .object({
    authentication: z
      .enum(AUTHENTICATION)
      .default("apiKey")
      .meta({
        title: "Authentication",
        labels: { apiKey: "API Key", oAuth2: "OAuth2" },
        hints: {
          apiKey: "A personal API key",
          oAuth2: "Sign in with a Linear account",
        },
      }),
    resource: z
      .enum(RESOURCES)
      .default("issue")
      .meta({
        labels: {
          issue: "Issue",
          comment: "Comment",
          project: "Project",
          team: "Team",
          workflowState: "Workflow State",
          label: "Label",
          user: "User",
          cycle: "Cycle",
        },
        hints: {
          issue: "Create, get, list, update, archive, or delete an issue",
          comment: "Create a comment on an issue or list the comments of an issue",
          project: "Create a project, get one project, or list projects",
          team: "List the teams",
          workflowState: "List the workflow states, for example Todo or Done",
          label: "List the issue labels",
          user: "List the users of the workspace",
          cycle: "List the cycles",
        },
      }),
    operation: z
      .enum(ALL_OPERATIONS)
      .default("get")
      .meta({
        labels: {
          create: "Create",
          get: "Get",
          getAll: "Get Many",
          update: "Update",
          archive: "Archive",
          delete: "Delete",
        },
        hints: {
          create: "Create a new item",
          get: "Get one item",
          getAll: "Get many items",
          update: "Change an existing item",
          archive: "Archive an item. You can restore it later",
          delete: "Move an item to the trash",
        },
      }),
    issueId: z
      .string()
      .optional()
      .meta({
        showWhen: {
          resource: ["issue", "comment"],
          operation: ["get", "update", "archive", "delete", "create", "getAll"],
        },
        title: "Issue",
        description: "The ID or the identifier of the issue, for example ENG-123",
      }),
    projectId: z
      .string()
      .optional()
      .meta({
        showWhen: {
          resource: ["project", "issue"],
          operation: ["get", "create", "update", "getAll"],
        },
        title: "Project ID",
        description: "For a project: the ID to get. For an issue: the project of the issue",
      }),
    teamId: z
      .string()
      .optional()
      .meta({
        showWhen: {
          resource: ["issue", "workflowState", "label", "cycle"],
          operation: ["create", "getAll"],
        },
        title: "Team ID",
        description: "Needed to create an issue. On a list, empty means all teams",
      }),
    teamIds: z
      .string()
      .optional()
      .meta({
        ...on("project", "create"),
        title: "Team IDs",
        description: "Team IDs with commas between. A project needs one team or more",
      }),
    // issues, comments, projects
    title: z
      .string()
      .optional()
      .meta(on("issue", "create", "update")),
    name: z.string().optional().meta(on("project", "create")),
    description: z
      .string()
      .optional()
      .meta({ ...on("issue", "create", "update"), description: "Markdown text" }),
    projectDescription: z
      .string()
      .optional()
      .meta({ ...on("project", "create"), title: "Description" }),
    body: z
      .string()
      .optional()
      .meta({ ...on("comment", "create"), description: "Markdown text" }),
    priority: z
      .enum(["0", "1", "2", "3", "4"])
      .optional()
      .meta({
        showWhen: { resource: ["issue"], operation: ["create", "update", "getAll"] },
        labels: { "0": "No Priority", "1": "Urgent", "2": "High", "3": "Medium", "4": "Low" },
        hints: {
          "0": "The issue has no priority",
          "1": "Do it first",
          "2": "Do it soon",
          "3": "Do it in normal order",
          "4": "Do it later",
        },
      }),
    assigneeId: z
      .string()
      .optional()
      .meta({
        showWhen: { resource: ["issue"], operation: ["create", "update", "getAll"] },
        title: "Assignee ID",
        description: "The ID of a user",
      }),
    stateId: z
      .string()
      .optional()
      .meta({
        showWhen: { resource: ["issue"], operation: ["create", "update", "getAll"] },
        title: "State ID",
        description: "The ID of a workflow state",
      }),
    labelIds: z
      .string()
      .optional()
      .meta({
        ...on("issue", "create", "update"),
        title: "Label IDs",
        description: "Label IDs with commas between",
      }),
    cycleId: z
      .string()
      .optional()
      .meta({ ...on("issue", "create", "update"), title: "Cycle ID" }),
    dueDate: z
      .string()
      .optional()
      .meta({ ...on("issue", "create", "update"), description: "Date as YYYY-MM-DD" }),
    search: z
      .string()
      .optional()
      .meta({
        ...on("issue", "getAll"),
        description: "Show only issues with this text in the title",
      }),
    filter: z
      .string()
      .optional()
      .meta({
        ...on("issue", "getAll"),
        ui: "code",
        description: "JSON object for the Linear issue filter. It adds to the fields above",
      }),
    permanent: z
      .boolean()
      .default(false)
      .meta({
        ...on("issue", "delete"),
        description: "Delete the issue for good. If off, it goes to the trash",
      }),
    // lists
    returnAll: z.boolean().default(false).meta({ showWhen: LIST_SHOW }),
    limit: z
      .number()
      .int()
      .min(1)
      .max(5000)
      .default(50)
      .meta({ showWhen: { ...LIST_SHOW, returnAll: [false] } }),
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

export type LinearConfig = z.output<typeof linearConfig>;
