// SPDX-License-Identifier: AGPL-3.0-only
import type { DriveRequest } from "./api";

export const FOLDER_MIME = "application/vnd.google-apps.folder";
const GOOGLE_APPS_PREFIX = "application/vnd.google-apps.";

/** The fields of a file answer. Drive gives only the ID, the name, and the type by default. */
export const FILE_FIELDS =
  "id,name,mimeType,parents,size,md5Checksum,createdTime,modifiedTime,trashed,webViewLink,webContentLink,driveId,description,starred";

// ---------------------------------------------------------------------------------------------
// IDs

const ID = /^[A-Za-z0-9_-]+$/;

/** The ID of a file or folder, from its URL or the bare ID. */
export function parseFileId(input: string | undefined, name = "fileId"): string {
  const value = (input ?? "").trim();
  if (!value) throw new Error(`"${name}" is needed: the URL of the file or folder, or its ID`);
  const fromUrl =
    /\/(?:d|folders)\/([A-Za-z0-9_-]+)/.exec(value)?.[1] ??
    /[?&]id=([A-Za-z0-9_-]+)/.exec(value)?.[1];
  if (fromUrl) return fromUrl;
  if (ID.test(value)) return value;
  throw new Error(`"${value}" is not a file URL or ID`);
}

/** The ID of a parent folder. `root` is the My Drive folder. Empty gives undefined. */
export const parseParentId = (input: string | undefined): string | undefined =>
  input?.trim() ? parseFileId(input, "parentId") : undefined;

// ---------------------------------------------------------------------------------------------
// Search text

/** A text in single quotes for the `q` parameter. A backslash and a quote get a backslash. */
export const quoteQ = (value: string) =>
  `'${value.replaceAll("\\", "\\\\").replaceAll("'", "\\'")}'`;

export type ListFilter = {
  /** A raw Drive `q` query. It is joined with the other filters by `and`. */
  query?: string;
  parentId?: string;
  nameContains?: string;
  mimeType?: string;
  includeTrashed?: boolean;
};

/** The `q` of a list call. */
export function buildQuery(filter: ListFilter): string | undefined {
  const parts: string[] = [];
  if (filter.query?.trim()) parts.push(`(${filter.query.trim()})`);
  if (filter.parentId) parts.push(`${quoteQ(filter.parentId)} in parents`);
  if (filter.nameContains?.trim())
    parts.push(`name contains ${quoteQ(filter.nameContains.trim())}`);
  if (filter.mimeType?.trim()) parts.push(`mimeType = ${quoteQ(filter.mimeType.trim())}`);
  if (!filter.includeTrashed) parts.push("trashed = false");
  return parts.length > 0 ? parts.join(" and ") : undefined;
}

// ---------------------------------------------------------------------------------------------
// Requests

const seg = encodeURIComponent;
/** Every call works in shared drives too. */
const ALL_DRIVES = { supportsAllDrives: "true" } as const;

export const listFilesRequest = (
  filter: ListFilter,
  pageSize: number,
  pageToken?: string,
  orderBy = "modifiedTime desc",
): DriveRequest => ({
  method: "GET",
  path: "/files",
  query: {
    q: buildQuery(filter),
    pageSize: String(Math.min(Math.max(pageSize, 1), 1000)),
    pageToken,
    fields: `nextPageToken,files(${FILE_FIELDS})`,
    orderBy,
    includeItemsFromAllDrives: "true",
    ...ALL_DRIVES,
  },
  action: "list the files",
});

export const getFileRequest = (id: string, fields = FILE_FIELDS): DriveRequest => ({
  method: "GET",
  path: `/files/${seg(id)}`,
  query: { fields, ...ALL_DRIVES },
  action: "get the file",
});

/** The bytes of a binary file. */
export const mediaRequest = (id: string): DriveRequest => ({
  method: "GET",
  path: `/files/${seg(id)}`,
  query: { alt: "media", ...ALL_DRIVES },
  action: "download the file",
});

/** The bytes of a Google Docs, Sheets, or Slides file in another format. */
export const exportRequest = (id: string, mimeType: string): DriveRequest => ({
  method: "GET",
  path: `/files/${seg(id)}/export`,
  query: { mimeType },
  action: "export the file",
});

/** A Google Docs, Sheets, or Slides file has no bytes. It needs an export. */
export const isGoogleApp = (mimeType: string | undefined): boolean =>
  (mimeType ?? "").startsWith(GOOGLE_APPS_PREFIX) && mimeType !== FOLDER_MIME;

export type UploadMetadata = {
  name: string;
  parents?: string[];
  description?: string;
  /** A Google type, such as a Google Doc, makes Drive convert the upload. */
  mimeType?: string;
};

export const uploadRequest = (
  metadata: UploadMetadata,
  bytes: Uint8Array,
  mimeType: string,
): DriveRequest => ({
  method: "POST",
  path: "/files",
  query: { uploadType: "multipart", fields: FILE_FIELDS, ...ALL_DRIVES },
  body: metadata,
  media: { bytes, mimeType },
  action: "upload the file",
});

export const createFolderRequest = (name: string, parentId?: string): DriveRequest => ({
  method: "POST",
  path: "/files",
  query: { fields: FILE_FIELDS, ...ALL_DRIVES },
  body: { name, mimeType: FOLDER_MIME, ...(parentId && { parents: [parentId] }) },
  action: "create the folder",
});

export const copyFileRequest = (id: string, name?: string, parentId?: string): DriveRequest => ({
  method: "POST",
  path: `/files/${seg(id)}/copy`,
  query: { fields: FILE_FIELDS, ...ALL_DRIVES },
  body: { ...(name && { name }), ...(parentId && { parents: [parentId] }) },
  action: "copy the file",
});

/** Changes the name, the description, or the star of a file. */
export const updateFileRequest = (
  id: string,
  changes: { name?: string; description?: string; starred?: boolean },
): DriveRequest => ({
  method: "PATCH",
  path: `/files/${seg(id)}`,
  query: { fields: FILE_FIELDS, ...ALL_DRIVES },
  body: changes,
  action: "update the file",
});

/** Moves a file: the new parent is added and the old parents are removed. */
export const moveFileRequest = (
  id: string,
  parentId: string,
  oldParents: string[],
): DriveRequest => ({
  method: "PATCH",
  path: `/files/${seg(id)}`,
  query: {
    addParents: parentId,
    removeParents: oldParents.filter((parent) => parent !== parentId).join(",") || undefined,
    fields: FILE_FIELDS,
    ...ALL_DRIVES,
  },
  body: {},
  action: "move the file",
});

export const trashFileRequest = (id: string): DriveRequest => ({
  method: "PATCH",
  path: `/files/${seg(id)}`,
  query: { fields: FILE_FIELDS, ...ALL_DRIVES },
  body: { trashed: true },
  action: "move the file to the trash",
});

export const deleteFileRequest = (id: string): DriveRequest => ({
  method: "DELETE",
  path: `/files/${seg(id)}`,
  query: ALL_DRIVES,
  action: "delete the file",
});

export type ShareOptions = {
  role: string;
  type: string;
  emailAddress?: string;
  domain?: string;
  sendNotification: boolean;
  message?: string;
};

/** A permission: who gets which role. `user` and `group` need an email, `domain` needs a domain. */
export function shareRequest(id: string, options: ShareOptions): DriveRequest {
  const { role, type } = options;
  const email = options.emailAddress?.trim();
  const domain = options.domain?.trim();
  const byEmail = type === "user" || type === "group";
  if (byEmail && !email) throw new Error(`"emailAddress" is needed to share with a ${type}`);
  if (type === "domain" && !domain) throw new Error('"domain" is needed to share with a domain');
  return {
    method: "POST",
    path: `/files/${seg(id)}/permissions`,
    query: {
      sendNotificationEmail: byEmail ? String(options.sendNotification) : undefined,
      emailMessage: byEmail && options.sendNotification ? options.message?.trim() : undefined,
      fields: "id,type,role,emailAddress,domain,displayName",
      ...ALL_DRIVES,
    },
    body: {
      role,
      type,
      ...(byEmail && { emailAddress: email }),
      ...(type === "domain" && { domain }),
    },
    action: "share the file",
  };
}

export const listPermissionsRequest = (id: string): DriveRequest => ({
  method: "GET",
  path: `/files/${seg(id)}/permissions`,
  query: {
    fields: "permissions(id,type,role,emailAddress,domain,displayName)",
    pageSize: "100",
    ...ALL_DRIVES,
  },
  action: "list the permissions",
});

export const deletePermissionRequest = (id: string, permissionId: string): DriveRequest => ({
  method: "DELETE",
  path: `/files/${seg(id)}/permissions/${seg(permissionId)}`,
  query: ALL_DRIVES,
  action: "remove the permission",
});

// ---------------------------------------------------------------------------------------------
// Answers

export type DriveFile = Record<string, unknown>;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** The files and the next page token in an answer of `listFilesRequest`. */
export function filesOf(answer: unknown): { files: DriveFile[]; next?: string } {
  const body = isRecord(answer) ? answer : {};
  const files = Array.isArray(body.files) ? body.files.filter(isRecord) : [];
  return { files, next: typeof body.nextPageToken === "string" ? body.nextPageToken : undefined };
}

/** The parent IDs in an answer of `getFileRequest`. */
export function parentsOf(answer: unknown): string[] {
  const parents = isRecord(answer) ? answer.parents : undefined;
  return Array.isArray(parents) ? parents.filter((p): p is string => typeof p === "string") : [];
}

export const stringOf = (value: unknown): string | undefined =>
  typeof value === "string" && value !== "" ? value : undefined;

/** A default format for each type of Google file. */
export const EXPORT_DEFAULTS: Record<string, string> = {
  "application/vnd.google-apps.document": "application/pdf",
  "application/vnd.google-apps.spreadsheet":
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.google-apps.presentation": "application/pdf",
  "application/vnd.google-apps.drawing": "image/png",
};

const EXTENSIONS: Record<string, string> = {
  "application/pdf": ".pdf",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": ".xlsx",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ".docx",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": ".pptx",
  "text/plain": ".txt",
  "text/csv": ".csv",
  "text/html": ".html",
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/svg+xml": ".svg",
};

/** The name of an exported file: the name of the Drive file with the extension of the format. */
export function exportName(name: string, mimeType: string): string {
  const extension = EXTENSIONS[mimeType];
  return extension && !name.toLowerCase().endsWith(extension) ? `${name}${extension}` : name;
}
