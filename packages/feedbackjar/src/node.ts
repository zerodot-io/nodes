// SPDX-License-Identifier: AGPL-3.0-only
import { defineNode } from "@zerodot/node-sdk";
import {
  callFeedbackjar,
  callFeedbackjarList,
  FEEDBACKJAR_CREDENTIAL,
  feedbackjarAccess,
} from "./api";
import { feedbackjarConfig } from "./config";
import { FEEDBACKJAR_ICON } from "./icon";
import { buildRequest } from "./request";

export default defineNode({
  type: "feedbackjar.api",
  label: "FeedbackJar",
  description: "Work with feedback posts, comments, votes, boards, and tags in FeedbackJar",
  category: "integration",
  app: "FeedbackJar",
  // The names of the actions of the FeedbackJar node.
  actions: [
    { label: "Get many organizations", config: { resource: "organization", operation: "getAll" } },
    { label: "Get many boards", config: { resource: "board", operation: "getAll" } },
    { label: "Get a board", config: { resource: "board", operation: "get" } },
    { label: "Get many tags", config: { resource: "tag", operation: "getAll" } },
    { label: "Create a post", config: { resource: "post", operation: "create" } },
    { label: "Get a post", config: { resource: "post", operation: "get" } },
    { label: "Get many posts", config: { resource: "post", operation: "getAll" } },
    { label: "Search posts", config: { resource: "post", operation: "search" } },
    { label: "Update a post", config: { resource: "post", operation: "update" } },
    {
      label: "Update the status of a post",
      config: { resource: "post", operation: "updateStatus" },
    },
    { label: "Set the tags of a post", config: { resource: "post", operation: "setTags" } },
    { label: "Merge a post into another post", config: { resource: "post", operation: "merge" } },
    { label: "Get the comments of a post", config: { resource: "comment", operation: "getAll" } },
    { label: "Reply to a post", config: { resource: "comment", operation: "create" } },
    { label: "Vote on a post for a person", config: { resource: "vote", operation: "create" } },
  ],
  icon: "MessageSquare",
  iconUrl: FEEDBACKJAR_ICON,
  config: feedbackjarConfig,
  defaultConfig: {
    resource: "post",
    operation: "getAll",
    sortBy: "voteCount",
    sortOrder: "desc",
    notifyAuthor: true,
    returnAll: false,
    limit: 50,
    searchLimit: 20,
    timeoutMs: 30_000,
  },
  credentialTypes: [FEEDBACKJAR_CREDENTIAL],
  ports: { in: ["in"], out: ["out"] },
  subtitle: (config) =>
    typeof config.operation === "string"
      ? `${String(config.resource ?? "post")}: ${config.operation}`
      : undefined,
  async run({ config, credential, signal }) {
    // The list of projects is the only call that works with no project ID.
    const access = feedbackjarAccess(credential, {
      needsOrganization: config.resource !== "organization",
    });
    const options = { signal, timeoutMs: config.timeoutMs };
    const request = buildRequest(config);

    if (request.list) {
      const items = await callFeedbackjarList(
        access,
        request,
        config.returnAll ? null : config.limit,
        options,
      );
      return { port: "out", data: items };
    }

    const data = await callFeedbackjar(access, request, options);
    return { port: "out", data: data ?? { success: true } };
  },
});
