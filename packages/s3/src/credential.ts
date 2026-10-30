// SPDX-License-Identifier: AGPL-3.0-only
import type { CredentialTypeDefinition } from "@zerodot/node-sdk";
import { z } from "zod";
import { S3_ICON } from "./icon";

export const s3Credential: CredentialTypeDefinition = {
  type: "s3",
  label: "S3",
  // For Amazon S3 and for S3-compatible services (MinIO, Cloudflare R2, Backblaze B2, and so
  // on). Empty means: region us-east-1, the Amazon endpoint. A custom endpoint uses path-style
  // addresses, unless `forcePathStyle` is "false".
  fields: z.object({
    accessKeyId: z.string().min(1).meta({ placeholder: "AKIA…" }),
    secretAccessKey: z.string().min(1),
    sessionToken: z.string().min(1).optional(),
    region: z.string().min(1).optional().meta({ placeholder: "us-east-1" }),
    /** The address of an S3-compatible service, for example `https://minio.example.com`. */
    endpoint: z.url().optional().meta({ placeholder: "https://s3.example.com" }),
    forcePathStyle: z.enum(["true", "false"]).optional(),
  }),
  secretFields: ["secretAccessKey", "sessionToken"],
  icon: "HardDriveIcon",
  iconUrl: S3_ICON,
};
