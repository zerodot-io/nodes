// SPDX-License-Identifier: AGPL-3.0-only
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import type { ResolvedCredential } from "@zerodot/node-sdk";

export const MCP_CREDENTIAL_TYPES = ["http.bearer", "http.header", "http.basic"];

const asText = (value: unknown, field: string): string => {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`The credential has no "${field}"`);
  }
  return value;
};

/** The header that a credential adds to the request. */
export function credentialHeader(credential: ResolvedCredential): [string, string] {
  const { type, data } = credential;
  if (type === "http.basic") {
    const pair = `${asText(data.username, "username")}:${asText(data.password, "password")}`;
    return ["authorization", `Basic ${Buffer.from(pair).toString("base64")}`];
  }
  if (type === "http.bearer") return ["authorization", `Bearer ${asText(data.token, "token")}`];
  if (type === "http.header") return [asText(data.name, "name"), asText(data.value, "value")];
  throw new Error(`Unsupported credential type "${type}"`);
}

export type McpServerOptions = {
  url: string;
  credential: ResolvedCredential | null;
  signal: AbortSignal;
  timeoutMs: number;
};

/** The SDK loads on first use. */
async function loadSdk() {
  const [{ Client }, { StreamableHTTPClientTransport }] = await Promise.all([
    import("@modelcontextprotocol/sdk/client/index.js"),
    import("@modelcontextprotocol/sdk/client/streamableHttp.js"),
  ]);
  return { Client, StreamableHTTPClientTransport };
}

/** Connects over Streamable HTTP (the only transport in v1), runs `work`, and always closes. */
async function withClient<T>(
  options: McpServerOptions,
  work: (client: Client, request: { signal: AbortSignal; timeout: number }) => Promise<T>,
): Promise<T> {
  const headers: Record<string, string> = {};
  if (options.credential) {
    const [name, value] = credentialHeader(options.credential);
    headers[name] = value;
  }
  const { Client, StreamableHTTPClientTransport } = await loadSdk();
  const client = new Client({ name: "zerodot", version: "1" });
  const transport = new StreamableHTTPClientTransport(new URL(options.url), {
    requestInit: { headers },
  });
  const request = { signal: options.signal, timeout: options.timeoutMs };
  try {
    await client.connect(transport, request);
    return await work(client, request);
  } finally {
    await client.close().catch(() => {});
  }
}

export type McpCallResult = {
  /** Text parts joined with a new line. */
  text: string;
  /** `structuredContent`, or the text parsed as JSON, or null. */
  data: unknown;
  content: unknown[];
};

export async function callMcpTool(
  options: McpServerOptions,
  tool: string,
  args: Record<string, unknown>,
): Promise<McpCallResult> {
  return withClient(options, async (client, request) => {
    const result = await client.callTool({ name: tool, arguments: args }, undefined, request);
    const content = Array.isArray(result.content) ? (result.content as unknown[]) : [];
    const text = content
      .flatMap((part) =>
        typeof part === "object" && part !== null && (part as { type?: unknown }).type === "text"
          ? [String((part as { text?: unknown }).text ?? "")]
          : [],
      )
      .join("\n");
    if (result.isError) {
      throw new Error(`The MCP tool "${tool}" failed${text ? `: ${text}` : ""}`);
    }
    let data: unknown = result.structuredContent ?? null;
    if (data === null && text !== "") {
      try {
        data = JSON.parse(text);
      } catch {
        data = null;
      }
    }
    return { text, data, content };
  });
}
