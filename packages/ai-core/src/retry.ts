// SPDX-License-Identifier: AGPL-3.0-only

/** An error of an API call that keeps the HTTP status. */
export class StatusError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

/** The statuses that can pass when the call runs again: rate limits and busy servers. */
const RETRY_STATUSES = new Set([408, 429, 500, 502, 503, 504, 529]);

export type RetryOptions = { attempts: number; baseMs: number };

const DEFAULT_RETRY: RetryOptions = { attempts: 4, baseMs: 1000 };

/** Waits, or stops when the signal stops. */
const wait = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const timer = setTimeout(done, ms);
    function done() {
      signal.removeEventListener("abort", stop);
      resolve();
    }
    function stop() {
      clearTimeout(timer);
      reject(signal.reason);
    }
    signal.addEventListener("abort", stop, { once: true });
  });

/**
 * Runs the call again after a rate limit or a server error, with a longer wait each time
 * (1 s, 2 s, 4 s, and a random part). Other errors fail at once.
 */
export async function withRetry<T>(
  call: () => Promise<T>,
  signal: AbortSignal,
  options: RetryOptions = DEFAULT_RETRY,
): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await call();
    } catch (error) {
      const again = error instanceof StatusError && RETRY_STATUSES.has(error.status);
      if (!again || attempt >= options.attempts || signal.aborted) throw error;
      const ms = options.baseMs * 2 ** (attempt - 1);
      await wait(ms + Math.random() * ms * 0.25, signal);
    }
  }
}
