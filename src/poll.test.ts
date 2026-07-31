import { describe, expect, it } from "vitest";
import { JoboClient } from "./client";
import { poll, WindowOverflowError, type PollState } from "./poll";
import type { Job } from "./types";
import type { Transport, TransportRequest, TransportResponse } from "./transport";

const VALID_KEY = `jbe_live_${"a".repeat(21)}_${"b".repeat(43)}`;

function job(id: string, createdAt: string): Job {
  return {
    id,
    title: `Job ${id}`,
    normalized_title: null,
    company: null,
    description: null,
    summary: null,
    listing_url: null,
    apply_url: null,
    locations: [],
    compensation: null,
    employment_type: null,
    workplace_type: null,
    experience_level: null,
    source: "greenhouse",
    created_at: createdAt,
    updated_at: createdAt,
    date_posted: null,
    valid_through: null,
    qualifications: null,
    responsibilities: [],
    benefits: [],
    is_work_auth_required: null,
    is_h1b_sponsor: null,
    is_clearance_required: null,
  };
}

interface Page {
  jobs: Job[];
  total: number;
  total_pages: number;
}

function pagingTransport(pages: Page[]): Transport & { requests: TransportRequest[] } {
  const requests: TransportRequest[] = [];
  let index = 0;

  return {
    requests,
    async request(req: TransportRequest): Promise<TransportResponse> {
      requests.push(req);
      const page = pages[index++];
      if (!page) throw new Error("pagingTransport ran out of pages");
      return {
        status: 200,
        headers: {},
        body: JSON.stringify({
          jobs: page.jobs,
          total: page.total,
          page: index,
          page_size: 25,
          total_pages: page.total_pages,
          facets: {},
        }),
      };
    },
  };
}

function makeClient(transport: Transport) {
  return new JoboClient({
    apiKey: VALID_KEY,
    transport,
    retry: { sleep: async () => {}, random: () => 0.5 },
  });
}

const FIXED_NOW = new Date("2026-07-26T12:00:00.000Z");

describe("seeding", () => {
  it("emits nothing on the first run and records a watermark", async () => {
    const transport = pagingTransport([]);
    const client = makeClient(transport);

    const result = await poll(client, { q: "rust" }, { watermark: null, seenIds: [] }, { now: () => FIXED_NOW });

    expect(result.seeded).toBe(true);
    expect(result.jobs).toEqual([]);
    expect(result.state.watermark).toBe(FIXED_NOW.toISOString());
    // Crucially, seeding must not hit the API at all.
    expect(transport.requests).toHaveLength(0);
  });
});

describe("incremental polling", () => {
  it("queries discovered_after with a lap and advances the watermark to the newest job", async () => {
    const transport = pagingTransport([
      { jobs: [job("a", "2026-07-26T11:30:00.000Z"), job("b", "2026-07-26T11:45:00.000Z")], total: 2, total_pages: 1 },
    ]);
    const client = makeClient(transport);
    const state: PollState = { watermark: "2026-07-26T11:00:00.000Z", seenIds: [] };

    const result = await poll(client, { q: "rust" }, state, { now: () => FIXED_NOW });

    // 60s lap applied to the stored watermark.
    expect(transport.requests[0]!.url).toContain(encodeURIComponent("2026-07-26T10:59:00.000Z"));
    expect(result.jobs.map((j) => j.id)).toEqual(["a", "b"]);
    expect(result.state.watermark).toBe("2026-07-26T11:45:00.000Z");
    expect(result.state.seenIds).toEqual(["a", "b"]);
  });

  it("suppresses jobs already emitted, so the lap cannot double-fire a workflow", async () => {
    const transport = pagingTransport([
      { jobs: [job("a", "2026-07-26T11:30:00.000Z"), job("c", "2026-07-26T11:50:00.000Z")], total: 2, total_pages: 1 },
    ]);
    const client = makeClient(transport);
    const state: PollState = { watermark: "2026-07-26T11:45:00.000Z", seenIds: ["a"] };

    const result = await poll(client, { q: "rust" }, state, { now: () => FIXED_NOW });

    expect(result.jobs.map((j) => j.id)).toEqual(["c"]);
    expect(result.state.seenIds).toEqual(["a", "c"]);
  });

  it("holds the watermark when nothing new arrived", async () => {
    const transport = pagingTransport([{ jobs: [], total: 0, total_pages: 0 }]);
    const client = makeClient(transport);
    const state: PollState = { watermark: "2026-07-26T11:45:00.000Z", seenIds: [] };

    const result = await poll(client, { q: "rust" }, state, { now: () => FIXED_NOW });

    expect(result.jobs).toEqual([]);
    expect(result.state.watermark).toBe("2026-07-26T11:45:00.000Z");
  });

  it("walks multiple pages up to the cap", async () => {
    const transport = pagingTransport([
      { jobs: [job("a", "2026-07-26T11:10:00.000Z")], total: 3, total_pages: 3 },
      { jobs: [job("b", "2026-07-26T11:20:00.000Z")], total: 3, total_pages: 3 },
      { jobs: [job("c", "2026-07-26T11:30:00.000Z")], total: 3, total_pages: 3 },
    ]);
    const client = makeClient(transport);
    const state: PollState = { watermark: "2026-07-26T11:00:00.000Z", seenIds: [] };

    const result = await poll(client, { q: "rust" }, state, { now: () => FIXED_NOW, pageSize: 1, maxPages: 4 });

    expect(result.pagesFetched).toBe(3);
    expect(result.jobs.map((j) => j.id)).toEqual(["a", "b", "c"]);
    expect(result.state.watermark).toBe("2026-07-26T11:30:00.000Z");
  });

  it("bounds the dedupe set", async () => {
    const transport = pagingTransport([
      { jobs: [job("new", "2026-07-26T11:30:00.000Z")], total: 1, total_pages: 1 },
    ]);
    const client = makeClient(transport);
    const state: PollState = { watermark: "2026-07-26T11:00:00.000Z", seenIds: ["x", "y", "z"] };

    const result = await poll(client, { q: "rust" }, state, { now: () => FIXED_NOW, seenIdLimit: 2 });

    expect(result.state.seenIds).toEqual(["z", "new"]);
  });
});

describe("cost guards", () => {
  it("refuses to poll without a narrowing filter", async () => {
    const transport = pagingTransport([]);
    const client = makeClient(transport);
    const state: PollState = { watermark: "2026-07-26T11:00:00.000Z", seenIds: [] };

    await expect(poll(client, { work_model: ["remote"] }, state, { now: () => FIXED_NOW })).rejects.toThrow(
      /narrowing filter/i,
    );
    expect(transport.requests).toHaveLength(0);
  });

  it("throws on a window too large to drain, after a single page", async () => {
    const transport = pagingTransport([
      { jobs: [job("a", "2026-07-26T11:10:00.000Z")], total: 5000, total_pages: 200 },
    ]);
    const client = makeClient(transport);
    const state: PollState = { watermark: "2026-07-26T11:00:00.000Z", seenIds: [] };

    const error = await poll(client, { q: "engineer" }, state, { now: () => FIXED_NOW }).catch((e) => e);

    expect(error).toBeInstanceOf(WindowOverflowError);
    expect((error as WindowOverflowError).total).toBe(5000);
    expect((error as WindowOverflowError).capacity).toBe(100);
    // Stops after page 1 rather than paying for 200 pages.
    expect(transport.requests).toHaveLength(1);
  });

  it("requests page_size 25 by default", async () => {
    const transport = pagingTransport([{ jobs: [], total: 0, total_pages: 0 }]);
    const client = makeClient(transport);
    const state: PollState = { watermark: "2026-07-26T11:00:00.000Z", seenIds: [] };

    await poll(client, { q: "rust" }, state, { now: () => FIXED_NOW });

    expect(transport.requests[0]!.url).toContain("page_size=25");
  });
});
