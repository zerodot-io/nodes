// SPDX-License-Identifier: AGPL-3.0-only
import { fileIcon } from "@zerodot/node-sdk";

// The file is in the package root. This works from `src` (tests) and from `dist` (published).
export const DRIVE_ICON = fileIcon(import.meta.url, "../google-drive.svg");
