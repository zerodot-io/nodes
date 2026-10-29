// SPDX-License-Identifier: AGPL-3.0-only
import { z } from "zod";

// Resource and operation names follow the FeedbackJar REST API and the MCP server.

export const RESOURCES = ["organization", "board", "tag", "post", "comment", "vote"] as const;
export type Resource = (typeof RESOURCES)[number];

export const OPERATIONS_OF = {
  organization: ["getAll"],
  board: ["getAll", "get"],
  tag: ["getAll"],
  post: ["create", "get", "getAll", "search", "update", "updateStatus", "setTags", "merge"],
  comment: ["getAll", "create"],
  vote: ["create"],
} as const satisfies Record<Resource, readonly string[]>;

const ALL_OPERATIONS = [...new Set(Object.values(OPERATIONS_OF).flat())] as [string, ...string[]];

export const POST_TYPES = [
  "BUG",
  "FEATURE_REQUEST",
  "FEEDBACK",
  "QUESTION",
  "IDEA",
  "REVIEW",
] as const;
export const STATUSES = ["OPEN", "IN_PROGRESS", "COMPLETED", "CLOSED"] as const;
export const FILTER_STATUSES = [...STATUSES, "PENDING", "MERGED"] as const;
export const VISIBILITIES = ["PUBLIC", "UNLISTED", "PRIVATE"] as const;

/** Show a field only for these operations of a resource. */
const on = (resource: Resource, ...operations: string[]) => ({
  showWhen: { resource: [resource], operation: operations },
});

const POST_ID_OPERATIONS = ["get", "update", "updateStatus", "setTags", "merge"];

const typeLabels = {
  BUG: "Bug",
  FEATURE_REQUEST: "Feature Request",
  FEEDBACK: "Feedback",
  QUESTION: "Question",
  IDEA: "Idea",
  REVIEW: "Review",
};

const statusLabels = {
  OPEN: "Open",
  IN_PROGRESS: "In Progress",
  COMPLETED: "Completed",
  CLOSED: "Closed",
};

export const feedbackjarConfig = z
  .object({
    resource: z
      .enum(RESOURCES)
      .default("post")
      .meta({
        labels: {
          organization: "Organization",
          board: "Board",
          tag: "Tag",
          post: "Post",
          comment: "Comment",
          vote: "Vote",
        },
        hints: {
          organization: "List the projects of an account token",
          board: "Get the boards of the project",
          tag: "Get the tags of the project",
          post: "Create, find, change, tag, or merge feedback posts",
          comment: "Get the comments of a post or reply to a post",
          vote: "Vote on a post for another person",
        },
      }),
    operation: z
      .enum(ALL_OPERATIONS)
      .default("getAll")
      .meta({
        labels: {
          getAll: "Get Many",
          get: "Get",
          create: "Create",
          search: "Search",
          update: "Update",
          updateStatus: "Update Status",
          setTags: "Set Tags",
          merge: "Merge",
        },
        hints: {
          getAll: "Get all items, or use filters",
          get: "Get one item",
          create: "Create a new item",
          search: "Find posts by a word in the title or the text",
          update: "Change the title, text, type, status, visibility, or board of a post",
          updateStatus: "Change the status of a post",
          setTags: "Replace the tags of a post",
          merge: "Merge a duplicate post into another post",
        },
      }),
    // posts
    postId: z
      .string()
      .optional()
      .meta({
        title: "Post ID",
        showWhen: {
          resource: ["post", "comment", "vote"],
          operation: [...POST_ID_OPERATIONS, "getAll", "create"],
        },
        description: "For a merge, this is the duplicate post that goes away",
      }),
    targetId: z
      .string()
      .optional()
      .meta({
        ...on("post", "merge"),
        title: "Target Post ID",
        description: "The post to merge into. The votes move to this post",
      }),
    boardId: z
      .string()
      .optional()
      .meta({
        title: "Board ID",
        showWhen: { resource: ["board", "post"], operation: ["get", "create", "getAll", "update"] },
        description: "Create: the board for the post. List: only posts of this board",
      }),
    title: z
      .string()
      .optional()
      .meta(on("post", "create", "update")),
    content: z
      .string()
      .optional()
      .meta({
        showWhen: { resource: ["post", "comment"], operation: ["create", "update"] },
        ui: "textarea",
      }),
    postType: z
      .enum(POST_TYPES)
      .optional()
      .meta({
        ...on("post", "create", "update", "getAll"),
        title: "Type",
        labels: typeLabels,
        description: "Create: empty means Feature Request",
      }),
    visibility: z
      .enum(VISIBILITIES)
      .optional()
      .meta({
        ...on("post", "create", "update"),
        labels: { PUBLIC: "Public", UNLISTED: "Unlisted", PRIVATE: "Private" },
        hints: {
          PUBLIC: "Everyone can see the post on the board",
          UNLISTED: "Only people with the link can see the post",
          PRIVATE: "Only the team can see the post",
        },
      }),
    status: z
      .enum(STATUSES)
      .optional()
      .meta({ ...on("post", "update", "updateStatus"), labels: statusLabels }),
    filterStatus: z
      .enum(FILTER_STATUSES)
      .optional()
      .meta({
        ...on("post", "getAll"),
        title: "Status",
        labels: { ...statusLabels, PENDING: "Pending", MERGED: "Merged" },
        description: "Empty means all posts except Pending and Merged",
      }),
    sortBy: z
      .enum(["voteCount", "createdAt", "updatedAt"])
      .default("voteCount")
      .meta({
        ...on("post", "getAll"),
        title: "Sort By",
        labels: { voteCount: "Votes", createdAt: "Created", updatedAt: "Updated" },
      }),
    sortOrder: z
      .enum(["desc", "asc"])
      .default("desc")
      .meta({
        ...on("post", "getAll"),
        title: "Sort Order",
        labels: { desc: "Descending", asc: "Ascending" },
      }),
    query: z
      .string()
      .optional()
      .meta({ ...on("post", "search"), title: "Search Text" }),
    tagIds: z
      .string()
      .optional()
      .meta({
        ...on("post", "setTags"),
        title: "Tag IDs",
        description: "IDs with commas between. Empty removes all tags",
      }),
    // who the post or vote is for
    onBehalfOfEmail: z
      .string()
      .optional()
      .meta({
        ...on("post", "create"),
        title: "On Behalf Of (Email)",
        description:
          "File the post as this person. FeedbackJar adds the person as a member if needed. Needs an owner or admin",
      }),
    onBehalfOfName: z
      .string()
      .optional()
      .meta({ ...on("post", "create"), title: "On Behalf Of (Name)" }),
    notifyAuthor: z
      .boolean()
      .default(true)
      .meta({
        ...on("post", "create"),
        title: "Notify Author",
        description: "Only with On Behalf Of. Off: no email for comments and status changes",
      }),
    email: z
      .string()
      .optional()
      .meta({
        ...on("vote", "create"),
        description: "The email of the person that the vote is for",
      }),
    name: z
      .string()
      .optional()
      .meta({
        ...on("vote", "create"),
        description: "The name of the person, if the person is not a member yet",
      }),
    // lists
    returnAll: z
      .boolean()
      .default(false)
      .meta({ ...on("post", "getAll") }),
    limit: z
      .number()
      .int()
      .min(1)
      .max(5000)
      .default(50)
      .meta({
        showWhen: { resource: ["post"], operation: ["getAll"], returnAll: [false] },
      }),
    searchLimit: z
      .number()
      .int()
      .min(1)
      .max(100)
      .default(20)
      .meta({ ...on("post", "search"), title: "Limit" }),
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

export type FeedbackjarConfig = z.output<typeof feedbackjarConfig>;
