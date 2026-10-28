// SPDX-License-Identifier: AGPL-3.0-only
import { createHmac, timingSafeEqual } from "node:crypto";
import { defineNode, toBinary } from "@zerodot/node-sdk";
import { z } from "zod";
import {
  callTelegram,
  downloadTelegramFile,
  TELEGRAM_CREDENTIAL,
  type TelegramAccess,
  telegramAccess,
} from "./api";
import { TELEGRAM_ICON } from "./icon";

export const UPDATE_TYPES = [
  "*",
  "message",
  "edited_message",
  "channel_post",
  "edited_channel_post",
  "callback_query",
  "inline_query",
  "poll",
  "pre_checkout_query",
  "shipping_query",
] as const;

export const triggerConfig = z.object({
  updates: z
    .array(z.enum(UPDATE_TYPES))
    .default(["message"])
    .meta({
      title: "Trigger On",
      labels: {
        "*": "*",
        message: "Message",
        edited_message: "Edited Message",
        channel_post: "Channel Post",
        edited_channel_post: "Edited Channel Post",
        callback_query: "Callback Query",
        inline_query: "Inline Query",
        poll: "Poll",
        pre_checkout_query: "Pre-Checkout Query",
        shipping_query: "Shipping Query",
      },
      hints: {
        "*": "All updates",
        message: "Trigger on new incoming message of any kind — text, photo, sticker, etc",
        edited_message:
          "Trigger on new version of a message that is known to the bot and was edited",
        channel_post:
          "Trigger on new incoming channel post of any kind — text, photo, sticker, etc",
        edited_channel_post:
          "Trigger on new version of a channel post that is known to the bot and was edited",
        callback_query: "Trigger on new incoming callback query",
        inline_query: "Trigger on new incoming inline query",
        poll: "Trigger on new state of a poll. Bots receive only updates about stopped polls and polls that the bot sent",
        pre_checkout_query:
          "Trigger on new incoming pre-checkout query. Contains full information about checkout",
        shipping_query:
          "Trigger on new incoming shipping query. Only for invoices with a flexible price",
      },
    }),
  additionalFields: z
    .object({
      chatIds: z.string().meta({ description: "Only these chats, as ids with commas between" }),
      userIds: z.string().meta({ description: "Only these users, as ids with commas between" }),
      download: z
        .boolean()
        .meta({ description: "Download the image or file of the message as binary data" }),
      imageSize: z
        .enum(["small", "medium", "large", "extraLarge"])
        .meta({ description: "Telegram sends an image in several sizes. Default: large" }),
    })
    .partial()
    .default({}),
});

export type TelegramTriggerConfig = z.output<typeof triggerConfig>;

/**
 * The secret that Telegram sends back in `x-telegram-bot-api-secret-token`.
 * Only characters A-Z, a-z, 0-9, _ and - are allowed, and it is at most 256 long.
 */
export function telegramSecret(token: string): string {
  return createHmac("sha256", token).update("zerodot-telegram-trigger").digest("base64url");
}

/** The last part of the webhook address is the token of the trigger. */
const tokenOf = (url: string): string =>
  new URL(url).pathname.split("/").filter(Boolean).pop() ?? "";

export type UpdateVerdict = "accept" | "forbidden" | "ignore";

const ids = (list: string | undefined) =>
  list ? list.split(",").map((id) => id.trim()) : undefined;

/** Checks one request from Telegram before the run starts. */
export function checkTelegramUpdate(
  config: Record<string, unknown>,
  request: { token: string; headers: Record<string, string>; body: unknown },
): UpdateVerdict {
  const given = Buffer.from(request.headers["x-telegram-bot-api-secret-token"] ?? "");
  const wanted = Buffer.from(telegramSecret(request.token));
  if (given.byteLength !== wanted.byteLength || !timingSafeEqual(given, wanted)) {
    return "forbidden";
  }
  const parsed = triggerConfig.safeParse(config);
  const { chatIds, userIds } = parsed.success ? parsed.data.additionalFields : {};
  const body = (request.body ?? {}) as {
    message?: { chat?: { id?: unknown }; from?: { id?: unknown } };
  };
  const chats = ids(chatIds);
  if (chats && !chats.includes(String(body.message?.chat?.id))) return "ignore";
  const users = ids(userIds);
  if (users && !users.includes(String(body.message?.from?.id))) return "ignore";
  return "accept";
}

const IMAGE_SIZE = { small: 0, medium: 1, large: 2, extraLarge: 3 } as const;
const FILE_KINDS = ["document", "video", "audio", "voice", "video_note", "sticker", "animation"];

type Attachment = { fileId: string; fileName?: string; mimeType?: string };

/** The file of a message: the photo in the wanted size, or the one other attachment. */
export function attachmentOf(update: unknown, size: keyof typeof IMAGE_SIZE): Attachment | null {
  const message = Object.values((update ?? {}) as Record<string, unknown>).find(
    (value): value is Record<string, unknown> =>
      typeof value === "object" &&
      value !== null &&
      ("photo" in value || FILE_KINDS.some((k) => k in value)),
  );
  if (!message) return null;
  const photos = message.photo as { file_id: string }[] | undefined;
  if (photos?.length) {
    const photo = photos[IMAGE_SIZE[size]] ?? photos[photos.length - 1];
    return photo ? { fileId: photo.file_id, mimeType: "image/jpeg" } : null;
  }
  for (const kind of FILE_KINDS) {
    const file = message[kind] as
      | { file_id?: string; file_name?: string; mime_type?: string }
      | undefined;
    if (file?.file_id)
      return { fileId: file.file_id, fileName: file.file_name, mimeType: file.mime_type };
  }
  return null;
}

type WebhookOptions = { signal: AbortSignal; timeoutMs?: number };

/** Tells Telegram to send the updates to `url`. Telegram allows one webhook for each bot. */
export async function registerTelegramWebhook(
  access: TelegramAccess,
  input: { url: string; token: string; updates: readonly string[] },
  options: WebhookOptions,
) {
  await callTelegram(
    access,
    "setWebhook",
    {
      url: input.url,
      allowed_updates: input.updates.includes("*") ? [] : input.updates,
      secret_token: telegramSecret(input.token),
      drop_pending_updates: true,
    },
    { signal: options.signal, timeoutMs: options.timeoutMs ?? 30_000 },
  );
}

export async function removeTelegramWebhook(access: TelegramAccess, options: WebhookOptions) {
  await callTelegram(
    access,
    "deleteWebhook",
    {},
    { signal: options.signal, timeoutMs: options.timeoutMs ?? 30_000 },
  );
}

export default defineNode({
  type: "trigger.telegram",
  label: "Telegram Trigger",
  description: "Start the workflow on a Telegram bot update",
  category: "trigger",
  app: "Telegram",
  icon: "Send",
  iconUrl: TELEGRAM_ICON,
  config: triggerConfig,
  defaultConfig: { updates: ["message"], additionalFields: {} },
  credentialTypes: [TELEGRAM_CREDENTIAL],
  ports: { in: [], out: ["out"] },
  subtitle: (config) =>
    Array.isArray(config.updates) ? `Updates: ${config.updates.join(", ")}` : undefined,
  // Telegram sends updates only to a webhook that we set with the Bot API, and a bot has one
  // webhook. The secret and the chat filter are checked on each request.
  webhook: {
    async receive({ config, url, request }) {
      const verdict = checkTelegramUpdate(config, {
        token: tokenOf(url),
        headers: request.headers,
        body: request.body,
      });
      if (verdict === "forbidden") return { verdict: "forbidden" };
      // Telegram retries an update that does not get a 2xx answer.
      if (verdict === "ignore") {
        return { verdict: "ignore", response: { status: 200, body: { ignored: true } } };
      }
      const { method, headers, query, body } = request;
      return { verdict: "accept", input: { method, headers, query, body } };
    },
    async activate({ config, credential, url, signal }) {
      await registerTelegramWebhook(
        telegramAccess(credential),
        {
          url,
          token: tokenOf(url),
          updates: Array.isArray(config.updates) ? config.updates.map(String) : ["message"],
        },
        { signal },
      );
    },
    async deactivate({ credential, signal }) {
      await removeTelegramWebhook(telegramAccess(credential), { signal });
    },
  },
  webhookTest: { hint: "Send a message to your bot" },
  // The input is { method, headers, query, body }, and the body is the update from Telegram.
  async run({ config, input, credential, signal }) {
    const update =
      input && typeof input === "object" && "body" in input
        ? (input.body as Record<string, unknown>)
        : {};
    if (!config.additionalFields.download) return { port: "out", data: update };
    const file = attachmentOf(update, config.additionalFields.imageSize ?? "large");
    if (!file) return { port: "out", data: update };
    const access = telegramAccess(credential);
    const options = { signal, timeoutMs: 30_000 };
    const info = await callTelegram(access, "getFile", { file_id: file.fileId }, options);
    const filePath = (info.result as { file_path?: string } | undefined)?.file_path;
    if (!filePath) throw new Error("Telegram did not give a file path");
    const bytes = await downloadTelegramFile(access, filePath, options);
    const fileName = file.fileName ?? filePath.split("/").pop() ?? "file";
    return {
      port: "out",
      data: { ...update, binary: { data: toBinary(bytes, fileName, file.mimeType) } },
    };
  },
});
