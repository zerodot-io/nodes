// SPDX-License-Identifier: AGPL-3.0-only
import { createHmac, timingSafeEqual } from "node:crypto";
import { defineNode, type WebhookContext } from "@zerodot/node-sdk";
import { z } from "zod";
import { callFeedbackjar, FEEDBACKJAR_CREDENTIAL, feedbackjarAccess } from "./api";
import { FEEDBACKJAR_ICON } from "./icon";

export const EVENTS = [
  "*",
  "post.created",
  "post.status_changed",
  "comment.created",
  "member.added",
  "member.removed",
  "tag.created",
  "tag.deleted",
  "board.created",
  "board.deleted",
] as const;

export const triggerConfig = z.object({
  events: z
    .array(z.enum(EVENTS))
    .min(1)
    .default(["post.created"])
    .meta({
      title: "Events",
      labels: {
        "*": "All Events",
        "post.created": "Post Created",
        "post.status_changed": "Post Status Changed",
        "comment.created": "Comment Created",
        "member.added": "Member Added",
        "member.removed": "Member Removed",
        "tag.created": "Tag Created",
        "tag.deleted": "Tag Deleted",
        "board.created": "Board Created",
        "board.deleted": "Board Deleted",
      },
      hints: {
        "*": "All events that FeedbackJar sends",
        "post.created": "Someone made a new post",
        "post.status_changed": "The status of a post changed",
        "comment.created": "Someone wrote a public comment",
        "member.added": "A member joined the project",
        "member.removed": "A member left the project",
        "tag.created": "A tag was made",
        "tag.deleted": "A tag was deleted",
        "board.created": "A board was made",
        "board.deleted": "A board was deleted",
      },
    }),
});

export type FeedbackjarTriggerConfig = z.output<typeof triggerConfig>;

const TIMEOUT_MS = 15_000;

/** The hook that `activate` made at FeedbackJar. The secret is only given once, so it stays here. */
type HookState = { hookId: string; secret: string | null };

type HookAnswer = { id?: string; url?: string; secret?: string | null };

const ALL_EVENTS = EVENTS.filter((event) => event !== "*");

/** FeedbackJar rejects a signature that is older than this. */
const TOLERANCE_SECONDS = 300;

/** The `X-Feedbackjar-Signature` value: `t=<seconds>,v1=<hex>`. */
export function feedbackjarSignature(secret: string, timestamp: number, rawBody: string): string {
  const digest = createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest("hex");
  return `t=${timestamp},v1=${digest}`;
}

export function signatureValid(
  secret: string,
  rawBody: string,
  header: string | undefined,
  nowSeconds = Math.floor(Date.now() / 1000),
): boolean {
  const parts = Object.fromEntries(
    (header ?? "").split(",").map((part) => {
      const at = part.indexOf("=");
      return at < 0 ? [part.trim(), ""] : [part.slice(0, at).trim(), part.slice(at + 1).trim()];
    }),
  );
  const timestamp = Number(parts.t);
  if (!Number.isInteger(timestamp) || !parts.v1) return false;
  if (Math.abs(nowSeconds - timestamp) > TOLERANCE_SECONDS) return false;
  const wanted = Buffer.from(feedbackjarSignature(secret, timestamp, rawBody));
  const got = Buffer.from(`t=${timestamp},v1=${parts.v1}`);
  return got.byteLength === wanted.byteLength && timingSafeEqual(got, wanted);
}

type Access = ReturnType<typeof feedbackjarAccess>;
type Options = { signal: AbortSignal; timeoutMs: number };

async function deleteHook(access: Access, id: string, options: Options): Promise<void> {
  try {
    await callFeedbackjar(
      access,
      { method: "DELETE", path: `/webhooks/${encodeURIComponent(id)}` },
      options,
    );
  } catch (error) {
    if (!/\(404\)/.test(String(error))) throw error;
  }
}

/** Removes each webhook that has this address. */
async function removeHooks(access: Access, options: Options, url: string): Promise<void> {
  const hooks = (await callFeedbackjar(access, { method: "GET", path: "/webhooks" }, options)) as
    | HookAnswer[]
    | null;
  for (const hook of hooks ?? []) {
    if (hook.url === url && hook.id) await deleteHook(access, hook.id, options);
  }
}

export default defineNode({
  type: "trigger.feedbackjar",
  label: "FeedbackJar Trigger",
  description: "Start the workflow when a post, comment, or tag changes in FeedbackJar",
  category: "trigger",
  app: "FeedbackJar",
  icon: "MessageSquare",
  iconUrl: FEEDBACKJAR_ICON,
  config: triggerConfig,
  defaultConfig: { events: ["post.created"] },
  // The credential makes and removes the webhook at FeedbackJar. Its "signingSecret" is for a webhook made by hand.
  credentialTypes: [FEEDBACKJAR_CREDENTIAL],
  ports: { in: [], out: ["out"] },
  subtitle: (config) =>
    Array.isArray(config.events) && config.events.length > 0 ? config.events.join(", ") : undefined,
  // The input is { event, createdAt, data }. `data` depends on the event.
  run: ({ input }) => ({ port: "out", data: input }),
  webhook: {
    async receive({ config: raw, credential, request, state }) {
      const config = triggerConfig.parse(raw);
      const rawBody = request.rawBody ?? "";
      // The secret of the webhook that `activate` made, or the secret of a webhook made by hand.
      const saved = (state as HookState | null | undefined)?.secret;
      const secret =
        saved ??
        (typeof credential?.data.signingSecret === "string" ? credential.data.signingSecret : "");
      if (secret && !signatureValid(secret, rawBody, request.headers["x-feedbackjar-signature"])) {
        return { verdict: "forbidden", status: 403 };
      }
      const body = (request.body ?? {}) as Record<string, unknown>;
      const event =
        request.headers["x-feedbackjar-event"] ??
        (typeof body.event === "string" ? body.event : "");
      // The "Send test event" button of FeedbackJar sends this event.
      if (event === "webhook.test") {
        return { verdict: "ignore", response: { status: 200, body: { ok: true } } };
      }
      if (!config.events.includes("*") && !(config.events as string[]).includes(event)) {
        return { verdict: "ignore" };
      }
      return {
        verdict: "accept",
        input: {
          event,
          createdAt: typeof body.createdAt === "string" ? body.createdAt : null,
          data: body.data ?? null,
        },
      };
    },

    /** Makes the webhook at FeedbackJar. A webhook with this address is removed first, to get a new secret. */
    async activate({ config: raw, credential, url, signal }: WebhookContext) {
      const config = triggerConfig.parse(raw);
      const access = feedbackjarAccess(credential);
      const options = { signal, timeoutMs: TIMEOUT_MS };
      await removeHooks(access, options, url);
      const hook = (await callFeedbackjar(
        access,
        {
          method: "POST",
          path: "/webhooks",
          body: {
            url,
            description: "zerodot",
            events: config.events.includes("*") ? ALL_EVENTS : config.events,
            signatureVerificationEnabled: true,
          },
        },
        options,
      )) as HookAnswer | null;
      if (!hook?.id) throw new Error("FeedbackJar did not give the ID of the webhook");
      return { hookId: hook.id, secret: hook.secret ?? null } satisfies HookState;
    },

    /** Removes the webhook. A webhook that is gone already is fine. */
    async deactivate({ credential, url, state, signal }: WebhookContext) {
      const access = feedbackjarAccess(credential);
      const options = { signal, timeoutMs: TIMEOUT_MS };
      const hookId = (state as HookState | null | undefined)?.hookId;
      if (hookId) await deleteHook(access, hookId, options);
      else await removeHooks(access, options, url);
      return null;
    },
  },
});
