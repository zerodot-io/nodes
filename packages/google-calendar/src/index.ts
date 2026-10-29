// SPDX-License-Identifier: AGPL-3.0-only
import type { CredentialTypeDefinition, NodeDefinition } from "@zerodot/node-sdk";
import { calendarOAuth2Credential, calendarServiceAccountCredential } from "./credential";
import googleCalendar from "./node";
import googleCalendarTrigger from "./trigger";

export const nodes: NodeDefinition[] = [googleCalendarTrigger, googleCalendar];
export const credentialTypes: CredentialTypeDefinition[] = [
  calendarOAuth2Credential,
  calendarServiceAccountCredential,
];
