// SPDX-License-Identifier: AGPL-3.0-only
import { defineNode, readBinary, toBinary } from "@zerodot/node-sdk";
import {
  type CallOptions,
  callDrive,
  DRIVE_OAUTH2_CREDENTIAL,
  DRIVE_SERVICE_ACCOUNT_CREDENTIAL,
  downloadDrive,
  driveToken,
} from "./api";
import { type DriveConfig, driveConfig } from "./config";
import { DRIVE_ICON } from "./icon";
import {
  copyFileRequest,
  createFolderRequest,
  deleteFileRequest,
  deletePermissionRequest,
  EXPORT_DEFAULTS,
  exportName,
  exportRequest,
  filesOf,
  getFileRequest,
  isGoogleApp,
  listFilesRequest,
  listPermissionsRequest,
  mediaRequest,
  moveFileRequest,
  parentsOf,
  parseFileId,
  parseParentId,
  shareRequest,
  stringOf,
  trashFileRequest,
  updateFileRequest,
  uploadRequest,
} from "./request";

type Call = (request: Parameters<typeof callDrive>[1]) => Promise<unknown>;

const need = <T>(value: T | undefined, name: string, operation: string): T => {
  if (value === undefined || value === "" || (typeof value === "string" && !value.trim())) {
    throw new Error(`"${name}" is needed to ${operation}`);
  }
  return value;
};

const PAGE_SIZE = 1000;
/** A search with Return All stops here, so a big Drive does not fill the memory. */
const MAX_FILES = 10_000;

async function listFiles(call: Call, config: DriveConfig) {
  const filter = {
    query: config.query,
    parentId: parseParentId(config.parentId),
    nameContains: config.nameContains,
    mimeType: config.mimeTypeFilter,
    includeTrashed: config.includeTrashed,
  };
  const wanted = config.returnAll ? MAX_FILES : config.limit;
  const files: Record<string, unknown>[] = [];
  let pageToken: string | undefined;
  do {
    const size = Math.min(wanted - files.length, PAGE_SIZE);
    const page = filesOf(await call(listFilesRequest(filter, size, pageToken)));
    files.push(...page.files);
    pageToken = page.next;
  } while (pageToken && files.length < wanted);
  return files.slice(0, wanted);
}

async function download(call: Call, bytes: Call2, config: DriveConfig, id: string) {
  const file = (await call(getFileRequest(id))) as Record<string, unknown>;
  const mimeType = stringOf(file.mimeType);
  const name = stringOf(file.name) ?? id;
  if (mimeType === "application/vnd.google-apps.folder") {
    throw new Error("A folder has no content to download");
  }
  const property = config.binaryPropertyName || "data";
  if (isGoogleApp(mimeType)) {
    const format =
      config.exportMimeType?.trim() || EXPORT_DEFAULTS[mimeType ?? ""] || "application/pdf";
    const content = await bytes(exportRequest(id, format));
    return { ...file, binary: { [property]: toBinary(content, exportName(name, format), format) } };
  }
  const content = await bytes(mediaRequest(id));
  return { ...file, binary: { [property]: toBinary(content, name, mimeType) } };
}

type Call2 = (request: Parameters<typeof downloadDrive>[1]) => Promise<Uint8Array>;

async function runFile(
  call: Call,
  bytes: Call2,
  config: DriveConfig,
  input: unknown,
): Promise<unknown> {
  const { operation } = config;
  const parent = parseParentId(config.parentId);
  const name = config.name?.trim() || undefined;

  switch (operation) {
    case "list":
      return await listFiles(call, config);
    case "createFromText": {
      const file = need(name, "name", operation);
      const text = need(config.content, "content", operation);
      return await call(
        uploadRequest(
          {
            name: file,
            ...(parent && { parents: [parent] }),
            ...(config.description && { description: config.description }),
            ...(config.contentType?.startsWith("application/vnd.google-apps.") && {
              mimeType: config.contentType,
            }),
          },
          Buffer.from(text, "utf8"),
          config.contentType?.startsWith("application/vnd.google-apps.")
            ? "text/plain"
            : config.contentType || "text/plain",
        ),
      );
    }
    case "upload": {
      const binary = readBinary(input, config.binaryPropertyName || "data");
      const mimeType = config.contentType?.trim() || binary.mimeType || "application/octet-stream";
      const convert = mimeType.startsWith("application/vnd.google-apps.");
      return await call(
        uploadRequest(
          {
            name: name ?? binary.fileName ?? "Untitled",
            ...(parent && { parents: [parent] }),
            ...(config.description && { description: config.description }),
            ...(convert && { mimeType }),
          },
          new Uint8Array(Buffer.from(binary.data, "base64")),
          convert ? binary.mimeType || "application/octet-stream" : mimeType,
        ),
      );
    }
  }

  const id = parseFileId(config.fileId);
  switch (operation) {
    case "get":
      return await call(getFileRequest(id));
    case "download":
      return await download(call, bytes, config, id);
    case "update": {
      const changes = {
        ...(name && { name }),
        ...(config.description !== undefined && config.description !== ""
          ? { description: config.description }
          : {}),
      };
      if (Object.keys(changes).length === 0) {
        throw new Error('"name" or "description" is needed to update');
      }
      return await call(updateFileRequest(id, changes));
    }
    case "copy":
      return await call(copyFileRequest(id, name, parent));
    case "move": {
      const target = need(parent, "parentId", operation);
      const current = await call(getFileRequest(id, "parents"));
      return await call(moveFileRequest(id, target, parentsOf(current)));
    }
    case "delete":
      return await deleteFile(call, config, id);
    case "share":
      return await share(call, config, id);
  }
  throw new Error(`"${operation}" is not an operation of "file"`);
}

async function deleteFile(call: Call, config: DriveConfig, id: string) {
  if (config.permanently) {
    await call(deleteFileRequest(id));
    return { success: true, id, trashed: false, deleted: true };
  }
  await call(trashFileRequest(id));
  return { success: true, id, trashed: true, deleted: false };
}

function share(call: Call, config: DriveConfig, id: string) {
  return call(
    shareRequest(id, {
      role: config.role,
      type: config.shareType,
      emailAddress: config.emailAddress,
      domain: config.domain,
      sendNotification: config.sendNotification,
      message: config.message,
    }),
  );
}

async function runFolder(call: Call, config: DriveConfig): Promise<unknown> {
  const { operation } = config;
  if (operation === "create") {
    return await call(
      createFolderRequest(
        need(config.name?.trim(), "name", operation),
        parseParentId(config.parentId),
      ),
    );
  }
  const id = parseFileId(config.fileId);
  if (operation === "delete") return await deleteFile(call, config, id);
  if (operation === "share") return await share(call, config, id);
  throw new Error(`"${operation}" is not an operation of "folder"`);
}

async function runPermission(call: Call, config: DriveConfig): Promise<unknown> {
  const id = parseFileId(config.fileId);
  if (config.operation === "list") {
    const answer = (await call(listPermissionsRequest(id))) as { permissions?: unknown } | null;
    return Array.isArray(answer?.permissions) ? answer.permissions : [];
  }
  if (config.operation === "delete") {
    const permissionId = need(config.permissionId, "permissionId", "remove a permission").trim();
    await call(deletePermissionRequest(id, permissionId));
    return { success: true, fileId: id, permissionId };
  }
  throw new Error(`"${config.operation}" is not an operation of "permission"`);
}

export default defineNode({
  type: "google_drive.api",
  label: "Google Drive",
  description: "Find, upload, download, and share files in Google Drive",
  category: "integration",
  app: "Google Drive",
  // The names of the actions of the Google Drive node.
  actions: [
    { label: "List or search files", config: { resource: "file", operation: "list" } },
    { label: "Get a file", config: { resource: "file", operation: "get" } },
    { label: "Download a file", config: { resource: "file", operation: "download" } },
    { label: "Upload a file", config: { resource: "file", operation: "upload" } },
    { label: "Create a file from text", config: { resource: "file", operation: "createFromText" } },
    { label: "Update a file", config: { resource: "file", operation: "update" } },
    { label: "Copy a file", config: { resource: "file", operation: "copy" } },
    { label: "Move a file", config: { resource: "file", operation: "move" } },
    { label: "Delete a file", config: { resource: "file", operation: "delete" } },
    { label: "Share a file", config: { resource: "file", operation: "share" } },
    { label: "Create a folder", config: { resource: "folder", operation: "create" } },
    { label: "Delete a folder", config: { resource: "folder", operation: "delete" } },
    { label: "Share a folder", config: { resource: "folder", operation: "share" } },
    { label: "List permissions", config: { resource: "permission", operation: "list" } },
    { label: "Remove a permission", config: { resource: "permission", operation: "delete" } },
  ],
  icon: "HardDrive",
  iconUrl: DRIVE_ICON,
  config: driveConfig,
  defaultConfig: {
    authentication: "oAuth2",
    resource: "file",
    operation: "list",
    fileId: "",
    limit: 100,
    returnAll: false,
    includeTrashed: false,
    binaryPropertyName: "data",
    permanently: false,
    role: "reader",
    shareType: "user",
    sendNotification: true,
    timeoutMs: 30_000,
  },
  credentialTypes: [DRIVE_OAUTH2_CREDENTIAL, DRIVE_SERVICE_ACCOUNT_CREDENTIAL],
  // The Authentication field says which credential type the user picks.
  credentialRules: {
    [DRIVE_OAUTH2_CREDENTIAL]: { showWhen: { authentication: ["oAuth2"] } },
    [DRIVE_SERVICE_ACCOUNT_CREDENTIAL]: { showWhen: { authentication: ["serviceAccount"] } },
  },
  ports: { in: ["in"], out: ["out"] },
  subtitle: (config) =>
    typeof config.operation === "string"
      ? `${String(config.resource ?? "file")}: ${config.operation}`
      : undefined,
  async run({ config, input, credential, signal }) {
    const options: CallOptions = { signal, timeoutMs: config.timeoutMs };
    const token = await driveToken(credential, options);
    const call: Call = (request) => callDrive(token, request, options);
    const bytes: Call2 = (request) => downloadDrive(token, request, options);

    if (config.resource === "folder") return { port: "out", data: await runFolder(call, config) };
    if (config.resource === "permission") {
      return { port: "out", data: await runPermission(call, config) };
    }
    return { port: "out", data: await runFile(call, bytes, config, input) };
  },
});
