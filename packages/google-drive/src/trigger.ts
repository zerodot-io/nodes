// SPDX-License-Identifier: AGPL-3.0-only
import { defineNode, POLL_MAX_ITEMS } from "@zerodot/node-sdk";
import { z } from "zod";
import {
  callDrive,
  DRIVE_OAUTH2_CREDENTIAL,
  DRIVE_SERVICE_ACCOUNT_CREDENTIAL,
  driveToken,
} from "./api";
import { AUTHENTICATION } from "./config";
import { DRIVE_ICON } from "./icon";
import {
  FOLDER_MIME,
  filesOf,
  type ListFilter,
  listFilesRequest,
  parseParentId,
  quoteQ,
  stringOf,
} from "./request";

const TIMEOUT_MS = 30_000;

export const EVENTS = ["fileCreated", "fileChanged"] as const;
type DriveEvent = (typeof EVENTS)[number];

/** The time field of each event. A changed file has a new `modifiedTime`. */
const TIME_FIELD: Record<DriveEvent, "createdTime" | "modifiedTime"> = {
  fileCreated: "createdTime",
  fileChanged: "modifiedTime",
};

export const triggerConfig = z.object({
  authentication: z
    .enum(AUTHENTICATION)
    .default("oAuth2")
    .meta({
      title: "Authentication",
      labels: { oAuth2: "OAuth2", serviceAccount: "Service Account" },
      hints: {
        oAuth2: "Sign in with a Google account",
        serviceAccount: "Use the JSON key of a service account",
      },
    }),
  event: z
    .enum(EVENTS)
    .default("fileCreated")
    .meta({
      title: "Event",
      labels: { fileCreated: "File Created", fileChanged: "File Created or Changed" },
      hints: {
        fileCreated: "A new file or folder shows up",
        fileChanged: "A file or folder is new, or its content or details change",
      },
    }),
  folderId: z.string().optional().meta({
    title: "Folder",
    description:
      "The URL or the ID of a folder to watch. Empty: all of Drive. Sub-folders are not watched",
  }),
  fileTypes: z
    .enum(["any", "files", "folders"])
    .default("any")
    .meta({
      title: "Type",
      labels: { any: "Files and Folders", files: "Files", folders: "Folders" },
    }),
  intervalSeconds: z.number().int().min(15).max(86_400).default(60).meta({
    title: "Check every (seconds)",
  }),
});

export type DriveTriggerConfig = z.output<typeof triggerConfig>;

/** The Drive filter of a trigger. */
export function triggerFilter(
  cfg: Pick<DriveTriggerConfig, "folderId" | "fileTypes">,
  after: string | null,
  field: "createdTime" | "modifiedTime",
): ListFilter {
  const parts: string[] = [];
  if (cfg.fileTypes === "folders") parts.push(`mimeType = ${quoteQ(FOLDER_MIME)}`);
  if (cfg.fileTypes === "files") parts.push(`mimeType != ${quoteQ(FOLDER_MIME)}`);
  // `>=` reads the last file again. The engine skips a key that it has seen.
  if (after) parts.push(`${field} >= ${quoteQ(after)}`);
  return { query: parts.join(" and ") || undefined, parentId: parseParentId(cfg.folderId) };
}

/** The key of an item: a changed file has a new key for each new change. */
export const itemKey = (event: DriveEvent, file: Record<string, unknown>): string => {
  const id = stringOf(file.id) ?? "";
  return event === "fileCreated" ? id : `${id}:${stringOf(file.modifiedTime) ?? ""}`;
};

export default defineNode({
  type: "trigger.google_drive",
  label: "On Google Drive file change",
  description: "Check Google Drive on a timer and start a run for each new or changed file",
  category: "trigger",
  app: "Google Drive",
  icon: "HardDriveIcon",
  iconUrl: DRIVE_ICON,
  config: triggerConfig,
  defaultConfig: {
    authentication: "oAuth2",
    event: "fileCreated",
    folderId: "",
    fileTypes: "any",
    intervalSeconds: 60,
  },
  credentialTypes: [DRIVE_OAUTH2_CREDENTIAL, DRIVE_SERVICE_ACCOUNT_CREDENTIAL],
  credentialRules: {
    [DRIVE_OAUTH2_CREDENTIAL]: { showWhen: { authentication: ["oAuth2"] } },
    [DRIVE_SERVICE_ACCOUNT_CREDENTIAL]: { showWhen: { authentication: ["serviceAccount"] } },
  },
  ports: { in: [], out: ["out"] },
  subtitle: (cfg) => (typeof cfg.event === "string" ? cfg.event : undefined),
  // The input is the file that started the run.
  run: ({ input }) => ({ port: "out", data: input }),
  async poll({ config: cfg, credential, cursor, firstPoll, signal }) {
    const options = { signal, timeoutMs: TIMEOUT_MS };
    const token = await driveToken(credential, options);
    const field = TIME_FIELD[cfg.event];
    const last = typeof cursor === "string" ? cursor : null;

    if (firstPoll) {
      // Start at the newest file, so the files that exist already start no runs.
      const newest = filesOf(
        await callDrive(
          token,
          listFilesRequest(triggerFilter(cfg, null, field), 1, undefined, `${field} desc`),
          options,
        ),
      ).files[0];
      return { items: [], cursor: stringOf(newest?.[field]) ?? new Date().toISOString() };
    }

    const page = filesOf(
      await callDrive(
        token,
        listFilesRequest(
          triggerFilter(cfg, last, field),
          POLL_MAX_ITEMS,
          undefined,
          `${field} asc`,
        ),
        options,
      ),
    );
    const items = page.files.map((file) => ({ key: itemKey(cfg.event, file), data: file }));
    return { items, cursor: stringOf(page.files.at(-1)?.[field]) ?? last };
  },
});
