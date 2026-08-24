import { describe, expect, it } from "vitest";
import { JoboClient, assertValidApiKeyFormat, isValidApiKeyFormat } from "./client";
import {
  FeedCursorRestartRequiredError,
  InsufficientCreditsError,
  JoboApiError,
  RateLimitError,
} from "./errors";
import type { Transport, TransportRequest, TransportResponse } from "./transport";

const VALID_KEY = `jbe_live_${"a".repeat(21)}_${"b".repeat(43)}`;

interface Canned {
  status: number;
  headers?: Record<string, string>;
  body?: unknown;
}

/** Replays a queued list of responses and records every request made. */
function stubTransport(responses: Canned[]): Transport & { requests: TransportRequest[] } {
  const queue = [...responses];
  const requests: TransportRequest[] = [];

  return {
    requests,
    async request(req: TransportRequest): Promise<TransportResponse> {
      requests.push(req);
      const next = queue.shift();
      if (!next) throw new Error("stubTransport ran out of responses");
      return {
        status: next.status,
        headers: next.headers ?? {},
        body: next.body === undefined ? "" : JSON.stringify(next.body),
      };
    },
  };
}

function makeClient(transport: Transport, overrides: Record<string, unknown> = {}) {
  return new JoboClient({
    apiKey: VALID_KEY,
    transport,
    // No real sleeping in tests; jitter pinned for determinism.
    retry: { sleep: async () => {}, random: () => 0.5 },
    ...overrides,
  });
}

describe("API key format validation", () => {
  it("accepts a well-formed live key", () => {
    expect(isValidApiKeyFormat(VALID_KEY)).toBe(true);
  });

  it("accepts a test key", () => {
    expect(isValidApiKeyFormat(`jbe_test_${"a".repeat(21)}_${"b".repeat(43)}`)).toBe(true);
  });

  it.each([
    ["wrong prefix", `sk_live_${"a".repeat(21)}_${"b".repeat(43)}`],
    ["short secret", `jbe_live_${"a".repeat(21)}_${"b".repeat(10)}`],
    ["empty", ""],
  ])("rejects %s", (_label, key) => {
    expect(isValidApiKeyFormat(key)).toBe(false);
  });

  it("throws with a link to the key page", () => {
    expect(() => assertValidApiKeyFormat("nope")).toThrow(/enterprise\.jobo\.world\/api-keys/);
  });
});

describe("error mapping and retry policy", () => {
  it("does not retry 402 — a retry costs the same and fails the same", async () => {
    const transport = stubTransport([
      {
        status: 402,
        body: {
          error: "Insufficient credits",
          detail: "This request needs 300 credits ($0.30). Your wallet balance is 120 credits ($0.12). Top up your wallet to continue.",
        },
      },
    ]);
    const client = makeClient(transport);

    await expect(client.searchJobs({ q: "rust" })).rejects.toBeInstanceOf(InsufficientCreditsError);
    expect(transport.requests).toHaveLength(1);
  });

  it("does not retry a void feed cursor", async () => {
    const transport = stubTransport([
      {
        status: 409,
        body: { code: "feed_cursor_restart_required", detail: "Cursor expired.", replacement_request: { batch_size: 500 } },
      },
    ]);
    const client = makeClient(transport);

    const error = await client.feed({ cursor: "stale" }).catch((e) => e);
    expect(error).toBeInstanceOf(FeedCursorRestartRequiredError);
    expect((error as FeedCursorRestartRequiredError).replacementRequest).toEqual({ batch_size: 500 });
    expect(transport.requests).toHaveLength(1);
  });

  it("retries a 429 and honours Retry-After", async () => {
    const delays: number[] = [];
    const transport = stubTransport([
      { status: 429, headers: { "retry-after": "7" }, body: { error: "Rate limit exceeded" } },
      { status: 200, body: { jobs: [], total: 0, page: 1, page_size: 25, total_pages: 0, facets: {} } },
    ]);
    const client = makeClient(transport, {
      retry: { sleep: async (ms: number) => void delays.push(ms), random: () => 0.5 },
    });

    const result = await client.searchJobs({ q: "rust" });
    expect(result.data.total).toBe(0);
    expect(transport.requests).toHaveLength(2);
    expect(delays).toEqual([7000]);
  });

  it("lets a poller opt out of retrying 429, while still retrying 5xx", async () => {
    const transport = stubTransport([
      { status: 429, headers: { "retry-after": "7" }, body: { error: "Rate limit exceeded" } },
    ]);
    const client = makeClient(transport, {
      retry: { sleep: async () => {}, random: () => 0.5, retryRateLimit: false },
    });

    // Three requests to learn what the first already said, on a schedule that
    // will ask again anyway — the poll's watermark is untouched either way.
    await expect(client.searchJobs({ q: "rust" })).rejects.toBeInstanceOf(RateLimitError);
    expect(transport.requests).toHaveLength(1);
  });

  it("still retries 5xx when 429 retries are off — the two are unrelated", async () => {
    const transport = stubTransport([
      { status: 503, body: { error: "Service unavailable" } },
      { status: 200, body: { jobs: [], total: 0, page: 1, page_size: 25, total_pages: 0, facets: {} } },
    ]);
    const client = makeClient(transport, {
      retry: { sleep: async () => {}, random: () => 0.5, retryRateLimit: false },
    });

    await client.searchJobs({ q: "rust" });
    expect(transport.requests).toHaveLength(2);
  });

  it("retries 5xx up to the attempt cap then surfaces the error", async () => {
    const transport = stubTransport([
      { status: 500, body: { detail: "boom" } },
      { status: 500, body: { detail: "boom" } },
      { status: 500, body: { detail: "boom" } },
    ]);
    const client = makeClient(transport);

    await expect(client.searchJobs({ q: "rust" })).rejects.toBeInstanceOf(JoboApiError);
    expect(transport.requests).toHaveLength(3);
  });

  it("does not retry a 400", async () => {
    const transport = stubTransport([{ status: 400, body: { detail: "bad page_size" } }]);
    const client = makeClient(transport);

    await expect(client.searchJobs({ page_size: 9999 })).rejects.toBeInstanceOf(JoboApiError);
    expect(transport.requests).toHaveLength(1);
  });

  it("classifies 429 with retry_after_seconds in the body", async () => {
    const transport = stubTransport([
      { status: 429, body: { error: "Rate limit exceeded", retry_after_seconds: 3 } },
      { status: 200, body: { jobs: [], total: 0, page: 1, page_size: 25, total_pages: 0, facets: {} } },
    ]);
    const delays: number[] = [];
    const client = makeClient(transport, {
      retry: { sleep: async (ms: number) => void delays.push(ms), random: () => 0.5 },
    });

    await client.searchJobs({ q: "rust" });
    expect(delays).toEqual([3000]);
  });

  it("surfaces the rate limit error type", async () => {
    const transport = stubTransport([
      { status: 429, headers: { "retry-after": "1" }, body: {} },
      { status: 429, headers: { "retry-after": "1" }, body: {} },
      { status: 429, headers: { "retry-after": "1" }, body: {} },
    ]);
    const client = makeClient(transport);
    await expect(client.searchJobs({ q: "x" })).rejects.toBeInstanceOf(RateLimitError);
  });
});

describe("usage headers", () => {
  it("parses credit and rate-limit headers and fires onUsage", async () => {
    const transport = stubTransport([
      {
        status: 200,
        headers: {
          "x-credits-deducted": "75",
          "x-credits-balance": "4200",
          "x-ratelimit-remaining": "59",
          "x-total-count": "812",
        },
        body: { jobs: [], total: 812, page: 1, page_size: 25, total_pages: 33, facets: {} },
      },
    ]);
    const seen: unknown[] = [];
    const client = makeClient(transport, { onUsage: (u: unknown) => seen.push(u) });

    const result = await client.searchJobs({ q: "rust" });

    expect(result.usage.creditsDeducted).toBe(75);
    expect(result.usage.creditsBalance).toBe(4200);
    expect(result.usage.totalCount).toBe(812);
    expect(client.creditBalance).toBe(4200);
    expect(seen).toHaveLength(1);
  });

  it("does not block allowance-covered or free requests from a stale wallet floor", async () => {
    const transport = stubTransport([
      {
        status: 200,
        headers: { "x-credits-balance": "100" },
        body: { jobs: [], total: 0, page: 1, page_size: 25, total_pages: 0, facets: {} },
      },
      {
        status: 200,
        headers: { "x-quota-remaining": "50" },
        body: { jobs: [], total: 0, page: 1, page_size: 25, total_pages: 0, facets: {} },
      },
    ]);
    const client = makeClient(transport, { creditFloor: 500 });

    await client.searchJobs({ q: "rust" });
    await client.searchJobs({ q: "rust" });
    expect(transport.requests).toHaveLength(2);
  });
});

describe("request shaping", () => {
  it("sends the key header and comma-joins array params", async () => {
    const transport = stubTransport([
      { status: 200, body: { jobs: [], total: 0, page: 1, page_size: 25, total_pages: 0, facets: {} } },
    ]);
    const client = makeClient(transport);

    await client.searchJobs({ q: "go", sources: ["greenhouse", "lever_co"], work_model: ["remote"] });

    const req = transport.requests[0]!;
    expect(req.headers["X-Api-Key"]).toBe(VALID_KEY);
    expect(req.url).toContain("sources=greenhouse%2Clever_co");
    expect(req.url).toContain("work_model=remote");
  });

  it("identifies the connector with X-Jobo-Client, independently of the User-Agent", async () => {
    const transport = stubTransport([
      { status: 200, body: { jobs: [], total: 0, page: 1, page_size: 25, total_pages: 0, facets: {} } },
    ]);
    // Hosts own their HTTP stack and may rewrite a User-Agent, so attribution
    // rides on a header nothing else claims.
    const client = makeClient(transport, { client: "n8n" });

    await client.searchJobs({ q: "go" });

    expect(transport.requests[0]!.headers["X-Jobo-Client"]).toBe("n8n");
  });

  it("omits X-Jobo-Client entirely when no connector name was given", async () => {
    const transport = stubTransport([
      { status: 200, body: { jobs: [], total: 0, page: 1, page_size: 25, total_pages: 0, facets: {} } },
    ]);
    const client = makeClient(transport);

    await client.searchJobs({ q: "go" });

    // An empty header would be indistinguishable from an unrecognised client.
    expect(transport.requests[0]!.headers).not.toHaveProperty("X-Jobo-Client");
  });

  it("omits null values but serialises empty arrays as `key=` (API tri-state)", async () => {
    const transport = stubTransport([
      { status: 200, body: { jobs: [], total: 0, page: 1, page_size: 25, total_pages: 0, facets: {} } },
    ]);
    const client = makeClient(transport);

    await client.searchJobs({ q: "go", sources: [], location: undefined });

    const url = transport.requests[0]!.url;
    // Empty list must reach the API: for include_facets/include_fields the
    // server distinguishes absent (default) from empty (none).
    expect(url).toContain("sources=");
    expect(url).not.toContain("location=");
  });

  it("sends include_facets as a facet-name list, never a boolean", async () => {
    const transport = stubTransport([
      { status: 200, body: { jobs: [], total: 0, page: 1, page_size: 25, total_pages: 0, facets: {} } },
      { status: 200, body: { jobs: [], total: 0, page: 1, page_size: 25, total_pages: 0, facets: {} } },
    ]);
    const client = makeClient(transport);

    await client.searchJobs({ q: "go", include_facets: ["skills", "industries"] });
    await client.searchJobs({ q: "go", include_facets: [] });

    expect(transport.requests[0]!.url).toContain("include_facets=skills%2Cindustries");
    expect(transport.requests[1]!.url).toContain("include_facets=");
    expect(transport.requests[1]!.url).not.toContain("include_facets=true");
  });
});

describe("connector metadata endpoints", () => {
  const emptyOk = { status: 200, body: {} } as const;

  it("filters() hits /api/connectors/filters", async () => {
    const transport = stubTransport([emptyOk]);
    const client = makeClient(transport);

    await client.filters();

    const req = transport.requests[0]!;
    expect(req.method).toBe("GET");
    expect(req.url).toBe("https://connect.jobo.world/api/connectors/filters");
  });

  it("filterOptions() path-encodes the facet and passes q/limit", async () => {
    const transport = stubTransport([emptyOk]);
    const client = makeClient(transport);

    await client.filterOptions("industries", { q: "fin tech", limit: 25 });

    expect(transport.requests[0]!.url).toBe(
      "https://connect.jobo.world/api/connectors/filter-options/industries?q=fin%20tech&limit=25",
    );
  });

  it("suggestLocations() encodes the query and default limit", async () => {
    const transport = stubTransport([emptyOk]);
    const client = makeClient(transport);

    await client.suggestLocations("berl");

    expect(transport.requests[0]!.url).toBe(
      "https://connect.jobo.world/api/connectors/locations/suggest?q=berl&limit=5",
    );
  });
});
