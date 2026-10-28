// SPDX-License-Identifier: AGPL-3.0-only
import type { CredentialTypeDefinition, NodeDefinition } from "@zerodot/node-sdk";
import { ftpCredential, sshCredential } from "./credential";
import ftp from "./ftp";
import sftp from "./sftp";
import sshNode from "./ssh-node";

export const nodes: NodeDefinition[] = [sshNode, ftp, sftp];
export const credentialTypes: CredentialTypeDefinition[] = [sshCredential, ftpCredential];
