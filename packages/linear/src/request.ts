// SPDX-License-Identifier: AGPL-3.0-only
import type { LinearRequest } from "./api";
import type { LinearConfig } from "./config";

const list = (text: string | undefined): string[] | undefined => {
  const items = text
    ?.split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  return items && items.length > 0 ? items : undefined;
};

const need = <T>(value: T | undefined, name: string, operation: string): T => {
  if (value === undefined || value === "") throw new Error(`"${name}" is needed to ${operation}`);
  return value;
};

const compact = (body: Record<string, unknown>) =>
  Object.fromEntries(Object.entries(body).filter(([, value]) => value !== undefined));

const parseFilter = (text: string | undefined): Record<string, unknown> => {
  if (!text?.trim()) return {};
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error('"filter" must be a JSON object');
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error('"filter" must be a JSON object');
  }
  return value as Record<string, unknown>;
};

const idIs = (id: string | undefined) => (id ? { id: { eq: id } } : undefined);

const ISSUE_FIELDS = `
  id identifier number title description priority priorityLabel url dueDate
  createdAt updatedAt archivedAt completedAt canceledAt
  state { id name type }
  team { id key name }
  assignee { id name email }
  creator { id name }
  project { id name }
  cycle { id number name }
  labels { nodes { id name } }
`;

const PROJECT_FIELDS = `
  id name description url state progress startDate targetDate createdAt updatedAt
  lead { id name }
  teams { nodes { id key name } }
`;

const PAGE_INFO = "pageInfo { hasNextPage endCursor }";

/** A list query. `name` is the root field, `fields` is what to ask for each item. */
const listQuery = (name: string, fields: string, filter: boolean): LinearRequest => ({
  query: `query ($first: Int!, $after: String${filter ? `, $filter: ${filterType(name)}` : ""}) {
  ${name}(first: $first, after: $after${filter ? ", filter: $filter" : ""}) {
    nodes { ${fields} }
    ${PAGE_INFO}
  }
}`,
  connection: name,
});

const filterType = (name: string) =>
  ({
    issues: "IssueFilter",
    workflowStates: "WorkflowStateFilter",
    issueLabels: "IssueLabelFilter",
    cycles: "CycleFilter",
  })[name] ?? "";

const teamFilter = (teamId: string | undefined) =>
  teamId ? { filter: { team: idIs(teamId) } } : {};

/** The API call for one operation, without the network. */
export function buildRequest(c: LinearConfig): LinearRequest {
  const op = `${c.resource}.${c.operation}`;
  const issueId = () => need(c.issueId, "issueId", op);

  switch (op) {
    case "issue.create":
      return {
        query: `mutation ($input: IssueCreateInput!) {
  issueCreate(input: $input) { success issue { ${ISSUE_FIELDS} } }
}`,
        variables: {
          input: compact({
            teamId: need(c.teamId, "teamId", op),
            title: need(c.title, "title", op),
            description: c.description,
            priority: c.priority === undefined ? undefined : Number(c.priority),
            assigneeId: c.assigneeId,
            stateId: c.stateId,
            labelIds: list(c.labelIds),
            projectId: c.projectId,
            cycleId: c.cycleId,
            dueDate: c.dueDate,
          }),
        },
        result: "issueCreate.issue",
      };
    case "issue.get":
      return {
        query: `query ($id: String!) { issue(id: $id) { ${ISSUE_FIELDS} } }`,
        variables: { id: issueId() },
        result: "issue",
      };
    case "issue.getAll": {
      const filter = {
        ...compact({
          team: idIs(c.teamId),
          assignee: idIs(c.assigneeId),
          state: idIs(c.stateId),
          project: idIs(c.projectId),
          priority: c.priority === undefined ? undefined : { eq: Number(c.priority) },
          title: c.search ? { containsIgnoreCase: c.search } : undefined,
        }),
        ...parseFilter(c.filter),
      };
      return { ...listQuery("issues", ISSUE_FIELDS, true), variables: { filter } };
    }
    case "issue.update":
      return {
        query: `mutation ($id: String!, $input: IssueUpdateInput!) {
  issueUpdate(id: $id, input: $input) { success issue { ${ISSUE_FIELDS} } }
}`,
        variables: {
          id: issueId(),
          input: compact({
            title: c.title,
            description: c.description,
            priority: c.priority === undefined ? undefined : Number(c.priority),
            assigneeId: c.assigneeId,
            stateId: c.stateId,
            labelIds: list(c.labelIds),
            projectId: c.projectId,
            cycleId: c.cycleId,
            dueDate: c.dueDate,
          }),
        },
        result: "issueUpdate.issue",
      };
    case "issue.archive":
      return {
        query: "mutation ($id: String!) { issueArchive(id: $id) { success } }",
        variables: { id: issueId() },
        result: "issueArchive.success",
      };
    case "issue.delete":
      return {
        query: `mutation ($id: String!, $permanentlyDelete: Boolean) {
  issueDelete(id: $id, permanentlyDelete: $permanentlyDelete) { success }
}`,
        variables: { id: issueId(), permanentlyDelete: c.permanent },
        result: "issueDelete.success",
      };

    case "comment.create":
      return {
        query: `mutation ($input: CommentCreateInput!) {
  commentCreate(input: $input) {
    success
    comment { id body url createdAt updatedAt user { id name } issue { id identifier } }
  }
}`,
        variables: { input: { issueId: issueId(), body: need(c.body, "body", op) } },
        result: "commentCreate.comment",
      };
    case "comment.getAll":
      return {
        query: `query ($id: String!, $first: Int!, $after: String) {
  issue(id: $id) {
    comments(first: $first, after: $after) {
      nodes { id body url createdAt updatedAt user { id name } parent { id } }
      ${PAGE_INFO}
    }
  }
}`,
        variables: { id: issueId() },
        connection: "issue.comments",
      };

    case "project.create":
      return {
        query: `mutation ($input: ProjectCreateInput!) {
  projectCreate(input: $input) { success project { ${PROJECT_FIELDS} } }
}`,
        variables: {
          input: compact({
            name: need(c.name, "name", op),
            teamIds: need(list(c.teamIds), "teamIds", op),
            description: c.projectDescription,
          }),
        },
        result: "projectCreate.project",
      };
    case "project.get":
      return {
        query: `query ($id: String!) { project(id: $id) { ${PROJECT_FIELDS} } }`,
        variables: { id: need(c.projectId, "projectId", op) },
        result: "project",
      };
    case "project.getAll":
      return listQuery("projects", PROJECT_FIELDS, false);

    case "team.getAll":
      return listQuery("teams", "id key name description private createdAt", false);
    case "workflowState.getAll":
      return {
        ...listQuery("workflowStates", "id name type color position team { id key name }", true),
        variables: teamFilter(c.teamId),
      };
    case "label.getAll":
      return {
        ...listQuery("issueLabels", "id name color description team { id key name }", true),
        variables: teamFilter(c.teamId),
      };
    case "user.getAll":
      return listQuery("users", "id name displayName email active admin createdAt", false);
    case "cycle.getAll":
      return {
        ...listQuery(
          "cycles",
          "id number name startsAt endsAt completedAt team { id key name }",
          true,
        ),
        variables: teamFilter(c.teamId),
      };
  }
  throw new Error(`Unknown Linear operation "${op}"`);
}
