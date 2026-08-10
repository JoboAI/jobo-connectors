import {
  FeedCursorRestartRequiredError,
  InsufficientCreditsError,
  JoboApiError,
  JoboTransportError,
  RateLimitError,
} from "./errors";

export interface RetryOptions {
  /** Total attempts including the first. Default 3. */
  maxAttempts: number;
  /** Base delay for exponential backoff, in ms. Default 1000. */
  initialDelayMs: number;
  /** Upper bound on any single sleep, in ms. Default 60000. */
  maxDelayMs: number;
  /**
   * How to wait between attempts. Required, and deliberately not defaulted:
   * the obvious default is a timer global, which n8n's verified-node scanner
   * bans, and a default referenced from this module would be inlined into
   * every consumer's bundle whether or not it was used. The host already knows
   * how to sleep — n8n exports `sleep` from `n8n-workflow`, Apps Script has
   * `Utilities.sleep` — so it supplies one.
   */
  sleep: (ms: number) => Promise<void>;
  /** Injectable for deterministic jitter in tests. Returns [0, 1). */
  random: () => number;
}

/** Everything with a sane default — i.e. everything except `sleep`. */
export type RetryDefaults = Omit<RetryOptions, "sleep">;

/**
 * Caller-facing shape: tune whatever you like, but `sleep` is not optional.
 */
export type RetryOverrides = Partial<RetryDefaults> & Pick<RetryOptions, "sleep">;

export const defaultRetryOptions: RetryDefaults = {
  maxAttempts: 3,
  initialDelayMs: 1000,
  maxDelayMs: 60_000,
  random: Math.random,
};

/** Fill the defaults in around a caller-supplied `sleep`. */
export function resolveRetryOptions(overrides: RetryOverrides): RetryOptions {
  return { ...defaultRetryOptions, ...overrides };
}

/**
 * Whether an error is worth another attempt.
 *
 * Two deliberate non-retryables, both of which look retryable at a glance:
 *
 *  - 402 Insufficient credits. The precheck prices the requested page_size, not
 *    the rows returned, after applying remaining shared allowance, so an
 *    immediate retry fails identically. Retrying hides insufficient wallet
 *    cover behind a generic timeout.
 *  - 409 feed_cursor_restart_required. The held cursor is void; replaying it is
 *    guaranteed to fail. The caller must drop the cursor and resync.
 */
export function isRetryable(error: unknown): boolean {
  if (error instanceof InsufficientCreditsError) return false;
  if (error instanceof FeedCursorRestartRequiredError) return false;
  if (error instanceof RateLimitError) return true;
  if (error instanceof JoboTransportError) return true;
  if (error instanceof JoboApiError) {
    return error.status === 408 || error.status >= 500;
  }
  return false;
}

/**
 * Delay before the next attempt.
 *
 * `Retry-After` is honoured literally when the server sends one — the feed
 * endpoint returns `503 Retry-After: 5` under load and second-guessing it just
 * makes the overload worse. Otherwise exponential backoff with full jitter.
 */
export function nextDelayMs(error: unknown, attempt: number, options: RetryOptions): number {
  if (error instanceof RateLimitError && error.retryAfterSeconds != null) {
    return Math.min(error.retryAfterSeconds * 1000, options.maxDelayMs);
  }
  if (error instanceof JoboApiError) {
    const retryAfter = readRetryAfterSeconds(error);
    if (retryAfter != null) {
      return Math.min(retryAfter * 1000, options.maxDelayMs);
    }
  }

  const exponential = options.initialDelayMs * 2 ** (attempt - 1);
  const capped = Math.min(exponential, options.maxDelayMs);
  return Math.floor(capped * options.random());
}

function readRetryAfterSeconds(error: JoboApiError): number | null {
  const body = error.body;
  if (body && typeof body === "object" && "retry_after_seconds" in body) {
    const value = (body as { retry_after_seconds?: unknown }).retry_after_seconds;
    if (typeof value === "number" && Number.isFinite(value)) return value;
  }
  return null;
}

export async function withRetry<T>(operation: () => Promise<T>, options: RetryOptions): Promise<T> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= options.maxAttempts; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (!isRetryable(error) || attempt === options.maxAttempts) throw error;
      await options.sleep(nextDelayMs(error, attempt, options));
    }
  }

  throw lastError;
}
