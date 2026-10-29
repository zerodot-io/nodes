// SPDX-License-Identifier: AGPL-3.0-only
import type { CredentialTypeDefinition, NodeDefinition } from "@zerodot/node-sdk";
import { driveOAuth2Credential, driveServiceAccountCredential } from "./credential";
import googleDrive from "./node";
import googleDriveTrigger from "./trigger";

export const nodes: NodeDefinition[] = [googleDriveTrigger, googleDrive];
export const credentialTypes: CredentialTypeDefinition[] = [
  driveOAuth2Credential,
  driveServiceAccountCredential,
];
