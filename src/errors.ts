import type { UsageInfo } from "./types";

/** Base for everything this package throws. */
export class JoboError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
    // Required for `instanceof` to survive the ES5 downlevel some hosts apply.
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * A value the API would refuse or misread, caught before any request is made.
 * Nothing was sent and nothing was billed: the fix is in what the caller
 * passed, so hosts report it against the user's input, not as a failed call.
 */
export class JoboInputError extends JoboError {}

/** A non-2xx response from the API. */
export class JoboApiError extends JoboError {
  readonly status: number;
  /** Problem-details `code` extension where the API supplies one. */
  readonly code: string | null;
  readonly detail: string | null;
  readonly body: unknown;
  readonly usage: UsageInfo | null;
  /**
   * Seconds the API asked the caller to wait, from the `Retry-After` header or
   * a `retry_after_seconds` body field, whatever the status. Null when the
   * response named no delay.
   *
   * On a 503 its absence is a statement, not an omission: the API sends
   * `Retry-After` when the backend is unavailable and leaves it off the 503
   * for a search that ran out of time, because the same request fails the same
   * way again. See `isRetryable`.
   */
  readonly retryAfterSeconds: number | null;

  constructor(opts: {
    status: number;
    message: string;
    code?: string | null;
    detail?: string | null;
    body?: unknown;
    usage?: UsageInfo | null;
    retryAfterSeconds?: number | null;
  }) {
    super(opts.message);
    this.status = opts.status;
    this.code = opts.code ?? null;
    this.detail = opts.detail ?? null;
    this.body = opts.body ?? null;
    this.usage = opts.usage ?? null;
    this.retryAfterSeconds = opts.retryAfterSeconds ?? null;
  }
}

/**
 * HTTP 402 — the wallet cannot cover the request's worst-case cost after any
 * remaining included jobs.
 *
 * Terminal on purpose. The balance precheck prices the *requested* page_size,
 * not the rows actually returned, so a retry costs the same and fails the same
 * way; retrying only burns rate limit while the user's real problem
 * (insufficient wallet cover) goes unreported.
 */
export class InsufficientCreditsError extends JoboApiError {}

/**
 * HTTP 409 `feed_cursor_restart_required` — the held feed cursor can no longer
 * be honoured and the scan must restart. Never retryable with the same cursor;
 * the caller must drop it and resync.
 */
export class FeedCursorRestartRequiredError extends JoboApiError {
  /** The request body the API suggests replaying, when it supplies one. */
  readonly replacementRequest: unknown;

  constructor(opts: {
    status: number;
    message: string;
    code?: string | null;
    detail?: string | null;
    body?: unknown;
    usage?: UsageInfo | null;
    retryAfterSeconds?: number | null;
    replacementRequest?: unknown;
  }) {
    super(opts);
    this.replacementRequest = opts.replacementRequest ?? null;
  }
}

/** HTTP 429. Retryable; `retryAfterSeconds` mirrors the `Retry-After` header. */
export class RateLimitError extends JoboApiError {}

/**
 * @deprecated Never thrown. `creditFloor` is ignored, because a wallet balance
 * alone cannot tell whether the next request is free, covered by included
 * jobs, or unlimited; the server's 402 is the affordability guard. Kept so
 * code that still imports the class keeps compiling.
 */
export class CreditFloorReachedError extends JoboError {
  readonly balance: number;
  readonly floor: number;

  constructor(balance: number, floor: number) {
    super(
      `Stopping before the next request: wallet balance ${balance} credits is at or below the configured floor of ${floor}. ` +
        `Top up your wallet at https://enterprise.jobo.world/ or raise creditFloor to continue.`,
    );
    this.balance = balance;
    this.floor = floor;
  }
}

/** Transport-level failure (DNS, TLS, socket, timeout). Retryable. */
export class JoboTransportError extends JoboError {
  readonly cause: unknown;

  constructor(message: string, cause?: unknown) {
    super(message);
    this.cause = cause;
  }
}
