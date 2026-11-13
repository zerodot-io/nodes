// SPDX-License-Identifier: AGPL-3.0-only
import { GRAPH_HOST, type GraphRequest, THREADS_HOST, THREADS_VERSION } from "./api";
import type { MetaConfig } from "./config";

const splitUrls = (text: string | undefined): string[] =>
  (text ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

const need = (value: string | undefined, name: string, label: string): string => {
  if (value === undefined || value.trim() === "") throw new Error(`Meta ${label} needs "${name}"`);
  return value.trim();
};

const FACEBOOK_FIELDS = "id,name,username,fan_count,followers_count,link,category";
const INSTAGRAM_FIELDS = "id,username,name,profile_picture_url,followers_count,media_count";
const THREADS_FIELDS = "id,username,threads_profile_picture_url,threads_biography";

/**
 * The media container call for one Instagram post. Photo, reel, story, and carousel differ in
 * `media_type` and in which address field they use.
 */
export function buildCreateContainer(c: MetaConfig): GraphRequest {
  const label = "instagram.createContainer";
  const user = () => need(c.instagramUserId, "instagramUserId", label);
  const version = () => c.apiVersion.trim() || "v23.0";
  const mediaType = c.instagramMediaType;
  const params: Record<string, unknown> = {};
  if (mediaType === "reel") {
    params.media_type = "REELS";
    params.video_url = need(c.mediaUrl, "mediaUrl", label);
    params.share_to_feed = c.shareToFeed;
    params.cover_url = c.coverUrl?.trim();
  } else if (mediaType === "carousel") {
    const children = splitUrls(c.childrenUrls);
    if (children.length < 2)
      throw new Error(`Meta ${label} needs at least two URLs in "childrenUrls"`);
    if (children.length > 10) throw new Error("An Instagram carousel has at most 10 items");
    params.media_type = "CAROUSEL_ALBUM";
    params.children = children.join(",");
    params.caption = c.caption?.trim();
  } else if (mediaType === "story") {
    params.media_type = "STORIES";
    params.image_url = need(c.mediaUrl, "mediaUrl", label);
    params.caption = c.caption?.trim();
  } else {
    params.media_type = "IMAGE";
    params.image_url = need(c.mediaUrl, "mediaUrl", label);
    params.caption = c.caption?.trim();
  }
  return {
    host: GRAPH_HOST,
    version: version(),
    path: `/${user()}/media`,
    method: "POST",
    params,
  };
}

/**
 * The media container call for one Threads post. Text needs no address, an image or video needs
 * one, and a carousel is one container per item plus a link of children.
 */
export function buildCreateThreadsContainer(c: MetaConfig): GraphRequest {
  const label = "threads.createContainer";
  const user = () => need(c.threadsUserId, "threadsUserId", label);
  const mediaType = c.threadsMediaType;
  const params: Record<string, unknown> = { media_type: mediaType.toUpperCase() };
  if (mediaType === "text") {
    params.text = need(c.text, "text", label);
  } else if (mediaType === "carousel") {
    const children = splitUrls(c.childrenUrls);
    if (children.length < 2)
      throw new Error(`Meta ${label} needs at least two URLs in "childrenUrls"`);
    if (children.length > 20) throw new Error("A Threads carousel has at most 20 items");
    params.children = children.join(",");
  } else {
    const key = mediaType === "image" ? "image_url" : "video_url";
    params[key] = need(c.mediaUrl, "mediaUrl", label);
    if (c.text?.trim()) params.text = c.text.trim();
  }
  return {
    host: THREADS_HOST,
    version: THREADS_VERSION,
    path: `/${user()}/threads`,
    method: "POST",
    params,
  };
}

/** The status call of a media container of Instagram or Threads. */
export function buildContainerStatus(c: MetaConfig, containerId: string): GraphRequest {
  const isThreads = c.resource === "threads";
  return {
    host: isThreads ? THREADS_HOST : GRAPH_HOST,
    version: isThreads ? THREADS_VERSION : c.apiVersion.trim() || "v23.0",
    path: `/${need(containerId, "containerId", `${c.resource}.checkContainer`)}`,
    method: "GET",
    params: { fields: "id,status_code,status" },
  };
}

/** The publish call of a finished media container of Instagram or Threads. */
export function buildPublishContainer(c: MetaConfig, creationId: string): GraphRequest {
  const isThreads = c.resource === "threads";
  const label = `${c.resource}.publishContainer`;
  const path = isThreads
    ? `/${need(c.threadsUserId, "threadsUserId", label)}/threads_publish`
    : `/${need(c.instagramUserId, "instagramUserId", label)}/media_publish`;
  return {
    host: isThreads ? THREADS_HOST : GRAPH_HOST,
    version: isThreads ? THREADS_VERSION : c.apiVersion.trim() || "v23.0",
    path,
    method: "POST",
    params: { creation_id: need(creationId, "creationId", label) },
  };
}

/** The quota call. Instagram allows 50 to 100 posts in 24 hours. */
export function buildQuota(c: MetaConfig): GraphRequest {
  const user = need(c.instagramUserId, "instagramUserId", "instagram.getQuota");
  return {
    host: GRAPH_HOST,
    version: c.apiVersion.trim() || "v23.0",
    path: `/${user}/content_publishing_limit`,
    method: "GET",
    params: { fields: "config,quota_total,quota_usage" },
  };
}

/** The account call. An empty user ID uses `/me`. */
export function buildInstagramAccount(c: MetaConfig): GraphRequest {
  const user = c.instagramUserId?.trim() || "me";
  return {
    host: GRAPH_HOST,
    version: c.apiVersion.trim() || "v23.0",
    path: `/${user}`,
    method: "GET",
    params: { fields: INSTAGRAM_FIELDS },
  };
}

/** The publish call for one Facebook Page post: text, photo, or video. */
export function buildFacebookPublish(c: MetaConfig): GraphRequest {
  const label = "facebook.publish";
  const page = need(c.pageId, "pageId", label);
  const mediaType = c.facebookMediaType;
  if (mediaType === "photo") {
    return {
      host: GRAPH_HOST,
      version: c.apiVersion.trim() || "v23.0",
      path: `/${page}/photos`,
      method: "POST",
      params: { url: need(c.mediaUrl, "mediaUrl", label), caption: c.caption?.trim() },
    };
  }
  if (mediaType === "video") {
    return {
      host: GRAPH_HOST,
      version: c.apiVersion.trim() || "v23.0",
      path: `/${page}/videos`,
      method: "POST",
      params: { file_url: need(c.mediaUrl, "mediaUrl", label), description: c.caption?.trim() },
    };
  }
  const message = c.text?.trim();
  if (!message) throw new Error(`Meta ${label} needs "text"`);
  return {
    host: GRAPH_HOST,
    version: c.apiVersion.trim() || "v23.0",
    path: `/${page}/feed`,
    method: "POST",
    params: { message },
  };
}

/** The Page info call. */
export function buildPageInfo(c: MetaConfig): GraphRequest {
  const page = need(c.pageId, "pageId", "facebook.getPage");
  return {
    host: GRAPH_HOST,
    version: c.apiVersion.trim() || "v23.0",
    path: `/${page}`,
    method: "GET",
    params: { fields: FACEBOOK_FIELDS },
  };
}

/** The Threads profile call. `/me` gives the ID of the user that the token is for. */
export function buildThreadsProfile(_c: MetaConfig): GraphRequest {
  return {
    host: THREADS_HOST,
    version: THREADS_VERSION,
    path: "/me",
    method: "GET",
    params: { fields: THREADS_FIELDS },
  };
}
