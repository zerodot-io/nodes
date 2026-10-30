// SPDX-License-Identifier: AGPL-3.0-only
import { defineNode } from "@zerodot/node-sdk";
import {
  at,
  callLinear,
  callLinearList,
  LINEAR_API_KEY_CREDENTIAL,
  LINEAR_OAUTH2_CREDENTIAL,
  linearAccess,
} from "./api";
import { linearConfig } from "./config";
import { LINEAR_ICON } from "./icon";
import { buildRequest } from "./request";

export default defineNode({
  type: "linear.api",
  label: "Linear",
  description: "Work with issues, comments, projects, teams, and cycles in Linear",
  category: "integration",
  app: "Linear",
  // The names of the actions of the Linear node.
  actions: [
    { label: "Create an issue", config: { resource: "issue", operation: "create" } },
    { label: "Get an issue", config: { resource: "issue", operation: "get" } },
    { label: "Get many issues", config: { resource: "issue", operation: "getAll" } },
    { label: "Update an issue", config: { resource: "issue", operation: "update" } },
    { label: "Archive an issue", config: { resource: "issue", operation: "archive" } },
    { label: "Delete an issue", config: { resource: "issue", operation: "delete" } },
    { label: "Create a comment on an issue", config: { resource: "comment", operation: "create" } },
    { label: "Get comments of an issue", config: { resource: "comment", operation: "getAll" } },
    { label: "Create a project", config: { resource: "project", operation: "create" } },
    { label: "Get a project", config: { resource: "project", operation: "get" } },
    { label: "Get many projects", config: { resource: "project", operation: "getAll" } },
    { label: "Get many teams", config: { resource: "team", operation: "getAll" } },
    {
      label: "Get many workflow states",
      config: { resource: "workflowState", operation: "getAll" },
    },
    { label: "Get many labels", config: { resource: "label", operation: "getAll" } },
    { label: "Get many users", config: { resource: "user", operation: "getAll" } },
    { label: "Get many cycles", config: { resource: "cycle", operation: "getAll" } },
  ],
  icon: "CheckListIcon",
  iconUrl: LINEAR_ICON,
  config: linearConfig,
  defaultConfig: {
    authentication: "apiKey",
    resource: "issue",
    operation: "get",
    returnAll: false,
    limit: 50,
    permanent: false,
    timeoutMs: 30_000,
  },
  credentialTypes: [LINEAR_API_KEY_CREDENTIAL, LINEAR_OAUTH2_CREDENTIAL],
  // The Authentication field says which credential type the user picks.
  credentialRules: {
    [LINEAR_API_KEY_CREDENTIAL]: { showWhen: { authentication: ["apiKey"] } },
    [LINEAR_OAUTH2_CREDENTIAL]: { showWhen: { authentication: ["oAuth2"] } },
  },
  ports: { in: ["in"], out: ["out"] },
  subtitle: (config) =>
    typeof config.operation === "string"
      ? `${String(config.resource ?? "issue")}: ${config.operation}`
      : undefined,
  async run({ config, credential, signal }) {
    const access = linearAccess(credential);
    const options = { signal, timeoutMs: config.timeoutMs };
    const request = buildRequest(config);

    if (request.connection) {
      const items = await callLinearList(
        access,
        request,
        config.returnAll ? null : config.limit,
        options,
      );
      return { port: "out", data: items };
    }

    const data = await callLinear(access, request, options);
    const result = request.result ? at(data, request.result) : data;
    // An archive and a delete answer with a flag only.
    if (typeof result === "boolean") return { port: "out", data: { success: result } };
    return { port: "out", data: result ?? null };
  },
});
