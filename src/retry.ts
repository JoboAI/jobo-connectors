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
  /**
   * Whether a 429 is worth another attempt inside the same call. Default true.
   *
   * Pollers set this false. A poller that retries a rate limit in-tick spends
   * three requests to learn what one already told it, then does the same thing
   * on the next tick — and the caller loses nothing by giving up early, because
   * the watermark is untouched and the next poll re-queries the same window.
   * Request-scoped callers keep the default: for them the retry is the only
   * chance to succeed.
   */
  retryRateLimit: boolean;
}

/** Everything with a sane default — i.e. everything except `sleep`. */
export type RetryDefaults = Omit<RetryOptions, "sleep">;

/**
 * Caller-facing shape: tune whatever you like, but `sleep` is not optional.
 */
export type RetryOverrides = Partial<RetryDefaults> & Pick<RetryOptions, "sleep">;

/**
 * What kind of request is being retried.
 *
 * `replaySafe: false` marks a request that is charged for what it returns
 * (search, geocode). The API settles the charge before it sends the response,
 * so when the response is lost — a timeout, a dropped connection, a 500 raised
 * while the body was being built — the request may already have been paid for,
 * and sending it again pays again. Those requests are only replayed when the
 * API itself said nothing happened: a 429, or a 503 carrying `Retry-After`.
 *
 * Everything else is safe to replay: free endpoints, and the feed, which
 * delivers a job the account already received at no charge.
 */
export interface RetryScope {
  replaySafe?: boolean;
}

export const defaultRetryOptions: RetryDefaults = {
  maxAttempts: 3,
  initialDelayMs: 1000,
  maxDelayMs: 60_000,
  random: Math.random,
  retryRateLimit: true,
};

/** Fill the defaults in around a caller-supplied `sleep`. */
export function resolveRetryOptions(overrides: RetryOverrides): RetryOptions {
  return { ...defaultRetryOptions, ...overrides };
}

/** A JSON body, which only the API sends: a proxy in front of it answers HTML or nothing. */
function isApiBody(body: unknown): boolean {
  return body != null && typeof body === "object";
}

/**
 * Whether an error is worth another attempt.
 *
 * Three deliberate non-retryables, all of which look retryable at a glance:
 *
 *  - 402 Insufficient credits. The precheck prices the requested page_size, not
 *    the rows returned, after applying remaining shared allowance, so an
 *    immediate retry fails identically. Retrying hides insufficient wallet
 *    cover behind a generic timeout.
 *  - 409 feed_cursor_restart_required. The held cursor is void; replaying it is
 *    guaranteed to fail. The caller must drop the cursor and resync.
 *  - A 503 the API sent without `Retry-After`. It sends the header when the
 *    backend is unavailable, and leaves it off when a search ran out of time:
 *    the same request runs out of time again, and each attempt holds a search
 *    thread for the full limit. A 503 with no JSON body came from a proxy, not
 *    the API, and stays retryable.
 *
 * 429 is retryable by default but callers may opt out — see
 * `RetryOptions.retryRateLimit`. A request that is not `replaySafe` is only
 * retried on a 429 or a 503 with `Retry-After` — see `RetryScope`.
 */
export function isRetryable(
  error: unknown,
  options?: Pick<RetryOptions, "retryRateLimit"> & RetryScope,
): boolean {
  if (error instanceof InsufficientCreditsError) return false;
  if (error instanceof FeedCursorRestartRequiredError) return false;
  if (error instanceof RateLimitError) return options?.retryRateLimit !== false;

  const replaySafe = options?.replaySafe !== false;

  if (error instanceof JoboTransportError) return replaySafe;
  if (error instanceof JoboApiError) {
    if (error.status === 503) {
      if (error.retryAfterSeconds != null) return true;
      return replaySafe && !isApiBody(error.body);
    }
    return replaySafe && (error.status === 408 || error.status >= 500);
  }
  return false;
}

/**
 * Delay before the next attempt.
 *
 * `Retry-After` is honoured literally when the server sends one, on any
 * status — the feed and search endpoints return `503 Retry-After: 5` while
 * their backend recovers, and second-guessing it just makes the overload
 * worse. Otherwise exponential backoff with full jitter.
 */
export function nextDelayMs(error: unknown, attempt: number, options: RetryOptions): number {
  if (error instanceof JoboApiError && error.retryAfterSeconds != null) {
    return Math.min(error.retryAfterSeconds * 1000, options.maxDelayMs);
  }

  const exponential = options.initialDelayMs * 2 ** (attempt - 1);
  const capped = Math.min(exponential, options.maxDelayMs);
  return Math.floor(capped * options.random());
}

export async function withRetry<T>(
  operation: () => Promise<T>,
  options: RetryOptions,
  scope: RetryScope = {},
): Promise<T> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= options.maxAttempts; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      const retryable = isRetryable(error, { retryRateLimit: options.retryRateLimit, replaySafe: scope.replaySafe });
      if (!retryable || attempt === options.maxAttempts) throw error;
      await options.sleep(nextDelayMs(error, attempt, options));
    }
  }

  throw lastError;
}
