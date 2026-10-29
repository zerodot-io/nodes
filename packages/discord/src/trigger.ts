// SPDX-License-Identifier: AGPL-3.0-only
import { createPublicKey, verify } from "node:crypto";
import { defineNode, type ResolvedCredential, type WebhookContext } from "@zerodot/node-sdk";
import { z } from "zod";
import { botToken, callDiscord, DISCORD_BOT_CREDENTIAL } from "./api";
import { DISCORD_ICON } from "./icon";

/** Interaction types of the Discord API. */
export const INTERACTION = {
  ping: 1,
  applicationCommand: 2,
  messageComponent: 3,
  autocomplete: 4,
  modalSubmit: 5,
} as const;

const INTERACTION_TYPES = ["applicationCommand", "messageComponent", "modalSubmit"] as const;
type InteractionType = (typeof INTERACTION_TYPES)[number];

/** Interaction response types of the Discord API. */
const RESPONSE = {
  pong: 1,
  message: 4,
  deferredMessage: 5,
  deferredUpdate: 6,
  autocompleteResult: 8,
} as const;

const EPHEMERAL = 64;

export const triggerConfig = z.object({
  interactionTypes: z
    .array(z.enum(INTERACTION_TYPES))
    .min(1)
    .default(["applicationCommand", "messageComponent"])
    .meta({
      title: "Trigger On",
      labels: {
        applicationCommand: "Slash Command",
        messageComponent: "Button or Select Menu",
        modalSubmit: "Modal Submit",
      },
      hints: {
        applicationCommand: "A user runs a slash command or a context menu command",
        messageComponent: "A user clicks a button or picks from a select menu",
        modalSubmit: "A user sends a modal form",
      },
    }),
  commandNames: z.string().optional().meta({
    title: "Command Names",
    description: "Only these commands or custom IDs, with commas between. Empty: all",
  }),
  response: z
    .enum(["deferred", "deferredEphemeral", "deferredUpdate", "message"])
    .default("deferred")
    .meta({
      title: "Response",
      labels: {
        deferred: "Deferred Message",
        deferredEphemeral: "Deferred Private Message",
        deferredUpdate: "Deferred Update",
        message: "Message",
      },
      hints: {
        deferred: 'Show "thinking" in the channel. Reply later with a webhook execute',
        deferredEphemeral: 'Show "thinking" only to the user. Reply later with a webhook execute',
        deferredUpdate: "For buttons: acknowledge with no new message. Slash commands defer",
        message: "Answer at once with a fixed text",
      },
    }),
  replyContent: z
    .string()
    .optional()
    .meta({ title: "Reply Text", showWhen: { response: ["message"] } }),
  ephemeral: z
    .boolean()
    .default(false)
    .meta({ title: "Private Reply", showWhen: { response: ["message"] } }),
  setEndpoint: z.boolean().default(false).meta({
    title: "Set Interactions Endpoint",
    description:
      "Off: copy the webhook URL of this trigger to Interactions Endpoint URL in the Developer Portal (General Information). On: zerodot sets it in the application for you",
  }),
});

export type DiscordTriggerConfig = z.output<typeof triggerConfig>;

const SPKI_ED25519_PREFIX = Buffer.from("302a300506032b6570032100", "hex");
/** A request older than this is a replay. */
const MAX_AGE_SECONDS = 300;

/** Checks the Ed25519 signature that Discord puts on each interaction request. */
export function verifyDiscordSignature(input: {
  publicKey: string;
  signature: string | undefined;
  timestamp: string | undefined;
  rawBody: string | undefined;
  now?: number;
}): boolean {
  const { publicKey, signature, timestamp, rawBody } = input;
  if (!/^[0-9a-f]{64}$/i.test(publicKey)) return false;
  if (!signature || !/^[0-9a-f]{128}$/i.test(signature)) return false;
  if (!timestamp || !/^\d+$/.test(timestamp) || rawBody === undefined) return false;
  const now = (input.now ?? Date.now()) / 1000;
  if (Math.abs(now - Number(timestamp)) > MAX_AGE_SECONDS) return false;
  try {
    const key = createPublicKey({
      key: Buffer.concat([SPKI_ED25519_PREFIX, Buffer.from(publicKey, "hex")]),
      format: "der",
      type: "spki",
    });
    return verify(null, Buffer.from(timestamp + rawBody), key, Buffer.from(signature, "hex"));
  } catch {
    return false;
  }
}

const TIMEOUT_MS = 15_000;
/** Public keys that the API gave, by bot token. A key does not change. */
const publicKeys = new Map<string, string>();

/** The public key from the credential, or from the API when the credential has none. */
export async function publicKeyOf(
  credential: Pick<ResolvedCredential, "type" | "data"> | null,
  signal: AbortSignal,
): Promise<string> {
  const saved = credential?.data.publicKey;
  if (typeof saved === "string" && saved.trim() !== "") return saved.trim();
  const token = botToken(credential);
  const cached = publicKeys.get(token);
  if (cached) return cached;
  const app = (await callDiscord(
    token,
    { method: "GET", path: "/applications/@me" },
    { signal, timeoutMs: TIMEOUT_MS },
  )) as { verify_key?: unknown } | null;
  if (typeof app?.verify_key !== "string") throw new Error("Discord did not give the public key");
  publicKeys.set(token, app.verify_key);
  return app.verify_key;
}

type Interaction = {
  id?: string;
  type?: number;
  application_id?: string;
  token?: string;
  guild_id?: string;
  channel_id?: string;
  member?: { user?: unknown };
  user?: unknown;
  data?: {
    name?: string;
    custom_id?: string;
    options?: unknown;
    values?: unknown;
    components?: unknown;
  };
};

const typeName = (type: number | undefined): InteractionType | undefined =>
  INTERACTION_TYPES.find((name) => INTERACTION[name] === type);

/** The immediate answer to an accepted interaction. Discord waits at most 3 seconds. */
export function responseFor(config: DiscordTriggerConfig, type: InteractionType) {
  switch (config.response) {
    case "message":
      return {
        type: RESPONSE.message,
        data: {
          content: config.replyContent?.trim() || "Received",
          ...(config.ephemeral ? { flags: EPHEMERAL } : {}),
        },
      };
    case "deferredEphemeral":
      return { type: RESPONSE.deferredMessage, data: { flags: EPHEMERAL } };
    case "deferredUpdate":
      // A slash command has no message to update.
      return type === "applicationCommand"
        ? { type: RESPONSE.deferredMessage }
        : { type: RESPONSE.deferredUpdate };
    default:
      return { type: RESPONSE.deferredMessage };
  }
}

/** Checks one request from Discord. The public key comes from the credential. */
export function checkInteraction(
  config: DiscordTriggerConfig,
  publicKey: string,
  request: { headers: Record<string, string>; rawBody?: string; body: unknown },
  now?: number,
) {
  const valid = verifyDiscordSignature({
    publicKey,
    signature: request.headers["x-signature-ed25519"],
    timestamp: request.headers["x-signature-timestamp"],
    rawBody: request.rawBody,
    now,
  });
  // Discord wants 401 for a bad signature. It sends such requests to test the endpoint.
  if (!valid) return { verdict: "forbidden", status: 401 } as const;

  const interaction = (request.body ?? {}) as Interaction;
  if (interaction.type === INTERACTION.ping) {
    return { verdict: "ignore", response: { status: 200, body: { type: RESPONSE.pong } } } as const;
  }
  if (interaction.type === INTERACTION.autocomplete) {
    // A workflow cannot answer in 3 seconds, so autocomplete shows no choices.
    return {
      verdict: "ignore",
      response: { status: 200, body: { type: RESPONSE.autocompleteResult, data: { choices: [] } } },
    } as const;
  }
  const type = typeName(interaction.type);
  if (!type || !config.interactionTypes.includes(type)) return { verdict: "ignore" } as const;

  const name = interaction.data?.name ?? interaction.data?.custom_id ?? "";
  const names = config.commandNames
    ?.split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  if (names?.length && !names.includes(name)) return { verdict: "ignore" } as const;

  return {
    verdict: "accept",
    response: { status: 200, body: responseFor(config, type) },
    input: {
      type,
      commandName: interaction.data?.name ?? null,
      customId: interaction.data?.custom_id ?? null,
      options: interaction.data?.options ?? null,
      values: interaction.data?.values ?? null,
      interactionId: interaction.id ?? null,
      applicationId: interaction.application_id ?? null,
      token: interaction.token ?? null,
      guildId: interaction.guild_id ?? null,
      channelId: interaction.channel_id ?? null,
      user: interaction.member?.user ?? interaction.user ?? null,
      body: interaction,
    },
  } as const;
}

/** What `activate` keeps: the endpoint address that this node set. */
type EndpointState = { endpointUrl: string };

async function setEndpoint(ctx: WebhookContext, url: string | null): Promise<void> {
  try {
    await callDiscord(
      botToken(ctx.credential),
      { method: "PATCH", path: "/applications/@me", body: { interactions_endpoint_url: url } },
      { signal: ctx.signal, timeoutMs: TIMEOUT_MS },
    );
  } catch (error) {
    if (url === null) throw error;
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `${message} Discord sends a test request to the address first, so it must reach zerodot. Or turn off "Set Interactions Endpoint" and set the address in the Developer Portal`,
    );
  }
}

export default defineNode({
  type: "trigger.discord",
  label: "Discord Trigger",
  description: "Start the workflow on a slash command, button click, or modal of a Discord app",
  category: "trigger",
  app: "Discord",
  icon: "MessageCircle",
  iconUrl: DISCORD_ICON,
  config: triggerConfig,
  defaultConfig: {
    interactionTypes: ["applicationCommand", "messageComponent"],
    response: "deferred",
    ephemeral: false,
    setEndpoint: false,
  },
  credentialTypes: [DISCORD_BOT_CREDENTIAL],
  ports: { in: [], out: ["out"] },
  subtitle: (config) =>
    typeof config.commandNames === "string" && config.commandNames.trim() !== ""
      ? `Commands: ${config.commandNames}`
      : undefined,
  // The input has the interaction fields that a reply needs, and `body`, the whole interaction.
  run: ({ input }) => ({ port: "out", data: input }),
  webhook: {
    async receive({ config: raw, credential, request, signal }) {
      const config = triggerConfig.parse(raw);
      return checkInteraction(config, await publicKeyOf(credential, signal), request);
    },
    async activate(ctx) {
      const config = triggerConfig.parse(ctx.config);
      // The public key must be known before Discord sends the test request.
      await publicKeyOf(ctx.credential, ctx.signal);
      if (!config.setEndpoint) return null;
      await setEndpoint(ctx, ctx.url);
      return { endpointUrl: ctx.url } satisfies EndpointState;
    },
    /** Clears the endpoint only when this node set it and it still has that address. */
    async deactivate(ctx) {
      const set = (ctx.state as EndpointState | null | undefined)?.endpointUrl;
      if (!set) return null;
      const app = (await callDiscord(
        botToken(ctx.credential),
        { method: "GET", path: "/applications/@me" },
        { signal: ctx.signal, timeoutMs: TIMEOUT_MS },
      )) as { interactions_endpoint_url?: unknown } | null;
      if (app?.interactions_endpoint_url === set) await setEndpoint(ctx, null);
      return null;
    },
  },
  webhookTest: { hint: "Run a slash command of your Discord app" },
});
