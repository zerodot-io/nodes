// SPDX-License-Identifier: AGPL-3.0-only
import type { Call } from "./api";
import type { HiggsfieldConfig } from "./config";

const need = (value: string | undefined, name: string, operation: string): string => {
  const text = value?.trim();
  if (!text) throw new Error(`Higgsfield ${operation} needs "${name}"`);
  return text;
};

const MODEL_PATH = /^[A-Za-z0-9][A-Za-z0-9._-]*(\/[A-Za-z0-9][A-Za-z0-9._-]*)*$/;
/** These paths are not models. */
const RESERVED = new Set(["requests", "v1"]);
/** The request ID goes in a path, so it must look like an ID. */
const REQUEST_ID = /^[A-Za-z0-9-]{8,64}$/;

/** The path of a model: names with slashes between. Never `..`, a query, or a host. */
export function modelPath(model: string | undefined): string {
  const text = need(model, "model", "generate").replace(/^\/+/, "");
  if (!MODEL_PATH.test(text) || text.split("/").includes("..")) {
    throw new Error('Higgsfield generate: "model" is not a model path');
  }
  if (RESERVED.has(text.split("/")[0] ?? "")) {
    throw new Error('Higgsfield generate: "model" is not a model path');
  }
  return `/${text}`;
}

/** The fields of the body: the prompt, then the JSON fields on top. */
export function bodyOf(prompt: string | undefined, parameters: string | undefined) {
  let fields: Record<string, unknown> = {};
  if (parameters?.trim()) {
    let value: unknown;
    try {
      value = JSON.parse(parameters);
    } catch {
      throw new Error('"parameters" must be JSON');
    }
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      throw new Error('"parameters" must be a JSON object');
    }
    fields = value as Record<string, unknown>;
  }
  const body = { ...(prompt?.trim() ? { prompt } : {}), ...fields };
  if (Object.keys(body).length === 0) {
    throw new Error('Higgsfield generate needs "prompt" or "parameters"');
  }
  return body;
}

export function requestIdOf(value: string | undefined, operation: string): string {
  const text = need(value, "requestId", operation);
  if (!REQUEST_ID.test(text)) throw new Error(`Higgsfield ${operation}: "requestId" is not an ID`);
  return text;
}

/** The Higgsfield call for one operation, without the network. */
export function buildRequest(c: HiggsfieldConfig): Call {
  switch (c.operation) {
    case "generate":
      return { method: "POST", path: modelPath(c.model), body: bodyOf(c.prompt, c.parameters) };
    case "get":
      return { method: "GET", path: `/requests/${requestIdOf(c.requestId, "get")}/status` };
    case "cancel":
      return { method: "POST", path: `/requests/${requestIdOf(c.requestId, "cancel")}/cancel` };
    case "delete":
      return { method: "DELETE", path: `/requests/${requestIdOf(c.requestId, "delete")}` };
  }
}
