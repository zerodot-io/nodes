// SPDX-License-Identifier: AGPL-3.0-only
import { PROVIDER_LABEL, type Provider } from "./access";
import { StatusError } from "./retry";

/** An error that a provider gave. `code` is the error code or type, for example `model_not_found`. */
export class AIError extends StatusError {
  readonly provider: Provider;
  readonly code: string | undefined;
  readonly requestId: string | undefined;
  readonly retryAfter: number | undefined;

  constructor(
    provider: Provider,
    message: string,
    status: number,
    code?: string,
    requestId?: string,
    retryAfter?: number,
  ) {
    super(message, status);
    this.name = "AIError";
    this.provider = provider;
    this.code = code;
    this.requestId = requestId;
    this.retryAfter = retryAfter;
  }
}

/** Short help for the OpenAI errors that people see most. */
const CODE_HINTS: Record<string, string> = {
  invalid_api_key: "OpenAI did not accept the API key",
  insufficient_quota: "The account has no credit left. Check the billing page",
  model_not_found: "The model does not exist, or the account cannot use it",
  context_length_exceeded: "The input is too long for the model",
  rate_limit_exceeded: "OpenAI limits the requests. Try again later",
  content_policy_violation: "OpenAI blocked the request because of its content policy",
};

/** Short help for the status codes. The name of the service comes first. */
const statusHint = (provider: Provider, status: number): string | undefined => {
  const name = PROVIDER_LABEL[provider];
  const hints: Record<number, string> = {
    401: `${name} did not accept the API key`,
    403: "The key cannot use this resource. Check the project, the organization, and the model",
    404: `${name} did not find the resource. Check the model ID and the base URL`,
    413: "The request is too large",
    429: `${name} limits the requests. Try again later`,
    529: `${name} is busy. Try again later`,
  };
  return hints[status];
};

export type Answer = Record<string, unknown> & {
  error?: {
    message?: string;
    type?: string;
    code?: string | number | null;
    status?: string;
  } | null;
};

/** The error for an answer with an error status. The text never has the key. */
export function errorOf(
  provider: Provider,
  label: string,
  status: number,
  answer: Answer | null,
  requestId?: string,
  retryAfter?: number,
): AIError {
  const found = answer?.error;
  const code =
    typeof found?.code === "string"
      ? found.code
      : typeof found?.type === "string"
        ? found.type
        : typeof found?.status === "string"
          ? found.status
          : undefined;
  const parts = [`${PROVIDER_LABEL[provider]} ${label} failed (${status})`];
  if (typeof found?.message === "string" && found.message) parts.push(found.message);
  const hint = (code && CODE_HINTS[code]) || statusHint(provider, status);
  if (hint) parts.push(hint);
  if (code) parts.push(`Error code ${code}`);
  if (requestId) parts.push(`Request ID ${requestId}`);
  if (retryAfter !== undefined) parts.push(`Try again in ${retryAfter} seconds`);
  return new AIError(provider, parts.join(". "), status, code, requestId, retryAfter);
}

export const retryAfterOf = (header: string | null | undefined): number | undefined => {
  const seconds = Number(header);
  return header != null && Number.isFinite(seconds) && seconds >= 0 ? seconds : undefined;
};

const parseAnswer = (body: string | undefined): Answer | null => {
  try {
    const value: unknown = JSON.parse(body ?? "");
    return typeof value === "object" && value !== null ? (value as Answer) : null;
  } catch {
    return null;
  }
};

/**
 * Runs an AI SDK call. An error status of the provider gives the same error as a REST call, so
 * the retry and the error text are the same for each kind of call.
 */
export async function sdkCall<T>(provider: Provider, label: string, call: () => Promise<T>) {
  try {
    return await call();
  } catch (error) {
    const { APICallError } = await import("ai");
    if (!APICallError.isInstance(error)) throw error;
    // An answer with a good status that the AI SDK cannot read, such as a proxy page.
    if (error.statusCode === undefined || error.statusCode < 400) {
      throw new Error(`${PROVIDER_LABEL[provider]} ${label}: ${error.message}`);
    }
    const headers = error.responseHeaders ?? {};
    throw errorOf(
      provider,
      label,
      error.statusCode,
      parseAnswer(error.responseBody),
      headers["request-id"],
      retryAfterOf(headers["retry-after"]),
    );
  }
}
