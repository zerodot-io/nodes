// SPDX-License-Identifier: AGPL-3.0-only
import { defineNode } from "@zerodot/node-sdk";
import {
  callGraph,
  MAX_WAIT_MS,
  META_CREDENTIAL,
  type MetaAccess,
  metaAccess,
  waitUntilFinished,
} from "./api";
import { type MetaConfig, metaConfig } from "./config";
import { META_ICON } from "./icon";
import {
  buildContainerStatus,
  buildCreateContainer,
  buildCreateThreadsContainer,
  buildFacebookPublish,
  buildInstagramAccount,
  buildPageInfo,
  buildPublishContainer,
  buildQuota,
  buildThreadsProfile,
} from "./request";

/** How long one Graph call of the publish flow may take, at most. */
const STEP_TIMEOUT_MS = 60_000;

/** The cleaned ID of a container or post answer. */
const idOf = (answer: Record<string, unknown>): string => {
  if (typeof answer.id !== "string" || answer.id === "") {
    throw new Error("The Graph API did not give a media ID");
  }
  return answer.id;
};

const need = (value: string | undefined, name: string, label: string): string => {
  if (value === undefined || value.trim() === "") throw new Error(`Meta ${label} needs "${name}"`);
  return value.trim();
};

/** The wait options of the publish flow, out of the config. */
const waitOptionsOf = (c: MetaConfig, signal: AbortSignal) => ({
  signal,
  timeoutMs: Math.min(c.timeoutMs, STEP_TIMEOUT_MS),
  maxWaitMs: Math.min(c.maxWaitMs, MAX_WAIT_MS),
  intervalMs: c.pollIntervalMs,
});

/** The status fields of a container answer, without the ID. */
const statusData = (id: string, raw: Record<string, unknown>) => {
  const { id: _id, ...rest } = raw;
  return { id, ...rest };
};

export default defineNode({
  type: "meta.api",
  label: "Meta",
  description:
    "Publish reels, photos, carousels, and stories to Instagram, posts to Facebook Pages, and text, images, carousels, and videos to Threads, and check publishing quotas",
  category: "integration",
  app: "Meta",
  // The names of the actions of the Meta node.
  actions: [
    { label: "Publish to Instagram", config: { resource: "instagram", operation: "publish" } },
    {
      label: "Create an Instagram media container",
      config: { resource: "instagram", operation: "createContainer" },
    },
    {
      label: "Check an Instagram media container",
      config: { resource: "instagram", operation: "checkContainer" },
    },
    {
      label: "Publish an Instagram media container",
      config: { resource: "instagram", operation: "publishContainer" },
    },
    {
      label: "Get the Instagram publishing quota",
      config: { resource: "instagram", operation: "getQuota" },
    },
    {
      label: "Get Instagram account info",
      config: { resource: "instagram", operation: "getAccount" },
    },
    { label: "Publish to a Facebook Page", config: { resource: "facebook", operation: "publish" } },
    { label: "Get Facebook Page info", config: { resource: "facebook", operation: "getPage" } },
    { label: "Publish to Threads", config: { resource: "threads", operation: "publish" } },
    {
      label: "Check a Threads media container",
      config: { resource: "threads", operation: "checkContainer" },
    },
    {
      label: "Publish a Threads media container",
      config: { resource: "threads", operation: "publishContainer" },
    },
    { label: "Get Threads profile", config: { resource: "threads", operation: "getProfile" } },
  ],
  icon: "Share2Icon",
  iconUrl: META_ICON,
  config: metaConfig,
  defaultConfig: {
    resource: "instagram",
    operation: "publish",
    apiVersion: "v23.0",
    instagramMediaType: "reel",
    facebookMediaType: "text",
    threadsMediaType: "text",
    shareToFeed: true,
    pollIntervalMs: 5000,
    maxWaitMs: 300_000,
    timeoutMs: 30_000,
  },
  credentialTypes: [META_CREDENTIAL],
  ports: { in: ["in"], out: ["out"] },
  subtitle: (config) =>
    typeof config.operation === "string"
      ? `${String(config.resource ?? "instagram")}: ${config.operation}`
      : undefined,
  async run({ config, credential, signal }) {
    const access: MetaAccess = metaAccess(credential);
    const c: MetaConfig = config;
    const options = { signal, timeoutMs: c.timeoutMs };

    if (c.resource === "instagram") {
      switch (c.operation) {
        case "publish": {
          // Create the container, wait until Meta has the media, and publish it.
          const container = idOf(await callGraph(access, buildCreateContainer(c), options));
          await waitUntilFinished(
            access,
            buildContainerStatus(c, container),
            waitOptionsOf(c, signal),
          );
          const post = await callGraph(access, buildPublishContainer(c, container), options);
          return { port: "out", data: { containerId: container, id: idOf(post) } };
        }
        case "createContainer":
          return {
            port: "out",
            data: { id: idOf(await callGraph(access, buildCreateContainer(c), options)) },
          };
        case "checkContainer":
          return {
            port: "out",
            data: statusData(
              need(c.containerId, "containerId", "instagram.checkContainer"),
              await callGraph(
                access,
                buildContainerStatus(
                  c,
                  need(c.containerId, "containerId", "instagram.checkContainer"),
                ),
                options,
              ),
            ),
          };
        case "publishContainer":
          return {
            port: "out",
            data: {
              id: idOf(
                await callGraph(
                  access,
                  buildPublishContainer(
                    c,
                    need(c.creationId, "creationId", "instagram.publishContainer"),
                  ),
                  options,
                ),
              ),
            },
          };
        case "getQuota":
          return { port: "out", data: await callGraph(access, buildQuota(c), options) };
        case "getAccount":
          return { port: "out", data: await callGraph(access, buildInstagramAccount(c), options) };
      }
    }

    if (c.resource === "facebook") {
      switch (c.operation) {
        case "publish":
          return { port: "out", data: await callGraph(access, buildFacebookPublish(c), options) };
        case "getPage":
          return { port: "out", data: await callGraph(access, buildPageInfo(c), options) };
      }
    }

    if (c.resource === "threads") {
      switch (c.operation) {
        case "publish": {
          // Text and image publish right away, but a video or carousel is ready only after a wait.
          const container = idOf(await callGraph(access, buildCreateThreadsContainer(c), options));
          if (c.threadsMediaType === "video" || c.threadsMediaType === "carousel") {
            await waitUntilFinished(
              access,
              buildContainerStatus(c, container),
              waitOptionsOf(c, signal),
            );
          }
          const post = await callGraph(access, buildPublishContainer(c, container), options);
          return { port: "out", data: { containerId: container, id: idOf(post) } };
        }
        case "checkContainer":
          return {
            port: "out",
            data: statusData(
              need(c.containerId, "containerId", "threads.checkContainer"),
              await callGraph(
                access,
                buildContainerStatus(
                  c,
                  need(c.containerId, "containerId", "threads.checkContainer"),
                ),
                options,
              ),
            ),
          };
        case "publishContainer":
          return {
            port: "out",
            data: {
              id: idOf(
                await callGraph(
                  access,
                  buildPublishContainer(
                    c,
                    need(c.creationId, "creationId", "threads.publishContainer"),
                  ),
                  options,
                ),
              ),
            },
          };
        case "getProfile":
          return { port: "out", data: await callGraph(access, buildThreadsProfile(c), options) };
      }
    }
    throw new Error(`Unknown Meta operation "${c.resource}.${c.operation}"`);
  },
});
