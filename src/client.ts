import {
  FeedCursorRestartRequiredError,
  InsufficientCreditsError,
  JoboApiError,
  JoboError,
  JoboTransportError,
  RateLimitError,
} from "./errors";
import { resolveRetryOptions, withRetry, type RetryOptions, type RetryOverrides } from "./retry";
import { COMPANY_SIGNAL_FILTER_KEYS, toSignalsQuery } from "./signals";
import type { Transport, TransportRequest, TransportResponse } from "./transport";
import { VERSION } from "./version";
import type { FilterOptionsFacet } from "./filters";
import type {
  CompanySignalFilters,
  ConnectorFiltersResponse,
  ExpiredJobIdsResponse,
  FilterOptionsResponse,
  HiringSignalFilters,
  HiringSignalListResponse,
  HiringSignalPaging,
  Job,
  JobFeedParams,
  JobFeedResponse,
  JobSearchParams,
  JobSearchRequest,
  JobSearchResponse,
  OccupationTaxonomyResponse,
  Result,
  SuggestCompaniesResponse,
  SuggestLocationsResponse,
  UsageInfo,
} from "./types";

export const DEFAULT_BASE_URL = "https://connect.jobo.world";

/**
 * Default timeout for a feed page, in ms. The feed gives itself 90 seconds to
 * answer and asks clients to wait at least 120; the ordinary 30-second timeout
 * cuts off a slow page that was about to arrive, and the retry asks for the
 * same slow page.
 */
export const DEFAULT_FEED_TIMEOUT_MS = 130_000;

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
  /** Timeout for every request except a feed page, in ms. Default 30000. */
  timeoutMs?: number;
  /**
   * Timeout for a feed page, in ms. Default `DEFAULT_FEED_TIMEOUT_MS`. Lower
   * it only where the host ends the whole run sooner than that.
   */
  feedTimeoutMs?: number;
  /**
   * @deprecated Ignored. A wallet balance alone cannot tell whether the next
   * request is free, allowance-covered, or unlimited; the server's 402
   * precheck is the authoritative affordability guard.
   */
  creditFloor?: number;
  /** Called after every response. Wire this to the host platform's run log. */
  onUsage?: (usage: UsageInfo) => void;
  /** Appended to the User-Agent so we can attribute traffic per connector. */
  userAgent?: string;
  /**
   * Connector name sent as `X-Jobo-Client`, e.g. `n8n` or `wordpress`.
   *
   * Redundant with the User-Agent in principle, and not in practice: hosts own
   * their HTTP stack and are free to rewrite or drop a User-Agent, so the one
   * signal we need to be able to trust is the one nothing else claims. The
   * server matches it against a fixed allowlist and tags the request metric
   * with it — anything unrecognised counts as `other`, so inventing new names
   * here without the matching server-side entry loses the attribution.
   */
  client?: string;
}

function toNumber(value: string | undefined): number | null {
  if (value == null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/** The response's `Date` header as an ISO timestamp, or null when absent or unreadable. */
function parseServerTime(headers: Record<string, string>): string | null {
  const raw = headers["date"];
  if (!raw) return null;
  const parsed = new Date(raw).getTime();
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

/** An id that goes into a path. An empty one would turn `/api/jobs/{id}` into the billed `/api/jobs/`. */
function requireId(id: string, what: string): string {
  const trimmed = typeof id === "string" ? id.trim() : "";
  if (trimmed === "") throw new JoboError(`A ${what} id is required.`);
  return trimmed;
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
  private readonly feedTimeoutMs: number;
  private readonly onUsage: ((usage: UsageInfo) => void) | undefined;
  private readonly userAgent: string;
  private readonly client: string | undefined;

  /** Balance seen on the most recent response for display only. */
  private lastKnownBalance: number | null = null;

  constructor(options: JoboClientOptions) {
    assertValidApiKeyFormat(options.apiKey);

    this.apiKey = options.apiKey.trim();
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
    this.transport = options.transport;
    this.retry = resolveRetryOptions(options.retry);
    this.timeoutMs = options.timeoutMs ?? 30_000;
    this.feedTimeoutMs = options.feedTimeoutMs ?? DEFAULT_FEED_TIMEOUT_MS;
    this.onUsage = options.onUsage;
    this.userAgent = options.userAgent ?? `jobo-connector-core/${VERSION}`;
    this.client = options.client?.trim() || undefined;
  }

  /** Balance from the last response, or null if no request has succeeded yet. */
  get creditBalance(): number | null {
    return this.lastKnownBalance;
  }

  /** Billed per job returned, so a lost response is not replayed. See `RetryScope`. */
  async searchJobs(params: JobSearchParams = {}): Promise<Result<JobSearchResponse>> {
    return this.request<JobSearchResponse>("GET", `/api/jobs${encodeQuery(params as Record<string, unknown>)}`, undefined, {
      replaySafe: false,
    });
  }

  /**
   * `POST /api/jobs/search`: every search filter, including companies and the
   * exclude halves the GET endpoint lacks. Build the body with
   * `toJobSearchBody()` rather than by hand — the include/exclude filters are
   * nested objects, and a flat key binds nothing.
   *
   * Billed per job returned, so a lost response is not replayed. See `RetryScope`.
   */
  async searchJobsAdvanced(body: JobSearchRequest | Record<string, unknown>): Promise<Result<JobSearchResponse>> {
    return this.request<JobSearchResponse>("POST", "/api/jobs/search", body as Record<string, unknown>, {
      replaySafe: false,
    });
  }

  /** Single job by id. Does not deduct credits, but does consume rate limit. */
  async getJob(id: string): Promise<Result<Job>> {
    return this.request<Job>("GET", `/api/jobs/${encodeURIComponent(requireId(id, "job"))}`);
  }

  /**
   * One feed page. Waits `feedTimeoutMs`, not `timeoutMs`: a feed page may
   * take up to 90 seconds. Safe to replay, because a job the account already
   * received is delivered again at no charge.
   */
  async feed(params: JobFeedParams = {}): Promise<Result<JobFeedResponse>> {
    return this.request<JobFeedResponse>("POST", "/api/jobs/feed", params as Record<string, unknown>, {
      timeoutMs: this.feedTimeoutMs,
    });
  }

  /**
   * Recently expired job ids. Always free of credits on every tier.
   *
   * `batch_size` is ids per page: 1 to 10,000, default 1,000. `limit` is the
   * name this method took before 0.6.0; the API never read it, so it is sent
   * as `batch_size` when `batch_size` is not given.
   */
  async getExpiredJobIds(
    params: { expired_since?: string; cursor?: string; batch_size?: number; limit?: number } = {},
  ): Promise<Result<ExpiredJobIdsResponse>> {
    const { limit, ...rest } = params;
    const query = { ...rest, batch_size: rest.batch_size ?? limit };
    return this.request<ExpiredJobIdsResponse>(
      "GET",
      `/api/jobs/expired${encodeQuery(query as Record<string, unknown>)}`,
    );
  }

  async getCompany(id: string): Promise<Result<Record<string, unknown>>> {
    return this.request<Record<string, unknown>>(
      "GET",
      `/api/companies/${encodeURIComponent(requireId(id, "company"))}`,
    );
  }

  /**
   * `GET /api/signals`: hiring signals, newest detection day first unless
   * `paging.sort` asks for the stored order.
   *
   * Billed per signal returned, at ten times a job's rate, and a signal read
   * again is billed again: take `limit` from the caller, and never page
   * further than was asked for. A page that returns nothing is free. Not
   * replayed after a lost response, like a search — see `RetryScope`.
   *
   * To read only what is new, pass `sort: "created_asc"` and `created_after`
   * the `created_at` of the last signal read, as the string it came as;
   * `pollSignals()` does that and keeps the position.
   */
  async listSignals(
    filters: HiringSignalFilters = {},
    paging: HiringSignalPaging = {},
  ): Promise<Result<HiringSignalListResponse>> {
    return this.request<HiringSignalListResponse>(
      "GET",
      `/api/signals${encodeQuery(toSignalsQuery(filters, paging))}`,
      undefined,
      { replaySafe: false },
    );
  }

  /**
   * `GET /api/companies/{id}/signals`: one company's signals, newest first
   * unless `paging.sort` asks for the stored order. Takes the id from a job's
   * or a signal's `company.id`, and only the filters in
   * `COMPANY_SIGNAL_FILTER_KEYS`. Billed like `listSignals`.
   */
  async listCompanySignals(
    companyId: string,
    filters: CompanySignalFilters = {},
    paging: HiringSignalPaging = {},
  ): Promise<Result<HiringSignalListResponse>> {
    const query = toSignalsQuery(filters, paging, COMPANY_SIGNAL_FILTER_KEYS);
    return this.request<HiringSignalListResponse>(
      "GET",
      `/api/companies/${encodeURIComponent(requireId(companyId, "company"))}/signals${encodeQuery(query)}`,
      undefined,
      { replaySafe: false },
    );
  }

  /** Charged per successful lookup, so a lost response is not replayed. */
  async geocode(location: string): Promise<Result<Record<string, unknown>>> {
    return this.request<Record<string, unknown>>(
      "GET",
      `/api/locations/geocode${encodeQuery({ location })}`,
      undefined,
      { replaySafe: false },
    );
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
    facet: FilterOptionsFacet,
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

  /**
   * Company typeahead: real companies whose name or website domain starts with
   * `q`, each with every catalog board id (`ids`) and its live job count.
   * Send all of a picked company's `ids` as `companies` filter values. Queries
   * under 2 characters return an empty list server-side. Never deducts credits.
   */
  async suggestCompanies(q: string, limit = 8): Promise<Result<SuggestCompaniesResponse>> {
    return this.request<SuggestCompaniesResponse>(
      "GET",
      `/api/connectors/companies/suggest${encodeQuery({ q, limit })}`,
    );
  }

  /**
   * The occupation taxonomy: categories, subcategories and occupations, the
   * values `job_categories`, `job_subcategories` and `occupation_ids` take.
   * One response, no pagination; 404 until occupations are published.
   * Never deducts credits.
   */
  async occupations(): Promise<Result<OccupationTaxonomyResponse>> {
    return this.request<OccupationTaxonomyResponse>("GET", "/api/occupations");
  }

  private async request<T>(
    method: "GET" | "POST",
    path: string,
    body?: Record<string, unknown>,
    opts: { replaySafe?: boolean; timeoutMs?: number } = {},
  ): Promise<Result<T>> {
    return withRetry(
      async () => {
        const response = await this.send({
          method,
          url: `${this.baseUrl}${path}`,
          headers: {
            "X-Api-Key": this.apiKey,
            Accept: "application/json",
            "User-Agent": this.userAgent,
            ...(this.client !== undefined ? { "X-Jobo-Client": this.client } : {}),
            ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
          },
          body: body !== undefined ? JSON.stringify(body) : undefined,
          timeoutMs: opts.timeoutMs ?? this.timeoutMs,
        });

        const usage = parseUsage(response.headers);
        if (usage.creditsBalance != null) this.lastKnownBalance = usage.creditsBalance;
        this.onUsage?.(usage);

        const parsed = parseBody(response.body);

        if (response.status >= 200 && response.status < 300) {
          return { data: parsed as T, usage, serverTime: parseServerTime(response.headers) };
        }

        throw toApiError(response.status, response.headers, parsed, usage);
      },
      this.retry,
      { replaySafe: opts.replaySafe },
    );
  }

  /**
   * Call the transport, turning whatever it throws into a `JoboTransportError`.
   *
   * Hosts throw their own error types for a timeout or a dropped connection,
   * and the retry policy only knows this one: without the wrapping, a feed
   * page that timed out was never retried on a host whose transport did not
   * do the wrapping itself.
   */
  private async send(req: TransportRequest): Promise<TransportResponse> {
    try {
      return await this.transport.request(req);
    } catch (error) {
      if (error instanceof JoboError) throw error;
      const reason = error instanceof Error ? error.message : String(error);
      throw new JoboTransportError(`Could not reach the Jobo API: ${reason}`, error);
    }
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

  // Read on every status, not only 429: the feed and search answer
  // `503 Retry-After: 5` while their backend recovers, and whether a 503
  // carries the header at all is what tells a retryable outage from a search
  // that ran out of time.
  const fromBody =
    body && typeof body === "object" && typeof (body as Record<string, unknown>).retry_after_seconds === "number"
      ? ((body as Record<string, unknown>).retry_after_seconds as number)
      : null;
  const retryAfterSeconds = toNumber(headers["retry-after"]) ?? fromBody;

  const base = { status, message, code, detail, body, usage, retryAfterSeconds };

  if (status === 402) {
    return new InsufficientCreditsError(base);
  }

  if (status === 409 && code === "feed_cursor_restart_required") {
    const replacementRequest =
      body && typeof body === "object" ? (body as Record<string, unknown>).replacement_request : undefined;
    return new FeedCursorRestartRequiredError({ ...base, replacementRequest });
  }

  if (status === 429) {
    return new RateLimitError(base);
  }

  return new JoboApiError(base);
}
