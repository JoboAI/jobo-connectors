import { describe, expect, it } from "vitest";
import { JoboClient } from "./client";
import {
  MIN_POLL_INTERVAL_SECONDS,
  POLL_INTERVAL_GRACE_SECONDS,
  poll,
  shouldSkipPoll,
  WindowOverflowError,
  type PollState,
} from "./poll";
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

/** The JSON body of the n-th request. */
function bodyOf(transport: { requests: TransportRequest[] }, index = 0): Record<string, unknown> {
  return JSON.parse(transport.requests[index]!.body ?? "{}") as Record<string, unknown>;
}

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

    // 60s lap applied to the stored watermark, oldest first, on the POST surface.
    expect(transport.requests[0]!.method).toBe("POST");
    expect(transport.requests[0]!.url).toBe("https://connect.jobo.world/api/jobs/search");
    expect(bodyOf(transport)).toMatchObject({
      queries: ["rust"],
      discovered_after: "2026-07-26T10:59:00.000Z",
      sort: "discovered_asc",
      include_facets: [],
      page: 1,
    });
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

  it("drains a window larger than one poll over several, oldest first", async () => {
    const transport = pagingTransport([
      { jobs: [job("a", "2026-07-26T11:10:00.000Z")], total: 5, total_pages: 5 },
      { jobs: [job("b", "2026-07-26T11:20:00.000Z")], total: 5, total_pages: 5 },
      // Next poll resumes at the watermark the first one reached, with no lap.
      { jobs: [job("b", "2026-07-26T11:20:00.000Z"), job("c", "2026-07-26T11:30:00.000Z")], total: 4, total_pages: 2 },
      { jobs: [job("d", "2026-07-26T11:40:00.000Z")], total: 4, total_pages: 2 },
    ]);
    const client = makeClient(transport);
    const opts = { now: () => FIXED_NOW, pageSize: 1, maxPages: 2 };

    const first = await poll(client, { q: "engineer" }, { watermark: "2026-07-26T11:00:00.000Z", seenIds: [] }, opts);

    expect(first.jobs.map((j) => j.id)).toEqual(["a", "b"]);
    expect(first.backlog).toBe(true);
    expect(first.remaining).toBe(3);
    expect(first.state).toEqual({ watermark: "2026-07-26T11:20:00.000Z", seenIds: ["a", "b"], backlog: true });

    const second = await poll(client, { q: "engineer" }, first.state, { ...opts, pageSize: 2 });

    expect(bodyOf(transport, 2)).toMatchObject({ discovered_after: "2026-07-26T11:20:00.000Z", page: 1 });
    expect(second.jobs.map((j) => j.id)).toEqual(["c", "d"]);
    expect(second.backlog).toBe(false);
    expect(second.state).toEqual({ watermark: "2026-07-26T11:40:00.000Z", seenIds: ["a", "b", "c", "d"] });
  });

  it("stops a poll at its page cap rather than paying for the whole window", async () => {
    const transport = pagingTransport(
      Array.from({ length: 10 }, (_, i) => ({
        jobs: [job(`j${i}`, `2026-07-26T11:${String(10 + i).padStart(2, "0")}:00.000Z`)],
        total: 5000,
        total_pages: 200,
      })),
    );
    const client = makeClient(transport);
    const state: PollState = { watermark: "2026-07-26T11:00:00.000Z", seenIds: [] };

    const result = await poll(client, { q: "engineer" }, state, { now: () => FIXED_NOW });

    expect(transport.requests).toHaveLength(10);
    expect(result.backlog).toBe(true);
    expect(result.state.watermark).toBe("2026-07-26T11:19:00.000Z");
  });

  it("throws only when a resumed walk cannot move past one second", async () => {
    const second = "2026-07-26T11:20:00.000Z";
    const transport = pagingTransport([
      { jobs: [job("a", second)], total: 900, total_pages: 900 },
      { jobs: [job("b", second)], total: 900, total_pages: 900 },
    ]);
    const client = makeClient(transport);
    const state: PollState = { watermark: second, seenIds: ["a", "b"], backlog: true };

    const error = await poll(client, { q: "engineer" }, state, { now: () => FIXED_NOW, pageSize: 1, maxPages: 2 }).catch(
      (e) => e,
    );

    expect(error).toBeInstanceOf(WindowOverflowError);
    expect((error as WindowOverflowError).total).toBe(900);
    expect((error as WindowOverflowError).capacity).toBe(2);
  });

  it("sends every filter, including companies and excludes, and never the caller's own window", async () => {
    const transport = pagingTransport([{ jobs: [], total: 0, total_pages: 0 }]);
    const client = makeClient(transport);
    const state: PollState = { watermark: "2026-07-26T11:00:00.000Z", seenIds: [] };

    await poll(
      client,
      {
        companies: ["0d5f8b4e-1111-4c2a-9a55-2f6d1f0e7a10"],
        exclude_skills: ["php"],
        discovered_before: "2026-01-01T00:00:00.000Z",
        sort: "relevance",
      },
      state,
      { now: () => FIXED_NOW, includeFields: ["summary"] },
    );

    const body = bodyOf(transport);
    expect(body.companies).toEqual({ include: ["0d5f8b4e-1111-4c2a-9a55-2f6d1f0e7a10"] });
    expect(body.skills).toEqual({ exclude: ["php"] });
    expect(body.discovered_before).toBeUndefined();
    expect(body.sort).toBe("discovered_asc");
    expect(body.include_fields).toEqual(["summary"]);
  });

  it("keeps a full interval's worth of capacity, so an hourly floor still drains", async () => {
    // 10 pages x 25. Sized against MIN_POLL_INTERVAL_SECONDS rather than a
    // one-minute tick: a 4-page cap would reject filters that work today.
    const pages = Array.from({ length: 10 }, (_, i) => ({
      jobs: [job(`j${i}`, `2026-07-26T11:${String(10 + i).padStart(2, "0")}:00.000Z`)],
      total: 10,
      total_pages: 10,
    }));
    const transport = pagingTransport(pages);
    const client = makeClient(transport);
    const state: PollState = { watermark: "2026-07-26T11:00:00.000Z", seenIds: [] };

    const result = await poll(client, { q: "rust" }, state, { now: () => FIXED_NOW });

    expect(result.pagesFetched).toBe(10);
    expect(result.jobs).toHaveLength(10);
  });

  it("requests page_size 25 by default", async () => {
    const transport = pagingTransport([{ jobs: [], total: 0, total_pages: 0 }]);
    const client = makeClient(transport);
    const state: PollState = { watermark: "2026-07-26T11:00:00.000Z", seenIds: [] };

    await poll(client, { q: "rust" }, state, { now: () => FIXED_NOW });

    expect(bodyOf(transport).page_size).toBe(25);
  });
});

describe("minimum poll interval", () => {
  const HOUR = 3600;

  it("allows the first poll, when nothing has been stamped yet", () => {
    expect(shouldSkipPoll(null, HOUR, FIXED_NOW)).toBe(false);
    expect(shouldSkipPoll(undefined, HOUR, FIXED_NOW)).toBe(false);
  });

  it("skips a tick that arrives before the interval has elapsed", () => {
    // n8n's injected default fires every 60s; all but one an hour are skipped.
    const oneMinuteAgo = new Date(FIXED_NOW.getTime() - 60_000).toISOString();
    expect(shouldSkipPoll(oneMinuteAgo, HOUR, FIXED_NOW)).toBe(true);
  });

  it("allows a tick once the interval has elapsed", () => {
    const anHourAgo = new Date(FIXED_NOW.getTime() - HOUR * 1000).toISOString();
    expect(shouldSkipPoll(anHourAgo, HOUR, FIXED_NOW)).toBe(false);
  });

  it("tolerates scheduler drift rather than deferring a whole extra interval", () => {
    // An hourly cron landing 2s early must not be pushed out to two hours.
    const justUnderAnHour = new Date(FIXED_NOW.getTime() - (HOUR - 2) * 1000).toISOString();
    expect(shouldSkipPoll(justUnderAnHour, HOUR, FIXED_NOW)).toBe(false);

    // The grace is bounded: comfortably early is still early.
    const wellShort = new Date(
      FIXED_NOW.getTime() - (HOUR - POLL_INTERVAL_GRACE_SECONDS - 30) * 1000,
    ).toISOString();
    expect(shouldSkipPoll(wellShort, HOUR, FIXED_NOW)).toBe(true);
  });

  it("clamps a caller asking for less than the hard floor", () => {
    const twoMinutesAgo = new Date(FIXED_NOW.getTime() - 120_000).toISOString();
    expect(shouldSkipPoll(twoMinutesAgo, 60, FIXED_NOW)).toBe(true);

    const pastTheFloor = new Date(FIXED_NOW.getTime() - MIN_POLL_INTERVAL_SECONDS * 1000).toISOString();
    expect(shouldSkipPoll(pastTheFloor, 60, FIXED_NOW)).toBe(false);
  });

  it("polls rather than locking shut on an unparseable or future stamp", () => {
    expect(shouldSkipPoll("not a date", HOUR, FIXED_NOW)).toBe(false);
    // Clock moved backwards: never wedge the trigger until it catches up.
    const future = new Date(FIXED_NOW.getTime() + HOUR * 1000).toISOString();
    expect(shouldSkipPoll(future, HOUR, FIXED_NOW)).toBe(false);
  });

  it("costs nothing when it skips: the host makes no request and keeps its watermark", async () => {
    const transport = pagingTransport([]);
    const state: PollState = { watermark: "2026-07-26T11:00:00.000Z", seenIds: ["a"] };
    const oneMinuteAgo = new Date(FIXED_NOW.getTime() - 60_000).toISOString();

    // The host's contract: consult the floor, and on a skip never reach poll().
    if (!shouldSkipPoll(oneMinuteAgo, HOUR, FIXED_NOW)) {
      await poll(makeClient(transport), { q: "rust" }, state, { now: () => FIXED_NOW });
    }

    expect(transport.requests).toHaveLength(0);
    expect(state).toEqual({ watermark: "2026-07-26T11:00:00.000Z", seenIds: ["a"] });
  });
});
