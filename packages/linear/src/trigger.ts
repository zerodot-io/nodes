// SPDX-License-Identifier: AGPL-3.0-only
import { createHmac, timingSafeEqual } from "node:crypto";
import { defineNode, type WebhookContext } from "@zerodot/node-sdk";
import { z } from "zod";
import {
  callLinear,
  LINEAR_API_KEY_CREDENTIAL,
  LINEAR_OAUTH2_CREDENTIAL,
  linearAccess,
} from "./api";
import { AUTHENTICATION } from "./config";
import { LINEAR_ICON } from "./icon";

export const RESOURCE_TYPES = ["Issue", "Comment", "Project", "Cycle", "IssueLabel"] as const;
export const ACTIONS = ["create", "update", "remove"] as const;

export const triggerConfig = z.object({
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
  resourceTypes: z
    .array(z.enum(RESOURCE_TYPES))
    .min(1)
    .default(["Issue"])
    .meta({
      title: "Events",
      labels: {
        Issue: "Issue",
        Comment: "Comment",
        Project: "Project",
        Cycle: "Cycle",
        IssueLabel: "Label",
      },
      hints: {
        Issue: "An issue was made, changed, or removed",
        Comment: "A comment was made, changed, or removed",
        Project: "A project was made, changed, or removed",
        Cycle: "A cycle was made, changed, or removed",
        IssueLabel: "A label was made, changed, or removed",
      },
    }),
  actions: z
    .array(z.enum(ACTIONS))
    .default([])
    .meta({
      title: "Actions",
      description: "Empty means all actions",
      labels: { create: "Create", update: "Update", remove: "Remove" },
      hints: {
        create: "Something new was made",
        update: "Something changed",
        remove: "Something was removed",
      },
    }),
  teamId: z.string().optional().meta({
    title: "Team ID",
    description: "Only this team. Empty means all public teams",
  }),
});

export type LinearTriggerConfig = z.output<typeof triggerConfig>;

const TIMEOUT_MS = 15_000;
/** Linear asks to reject a delivery that is more than one minute old. It can be a replay. */
const TOLERANCE_MS = 60_000;

/**
 * The secret that Linear signs each delivery with. It comes from the webhook address, which has
 * a random token. So the secret stays the same while the credential changes.
 */
export function linearSecret(url: string): string {
  return createHmac("sha256", url).update("zerodot-linear-trigger").digest("base64url");
}

/** The `linear-signature` value of a delivery: the hex HMAC-SHA256 of the raw body. */
export function linearSignature(url: string, rawBody: string): string {
  return createHmac("sha256", linearSecret(url)).update(rawBody).digest("hex");
}

/** True if the signature is right and the `webhookTimestamp` is in the last minute. */
export function verifyLinearRequest(
  url: string,
  rawBody: string,
  given: string | undefined,
  body: Record<string, unknown>,
  now: number = Date.now(),
): boolean {
  const wanted = Buffer.from(linearSignature(url, rawBody));
  const got = Buffer.from(given ?? "");
  if (got.byteLength !== wanted.byteLength || !timingSafeEqual(got, wanted)) return false;
  const timestamp = body.webhookTimestamp;
  return typeof timestamp === "number" && Math.abs(now - timestamp) <= TOLERANCE_MS;
}

type HookState = { hookId?: string } | null | undefined;
type Hook = { id: string; url: string };

const HOOKS_QUERY = "query { webhooks(first: 100) { nodes { id url } } }";

async function findHook(
  access: ReturnType<typeof linearAccess>,
  url: string,
  options: { signal: AbortSignal; timeoutMs: number },
): Promise<string | undefined> {
  const data = await callLinear(access, { query: HOOKS_QUERY }, options);
  const nodes = (data.webhooks as { nodes?: Hook[] } | undefined)?.nodes ?? [];
  return nodes.find((hook) => hook.url === url)?.id;
}

export default defineNode({
  type: "trigger.linear",
  label: "Linear Trigger",
  description: "Start the workflow on an event in Linear",
  category: "trigger",
  app: "Linear",
  icon: "ListChecks",
  iconUrl: LINEAR_ICON,
  config: triggerConfig,
  defaultConfig: { authentication: "apiKey", resourceTypes: ["Issue"], actions: [] },
  credentialTypes: [LINEAR_API_KEY_CREDENTIAL, LINEAR_OAUTH2_CREDENTIAL],
  credentialRules: {
    [LINEAR_API_KEY_CREDENTIAL]: { showWhen: { authentication: ["apiKey"] } },
    [LINEAR_OAUTH2_CREDENTIAL]: { showWhen: { authentication: ["oAuth2"] } },
  },
  ports: { in: [], out: ["out"] },
  subtitle: (config) =>
    Array.isArray(config.resourceTypes) ? config.resourceTypes.join(", ") : undefined,
  // The input is { event, action, delivery, body }. `body` is the payload from Linear.
  run: ({ input }) => ({ port: "out", data: input }),
  webhook: {
    async receive({ config: raw, request, url }) {
      const config = triggerConfig.parse(raw);
      const body = (request.body ?? {}) as Record<string, unknown>;
      if (
        !verifyLinearRequest(url, request.rawBody ?? "", request.headers["linear-signature"], body)
      ) {
        return { verdict: "forbidden", status: 403 };
      }
      const event =
        typeof body.type === "string" ? body.type : (request.headers["linear-event"] ?? "");
      const action = typeof body.action === "string" ? body.action : null;
      if (!(config.resourceTypes as string[]).includes(event)) return { verdict: "ignore" };
      if (config.actions.length > 0 && !(action && (config.actions as string[]).includes(action))) {
        return { verdict: "ignore" };
      }
      return {
        verdict: "accept",
        input: { event, action, delivery: request.headers["linear-delivery"] ?? null, body },
      };
    },

    /** Makes the webhook at Linear, or updates the one that has this address already. */
    async activate({ config: raw, credential, url, signal }: WebhookContext) {
      const config = triggerConfig.parse(raw);
      const access = linearAccess(credential);
      const options = { signal, timeoutMs: TIMEOUT_MS };
      const existing = await findHook(access, url, options);
      if (existing) {
        await callLinear(
          access,
          {
            query: `mutation ($id: String!, $input: WebhookUpdateInput!) {
  webhookUpdate(id: $id, input: $input) { success }
}`,
            variables: {
              id: existing,
              input: {
                resourceTypes: config.resourceTypes,
                secret: linearSecret(url),
                enabled: true,
              },
            },
          },
          options,
        );
        return { hookId: existing } satisfies HookState;
      }
      const data = await callLinear(
        access,
        {
          query: `mutation ($input: WebhookCreateInput!) {
  webhookCreate(input: $input) { success webhook { id } }
}`,
          variables: {
            input: {
              url,
              resourceTypes: config.resourceTypes,
              secret: linearSecret(url),
              enabled: true,
              ...(config.teamId ? { teamId: config.teamId } : { allPublicTeams: true }),
            },
          },
        },
        options,
      );
      const id = (data.webhookCreate as { webhook?: { id?: string } } | undefined)?.webhook?.id;
      if (!id) throw new Error("Linear did not give the ID of the webhook");
      return { hookId: id } satisfies HookState;
    },

    /** Removes the webhook. A webhook that is gone already is fine. */
    async deactivate({ credential, url, state, signal }: WebhookContext) {
      const access = linearAccess(credential);
      const options = { signal, timeoutMs: TIMEOUT_MS };
      const hookId = (state as HookState)?.hookId ?? (await findHook(access, url, options));
      if (hookId === undefined) return null;
      try {
        await callLinear(
          access,
          {
            query: "mutation ($id: String!) { webhookDelete(id: $id) { success } }",
            variables: { id: hookId },
          },
          options,
        );
      } catch (error) {
        if (!/not found/i.test(String(error))) throw error;
      }
      return null;
    },
  },
});
