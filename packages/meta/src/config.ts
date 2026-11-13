// SPDX-License-Identifier: AGPL-3.0-only
import { z } from "zod";

// Resource and operation names follow the Graph API of Meta.

export const RESOURCES = ["instagram", "facebook", "threads"] as const;
export type Resource = (typeof RESOURCES)[number];

export const OPERATIONS_OF = {
  instagram: [
    "publish",
    "createContainer",
    "checkContainer",
    "publishContainer",
    "getQuota",
    "getAccount",
  ],
  facebook: ["publish", "getPage"],
  threads: ["publish", "checkContainer", "publishContainer", "getProfile"],
} as const satisfies Record<Resource, readonly string[]>;

const ALL_OPERATIONS = [...new Set(Object.values(OPERATIONS_OF).flat())] as [string, ...string[]];

export const IG_MEDIA_TYPES = ["reel", "photo", "carousel", "story"] as const;
export const FB_MEDIA_TYPES = ["text", "photo", "video"] as const;
export const THREADS_MEDIA_TYPES = ["text", "image", "carousel", "video"] as const;

type Operations = { [R in Resource]?: readonly (typeof OPERATIONS_OF)[R][number][] };

/** Show a field for these operations of these resources. */
const on = (operations: Operations) => ({
  showWhen: Object.entries(operations).map(([resource, ops]) => ({
    resource: [resource],
    operation: [...(ops ?? [])],
  })),
});

const hasMedia = on({
  instagram: ["publish"],
  facebook: ["publish"],
  threads: ["publish"],
});

export const metaConfig = z
  .object({
    resource: z
      .enum(RESOURCES)
      .default("instagram")
      .meta({
        labels: { instagram: "Instagram", facebook: "Facebook Page", threads: "Threads" },
        hints: {
          instagram:
            "Publish reels, photos, carousels, and stories to an Instagram business account",
          facebook: "Publish posts, photos, and videos to a Facebook Page",
          threads: "Publish text, images, carousels, and videos to Threads",
        },
      }),
    operation: z
      .enum(ALL_OPERATIONS)
      .default("publish")
      .meta({
        labels: {
          publish: "Publish",
          createContainer: "Create Container",
          checkContainer: "Check Container",
          publishContainer: "Publish Container",
          getQuota: "Get Publishing Quota",
          getAccount: "Get Account Info",
          getPage: "Get Page Info",
          getProfile: "Get Profile",
        },
        hints: {
          publish: "Create the media, wait until it is ready, and publish it in one step",
          createContainer: "Create a media container, for example for a reel",
          checkContainer: "Check the status of a media container",
          publishContainer: "Publish a media container that is finished",
          getQuota: "How many posts this account can still publish in 24 hours",
          getAccount: "The ID, username, and follower count of the Instagram account",
          getPage: "The ID, name, and follower count of the Page",
          getProfile: "The ID, username, and biography of the Threads profile",
        },
      }),
    apiVersion: z
      .string()
      .regex(/^v\d+\.\d+$/)
      .default("v23.0")
      .meta({ description: "The Graph API version, such as v23.0" }),
    instagramUserId: z
      .string()
      .optional()
      .meta({
        ...on({
          instagram: ["publish", "createContainer", "publishContainer", "getQuota", "getAccount"],
        }),
        title: "Instagram Account ID",
        description:
          "ID of the Instagram Business or Creator account. Get it from /me/accounts, or leave empty for getQuota and getAccount to use /me",
      }),
    pageId: z
      .string()
      .optional()
      .meta({
        ...on({ facebook: ["publish", "getPage"] }),
        title: "Page ID",
        description: "ID of the Facebook Page. Get it from /me/accounts",
      }),
    threadsUserId: z
      .string()
      .optional()
      .meta({
        ...on({ threads: ["publish"] }),
        title: "Threads User ID",
        description:
          "ID of the Threads user. Get it from Get Profile. Get Profile itself works without it",
      }),
    // media types
    instagramMediaType: z
      .enum(IG_MEDIA_TYPES)
      .default("reel")
      .meta({
        showWhen: [{ resource: ["instagram"], operation: ["publish"] }],
        title: "Media Type",
        labels: { reel: "Reel", photo: "Photo", carousel: "Carousel", story: "Story" },
        hints: {
          reel: "A short video of up to 15 minutes",
          photo: "One image",
          carousel: "Up to 10 images or videos in one post",
          story: "An image or video that is visible for 24 hours",
        },
      }),
    facebookMediaType: z
      .enum(FB_MEDIA_TYPES)
      .default("text")
      .meta({
        showWhen: [{ resource: ["facebook"], operation: ["publish"] }],
        title: "Media Type",
        labels: { text: "Text Post", photo: "Photo", video: "Video" },
        hints: {
          text: "A post with only text",
          photo: "One image with an optional caption",
          video: "One video with an optional description",
        },
      }),
    threadsMediaType: z
      .enum(THREADS_MEDIA_TYPES)
      .default("text")
      .meta({
        showWhen: [{ resource: ["threads"], operation: ["publish"] }],
        title: "Media Type",
        labels: { text: "Text", image: "Image", carousel: "Carousel", video: "Video" },
        hints: {
          text: "A post with only text",
          image: "One image with optional text",
          carousel: "Up to 20 images or videos in one post",
          video: "One video with optional text",
        },
      }),
    // media content
    mediaUrl: z
      .string()
      .optional()
      .meta({
        ...hasMedia,
        title: "Media URL",
        description:
          "Public HTTPS address of the image or video. A reel needs an MP4 that the Meta servers can download",
        showWhen: [
          {
            resource: ["instagram"],
            operation: ["publish"],
            instagramMediaType: ["reel", "photo", "story"],
          },
          { resource: ["facebook"], operation: ["publish"], facebookMediaType: ["photo", "video"] },
          { resource: ["threads"], operation: ["publish"], threadsMediaType: ["image", "video"] },
        ],
      }),
    coverUrl: z
      .string()
      .optional()
      .meta({
        showWhen: [
          { resource: ["instagram"], operation: ["publish"], instagramMediaType: ["reel"] },
        ],
        title: "Cover URL",
        description: "Public HTTPS address of the thumbnail image. Empty lets Meta pick a frame",
      }),
    childrenUrls: z
      .string()
      .optional()
      .meta({
        showWhen: [
          { resource: ["instagram"], operation: ["publish"], instagramMediaType: ["carousel"] },
          { resource: ["threads"], operation: ["publish"], threadsMediaType: ["carousel"] },
        ],
        title: "Media URLs",
        description:
          "Public HTTPS addresses of the items, with commas between. At most 10 for Instagram, 20 for Threads",
      }),
    caption: z
      .string()
      .optional()
      .meta({
        showWhen: [{ resource: ["instagram"], operation: ["publish"] }],
        ui: "textarea",
        description: "The caption of the post. At most 2200 characters",
      }),
    shareToFeed: z
      .boolean()
      .default(true)
      .meta({
        showWhen: [
          { resource: ["instagram"], operation: ["publish"], instagramMediaType: ["reel"] },
        ],
        description: "Also show the reel in the feed. Off shows it only in Reels",
      }),
    text: z
      .string()
      .optional()
      .meta({
        showWhen: [
          { resource: ["facebook"], operation: ["publish"] },
          { resource: ["threads"], operation: ["publish"] },
        ],
        ui: "textarea",
        description: "The text of the post. At most 500 characters for Threads",
      }),
    // containers
    containerId: z
      .string()
      .optional()
      .meta({
        ...on({ instagram: ["checkContainer"], threads: ["checkContainer"] }),
        title: "Container ID",
        description: "The ID that Create Container gave",
      }),
    creationId: z
      .string()
      .optional()
      .meta({
        ...on({ instagram: ["publishContainer"], threads: ["publishContainer"] }),
        title: "Container ID",
        description: "The ID that Create Container gave, after Check Container said FINISHED",
      }),
    // waiting for the media to be ready
    pollIntervalMs: z
      .number()
      .int()
      .min(1000)
      .max(60_000)
      .default(5000)
      .meta({
        showWhen: [
          { resource: ["instagram"], operation: ["publish"] },
          { resource: ["threads"], operation: ["publish"] },
        ],
        title: "Poll Interval",
        description: "The seconds between status checks, times 1000",
      }),
    maxWaitMs: z
      .number()
      .int()
      .min(1000)
      .max(3_600_000)
      .default(300_000)
      .meta({
        showWhen: [
          { resource: ["instagram"], operation: ["publish"] },
          { resource: ["threads"], operation: ["publish"] },
        ],
        title: "Max Wait",
        description: "How long to wait for the media to be ready, times 1000",
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

export type MetaConfig = z.output<typeof metaConfig>;
