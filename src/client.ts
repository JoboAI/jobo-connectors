import {
  CreditFloorReachedError,
  FeedCursorRestartRequiredError,
  InsufficientCreditsError,
  JoboApiError,
  RateLimitError,
} from "./errors";
import { resolveRetryOptions, withRetry, type RetryOptions, type RetryOverrides } from "./retry";
import type { Transport } from "./transport";
import type {
  ConnectorFiltersResponse,
  ExpiredJobIdsResponse,
  FilterOptionsResponse,
  Job,
  JobFeedParams,
  JobFeedResponse,
  JobSearchParams,
  JobSearchResponse,
  Result,
  SuggestLocationsResponse,
  UsageInfo,
} from "./types";

export const DEFAULT_BASE_URL = "https://connect.jobo.world";

/**
 * Shape of a Jobo API key: jbe_{live|test}_{21 chars}_{43 chars}.
 * The first 12 characters are the server's indexed lookup prefix.
 */
const API_KEY_PATTERN = /^jbe_(live|test)_[A-Za-z0-9_-]{21}_[A-Za-z0-9_-]{43}$/;

export function isValidApiKeyFormat(apiKey: string): boolean {
  return API_KEY_PATTERN.test(apiKey.trim());
}

/**
 * Cheap client-side shape check so a typo'd key fails instantly in the setup UI
 * instead of burning a round-trip (and a credit precheck) to learn it is wrong.
 * A well-formed key can still be revoked — this is a typo guard, not auth.
 */
export function assertValidApiKeyFormat(apiKey: string): void {
  if (!isValidApiKeyFormat(apiKey)) {
    throw new Error(
      "That does not look like a Jobo API key. Keys start with jbe_live_ or jbe_test_ and are 74 characters long. " +
        "Create one at https://enterprise.jobo.world/api-keys",
    );
  }
}

export interface JoboClientOptions {
  apiKey: string;
  baseUrl?: string;
  /**
   * Required. This package ships no default transport on purpose — see the note
   * on `Transport`. The host platform supplies HTTP, and with it the timer
   * globals that a verified n8n node is forbidden from bundling.
   */
  transport: Transport;
  /** Required, because `sleep` has no safe default. See `RetryOptions.sleep`. */
  retry: RetryOverrides;
  timeoutMs?: number;
  /**
   * Stop before issuing a request once the balance reported by the previous
   * response is at or below this many credits. Set to 0 to disable.
   */
  creditFloor?: number;
  /** Called after every response. Wire this to the host platform's run log. */
  onUsage?: (usage: UsageInfo) => void;
  /** Appended to the User-Agent so we can attribute traffic per connector. */
  userAgent?: string;
}

function toNumber(value: string | undefined): number | null {
  if (value == null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseUsage(headers: Record<string, string>): UsageInfo {
  return {
    creditsRequired: toNumber(headers["x-credits-required"]),
    creditsDeducted: toNumber(headers["x-credits-deducted"]),
    creditsBalance: toNumber(headers["x-credits-balance"]),
    rateLimitLimit: toNumber(headers["x-ratelimit-limit"]),
    rateLimitRemaining: toNumber(headers["x-ratelimit-remaining"]),
    rateLimitResetUnix: toNumber(headers["x-ratelimit-reset"]),
    rateLimitGroup: headers["x-ratelimit-group"] ?? null,
    quotaLimit: toNumber(headers["x-quota-limit"]),
    quotaRemaining: toNumber(headers["x-quota-remaining"]),
    totalCount: toNumber(headers["x-total-count"]),
  };
}

function encodeQuery(params: Record<string, unknown>): string {
  const parts: string[] = [];

  for (const [key, value] of Object.entries(params)) {
    if (value == null) continue;
    if (Array.isArray(value)) {
      // An empty array serialises as `key=`, preserving the API's tri-state
      // for CSV list params (absent → default, empty → none, csv → list).
      // That distinction is load-bearing for include_facets/include_fields
      // and harmless for the filter lists (`""` parses to no filter).
      parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(value.join(","))}`);
      continue;
    }
    parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`);
  }

  return parts.length > 0 ? `?${parts.join("&")}` : "";
}

export class JoboClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly transport: Transport;
  private readonly retry: RetryOptions;
  private readonly timeoutMs: number;
  private readonly creditFloor: number;
  private readonly onUsage: ((usage: UsageInfo) => void) | undefined;
  private readonly userAgent: string;

  /** Balance seen on the most recent response; drives the credit floor guard. */
  private lastKnownBalance: number | null = null;

  constructor(options: JoboClientOptions) {
    assertValidApiKeyFormat(options.apiKey);

    this.apiKey = options.apiKey.trim();
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
    this.transport = options.transport;
    this.retry = resolveRetryOptions(options.retry);
    this.timeoutMs = options.timeoutMs ?? 30_000;
    this.creditFloor = options.creditFloor ?? 0;
    this.onUsage = options.onUsage;
    this.userAgent = options.userAgent ?? "jobo-connector-core/0.2.0";
  }

  /** Balance from the last response, or null if no request has succeeded yet. */
  get creditBalance(): number | null {
    return this.lastKnownBalance;
  }

  async searchJobs(params: JobSearchParams = {}): Promise<Result<JobSearchResponse>> {
    return this.request<JobSearchResponse>("GET", `/api/jobs${encodeQuery(params as Record<string, unknown>)}`);
  }

  async searchJobsAdvanced(body: Record<string, unknown>): Promise<Result<JobSearchResponse>> {
    return this.request<JobSearchResponse>("POST", "/api/jobs/search", body);
  }

  /** Single job by id. Does not deduct credits, but does consume rate limit. */
  async getJob(id: string): Promise<Result<Job>> {
    return this.request<Job>("GET", `/api/jobs/${encodeURIComponent(id)}`);
  }

  async feed(params: JobFeedParams = {}): Promise<Result<JobFeedResponse>> {
    return this.request<JobFeedResponse>("POST", "/api/jobs/feed", params as Record<string, unknown>);
  }

  /** Recently expired job ids. Always free of credits on every tier. */
  async getExpiredJobIds(
    params: { expired_since?: string; cursor?: string; limit?: number } = {},
  ): Promise<Result<ExpiredJobIdsResponse>> {
    return this.request<ExpiredJobIdsResponse>(
      "GET",
      `/api/jobs/expired${encodeQuery(params as Record<string, unknown>)}`,
    );
  }

  async getCompany(id: string): Promise<Result<Record<string, unknown>>> {
    return this.request<Record<string, unknown>>("GET", `/api/companies/${encodeURIComponent(id)}`);
  }

  async geocode(location: string): Promise<Result<Record<string, unknown>>> {
    return this.request<Record<string, unknown>>("GET", `/api/locations/geocode${encodeQuery({ location })}`);
  }

  /**
   * Verify the key works, as cheaply as the API allows. `page_size=1` keeps the
   * worst-case credit precheck to a single job.
   */
  async verifyCredentials(): Promise<Result<JobSearchResponse>> {
    return this.searchJobs({ page_size: 1 });
  }

  /**
   * Canonical filter vocabulary: enum values plus the live source list.
   * Never deducts credits — safe to call on settings-screen load.
   */
  async filters(): Promise<Result<ConnectorFiltersResponse>> {
    return this.request<ConnectorFiltersResponse>("GET", "/api/connectors/filters");
  }

  /**
   * Typeahead over one dynamic facet's values. Empty `q` returns the top-N
   * buckets. Never deducts credits — safe on the keystroke path.
   */
  async filterOptions(
    facet: "sources" | "industries" | "skills",
    opts: { q?: string; limit?: number } = {},
  ): Promise<Result<FilterOptionsResponse>> {
    return this.request<FilterOptionsResponse>(
      "GET",
      `/api/connectors/filter-options/${encodeURIComponent(facet)}${encodeQuery(opts)}`,
    );
  }

  /**
   * Location typeahead. Suggestions carry the exact Photon-normalized
   * city/region/country labels the job index stores. Queries under 2
   * characters return an empty list server-side. Never deducts credits.
   */
  async suggestLocations(q: string, limit = 5): Promise<Result<SuggestLocationsResponse>> {
    return this.request<SuggestLocationsResponse>(
      "GET",
      `/api/connectors/locations/suggest${encodeQuery({ q, limit })}`,
    );
  }

  private async request<T>(
    method: "GET" | "POST",
    path: string,
    body?: Record<string, unknown>,
  ): Promise<Result<T>> {
    if (this.creditFloor > 0 && this.lastKnownBalance != null && this.lastKnownBalance <= this.creditFloor) {
      throw new CreditFloorReachedError(this.lastKnownBalance, this.creditFloor);
    }

    return withRetry(async () => {
      const response = await this.transport.request({
        method,
        url: `${this.baseUrl}${path}`,
        headers: {
          "X-Api-Key": this.apiKey,
          Accept: "application/json",
          "User-Agent": this.userAgent,
          ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
        timeoutMs: this.timeoutMs,
      });

      const usage = parseUsage(response.headers);
      if (usage.creditsBalance != null) this.lastKnownBalance = usage.creditsBalance;
      this.onUsage?.(usage);

      const parsed = parseBody(response.body);

      if (response.status >= 200 && response.status < 300) {
        return { data: parsed as T, usage };
      }

      throw toApiError(response.status, response.headers, parsed, usage);
    }, this.retry);
  }
}

function parseBody(raw: string): unknown {
  if (raw.length === 0) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

function readString(body: unknown, key: string): string | null {
  if (body && typeof body === "object" && key in body) {
    const value = (body as Record<string, unknown>)[key];
    if (typeof value === "string") return value;
  }
  return null;
}

function toApiError(
  status: number,
  headers: Record<string, string>,
  body: unknown,
  usage: UsageInfo,
): JoboApiError {
  const code = readString(body, "code");
  const detail = readString(body, "detail") ?? readString(body, "error") ?? readString(body, "title");
  const message = detail ?? `Jobo API returned HTTP ${status}`;
  const base = { status, message, code, detail, body, usage };

  if (status === 402) {
    return new InsufficientCreditsError(base);
  }

  if (status === 409 && code === "feed_cursor_restart_required") {
    const replacementRequest =
      body && typeof body === "object" ? (body as Record<string, unknown>).replacement_request : undefined;
    return new FeedCursorRestartRequiredError({ ...base, replacementRequest });
  }

  if (status === 429) {
    const header = toNumber(headers["retry-after"]);
    const fromBody =
      body && typeof body === "object" && typeof (body as Record<string, unknown>).retry_after_seconds === "number"
        ? ((body as Record<string, unknown>).retry_after_seconds as number)
        : null;
    return new RateLimitError({ ...base, retryAfterSeconds: header ?? fromBody });
  }

  return new JoboApiError(base);
}
