// SPDX-License-Identifier: AGPL-3.0-only
import type { FeedbackjarRequest } from "./api";
import type { FeedbackjarConfig } from "./config";

const seg = encodeURIComponent;

const list = (text: string | undefined): string[] => {
  const items = text
    ?.split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  return items ?? [];
};

const need = <T>(value: T | undefined, name: string, operation: string): T => {
  if (value === undefined || value === "") throw new Error(`"${name}" is needed to ${operation}`);
  return value;
};

const compact = (body: Record<string, unknown>) =>
  Object.fromEntries(
    Object.entries(body).filter(([, value]) => value !== undefined && value !== ""),
  );

/** The API call for one operation, without the network. A list of posts returns `list: true`. */
export function buildRequest(c: FeedbackjarConfig): FeedbackjarRequest & { list?: boolean } {
  const op = `${c.resource}.${c.operation}`;
  const post = () => `/posts/${seg(need(c.postId, "postId", op))}`;

  switch (op) {
    case "organization.getAll":
      return { method: "GET", path: "/organizations" };

    case "board.getAll":
      return { method: "GET", path: "/boards" };
    case "board.get":
      return { method: "GET", path: `/boards/${seg(need(c.boardId, "boardId", op))}` };

    case "tag.getAll":
      return { method: "GET", path: "/tags" };

    case "post.create":
      return {
        method: "POST",
        path: "/posts",
        body: compact({
          boardId: need(c.boardId, "boardId", op),
          title: need(c.title, "title", op),
          content: need(c.content, "content", op),
          type: c.postType,
          visibility: c.visibility,
          onBehalfOfEmail: c.onBehalfOfEmail,
          onBehalfOfName: c.onBehalfOfName,
          // The default is true, so only a false value goes to the API.
          notifyAuthor: c.onBehalfOfEmail && !c.notifyAuthor ? false : undefined,
        }),
      };
    case "post.get":
      return { method: "GET", path: post() };
    case "post.getAll":
      return {
        method: "GET",
        path: "/posts",
        query: {
          status: c.filterStatus,
          type: c.postType,
          boardId: c.boardId,
          sortBy: c.sortBy,
          sortOrder: c.sortOrder,
        },
        list: true,
      };
    case "post.search":
      return {
        method: "GET",
        path: "/posts/search",
        query: { q: need(c.query, "query", op), limit: c.searchLimit },
      };
    case "post.update": {
      const body = compact({
        title: c.title,
        content: c.content,
        type: c.postType,
        status: c.status,
        visibility: c.visibility,
        boardId: c.boardId,
      });
      if (Object.keys(body).length === 0) throw new Error(`A field to change is needed to ${op}`);
      return { method: "PATCH", path: post(), body };
    }
    case "post.updateStatus":
      return {
        method: "PATCH",
        path: `${post()}/status`,
        body: { status: need(c.status, "status", op) },
      };
    case "post.setTags":
      return { method: "PUT", path: `${post()}/tags`, body: { tagIds: list(c.tagIds) } };
    case "post.merge":
      return {
        method: "POST",
        path: `${post()}/merge`,
        body: { targetId: need(c.targetId, "targetId", op) },
      };

    case "comment.getAll":
      return { method: "GET", path: `${post()}/comments` };
    case "comment.create":
      return {
        method: "POST",
        path: `${post()}/comments`,
        body: { content: need(c.content, "content", op) },
      };

    case "vote.create":
      return {
        method: "POST",
        path: `${post()}/votes`,
        body: compact({ email: need(c.email, "email", op), name: c.name }),
      };
  }
  throw new Error(`Unknown FeedbackJar operation "${op}"`);
}
