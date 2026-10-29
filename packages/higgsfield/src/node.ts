// SPDX-License-Identifier: AGPL-3.0-only
import { randomUUID } from "node:crypto";
import { defineNode } from "@zerodot/node-sdk";
import {
  callHiggsfield,
  callWithRetry,
  HIGGSFIELD_CREDENTIAL,
  higgsfieldAccess,
  outputUrls,
  waitForRequest,
} from "./api";
import { higgsfieldConfig } from "./config";
import { HIGGSFIELD_ICON } from "./icon";
import { buildRequest } from "./request";

export default defineNode({
  type: "higgsfield.api",
  label: "Higgsfield",
  description: "Make AI images and videos with any Higgsfield model",
  category: "integration",
  app: "Higgsfield",
  // The names of the actions of the Higgsfield node.
  actions: [
    { label: "Generate an image or video", config: { operation: "generate" } },
    { label: "Get a request", config: { operation: "get" } },
    { label: "Cancel a request", config: { operation: "cancel" } },
    { label: "Delete request data", config: { operation: "delete" } },
  ],
  icon: "Video",
  iconUrl: HIGGSFIELD_ICON,
  config: higgsfieldConfig,
  defaultConfig: {
    operation: "generate",
    model: "",
    prompt: "",
    wait: true,
    waitTimeoutMs: 600_000,
    timeoutMs: 30_000,
  },
  credentialTypes: [HIGGSFIELD_CREDENTIAL],
  ports: { in: ["in"], out: ["out"] },
  subtitle: (config) =>
    config.operation === "generate" && typeof config.model === "string" && config.model !== ""
      ? config.model
      : typeof config.operation === "string"
        ? config.operation
        : undefined,
  async run({ config, credential, signal }) {
    const access = higgsfieldAccess(credential);
    const options = { signal, timeoutMs: config.timeoutMs };
    const call = buildRequest(config);

    if (config.operation !== "generate") {
      const data = await callHiggsfield(access, call, options);
      if (config.operation === "get")
        return { port: "out", data: { ...data, urls: outputUrls(data) } };
      // Cancel gives 202 without a body. An empty answer says that the call worked.
      return { port: "out", data: Object.keys(data).length > 0 ? data : { success: true } };
    }

    // The key lets a repeat after a timeout return the first request, not start a second.
    const key = config.idempotencyKey?.trim() || randomUUID();
    const submitted = await callWithRetry(
      access,
      { ...call, headers: { "idempotency-key": key } },
      options,
    );
    const requestId = submitted.request_id;
    if (typeof requestId !== "string" || requestId === "") {
      throw new Error("Higgsfield gave no request_id");
    }
    if (!config.wait) return { port: "out", data: submitted };

    const result = await waitForRequest(access, requestId, {
      ...options,
      waitTimeoutMs: config.waitTimeoutMs,
    });
    if (result.status !== "completed") {
      const reason = typeof result.error === "string" && result.error ? `: ${result.error}` : "";
      throw new Error(
        `Higgsfield request ${requestId} ended as "${String(result.status)}"${reason}`,
      );
    }
    return { port: "out", data: { ...result, urls: outputUrls(result) } };
  },
});
