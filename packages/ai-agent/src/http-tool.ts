// SPDX-License-Identifier: AGPL-3.0-only
import { isRecord, type ResolvedCredential } from "@zerodot/node-sdk";
import { z } from "zod";
import { credentialHeader } from "./tools";
import type { Tool } from "./types";

type JsonObject = Record<string, unknown>;

/** `{name}` in the URL or the body. The model gives the value. */
const PLACEHOLDER = /\{([A-Za-z_][A-Za-z0-9_]{0,63})\}/g;

export const PLACEHOLDER_TYPES = ["string", "number", "boolean", "json"] as const;
type PlaceholderType = (typeof PLACEHOLDER_TYPES)[number];

const placeholderRows = z
  .object({
    values: z
      .array(
        z.object({
          name: z.string().trim().default(""),
          description: z.string().default(""),
          type: z.enum(PLACEHOLDER_TYPES).default("string"),
        }),
      )
      .default([]),
  })
  .default({ values: [] });

export type HttpToolOptions = {
  name: string;
  description: string;
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  url: string;
  /** A JSON body with placeholders, or empty. */
  body: string;
  /** The rows of the Placeholders field. */
  placeholders: unknown;
  credential: ResolvedCredential | null;
  timeoutMs: number;
};

/** The names of the placeholders in a text, in order, without repeats. */
export const placeholdersIn = (text: string): string[] => [
  ...new Set([...text.matchAll(PLACEHOLDER)].map((match) => match[1] as string)),
];

const SCHEMA_OF: Record<PlaceholderType, JsonObject> = {
  string: { type: "string" },
  number: { type: "number" },
  boolean: { type: "boolean" },
  json: {},
};

/** The input schema: one property for each placeholder of the URL and the body. */
export function httpToolSchema(options: Pick<HttpToolOptions, "url" | "body" | "placeholders">) {
  const rows = placeholderRows.safeParse(options.placeholders ?? undefined);
  if (!rows.success) throw new Error('"placeholders" is not a list of placeholders');
  const described = new Map(rows.data.values.map((row) => [row.name, row]));
  const names = placeholdersIn(`${options.url}\n${options.body}`);
  const properties = Object.fromEntries(
    names.map((name) => {
      const row = described.get(name);
      return [
        name,
        {
          ...SCHEMA_OF[row?.type ?? "string"],
          ...(row?.description ? { description: row.description } : {}),
        },
      ];
    }),
  );
  return { type: "object", properties, required: names, additionalProperties: false };
}

/** Puts the values of the model in a text. `encode` makes each value safe for its place. */
function fill(text: string, input: JsonObject, encode: (value: unknown) => string): string {
  return text.replace(PLACEHOLDER, (_all, name: string) => {
    if (!(name in input)) throw new Error(`The input has no "${name}"`);
    return encode(input[name]);
  });
}

/** The response as JSON when it is JSON, or as text. */
async function readResponse(response: Response): Promise<unknown> {
  const text = await response.text();
  if ((response.headers.get("content-type") ?? "").includes("json")) {
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  }
  return text;
}

/** A tool that sends one HTTP request. The model fills the placeholders. */
export function httpTool(options: HttpToolOptions): Tool {
  const inputSchema = httpToolSchema(options);
  return {
    spec: { name: options.name, description: options.description, inputSchema },
    async call(input, signal) {
      const values = isRecord(input) ? input : {};
      const url = fill(options.url, values, (value) => encodeURIComponent(String(value)));
      let parsed: URL;
      try {
        parsed = new URL(url);
      } catch {
        throw new Error(`"${url}" is not a valid URL`);
      }
      if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
        throw new Error("The URL must start with https:// or http://");
      }
      const headers: Record<string, string> = { accept: "application/json, text/*" };
      if (options.credential) {
        const [name, value] = credentialHeader(options.credential);
        headers[name] = value;
      }
      let body: string | undefined;
      if (options.body.trim() && options.method !== "GET") {
        // A value goes in as JSON, so text gets its quotes: {"email": {email}}.
        body = fill(options.body, values, (value) => JSON.stringify(value ?? null));
        try {
          JSON.parse(body);
        } catch {
          throw new Error("The body is not valid JSON after the values went in");
        }
        headers["content-type"] = "application/json";
      }
      const response = await fetch(parsed, {
        method: options.method,
        headers,
        body,
        signal: AbortSignal.any([signal, AbortSignal.timeout(options.timeoutMs)]),
      });
      const result = await readResponse(response);
      if (!response.ok) {
        const detail = typeof result === "string" ? result : JSON.stringify(result);
        throw new Error(`HTTP ${response.status}: ${detail.slice(0, 500)}`);
      }
      return result;
    },
  };
}
