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

/** A non-2xx response from the API. */
export class JoboApiError extends JoboError {
  readonly status: number;
  /** Problem-details `code` extension where the API supplies one. */
  readonly code: string | null;
  readonly detail: string | null;
  readonly body: unknown;
  readonly usage: UsageInfo | null;

  constructor(opts: {
    status: number;
    message: string;
    code?: string | null;
    detail?: string | null;
    body?: unknown;
    usage?: UsageInfo | null;
  }) {
    super(opts.message);
    this.status = opts.status;
    this.code = opts.code ?? null;
    this.detail = opts.detail ?? null;
    this.body = opts.body ?? null;
    this.usage = opts.usage ?? null;
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
    replacementRequest?: unknown;
  }) {
    super(opts);
    this.replacementRequest = opts.replacementRequest ?? null;
  }
}

/** HTTP 429. Retryable; `retryAfterSeconds` mirrors the `Retry-After` header. */
export class RateLimitError extends JoboApiError {
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
    super(opts);
    this.retryAfterSeconds = opts.retryAfterSeconds ?? null;
  }
}

/**
 * Client-side guard, not an API response. Thrown before a request when the
 * balance reported by the previous response has fallen below the configured
 * floor. This is what stops a broad filter from draining a wallet between two
 * refreshes of the host platform's UI.
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
