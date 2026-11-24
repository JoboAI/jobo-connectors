import { describe, expect, it } from "vitest";
import { JoboClient } from "./client";
import { JoboApiError } from "./errors";
import { pollSignals, type SignalPollState } from "./signals-poll";
import type { Transport, TransportRequest, TransportResponse } from "./transport";
import type { HiringSignal } from "./types";

const VALID_KEY = `jbe_live_${"a".repeat(21)}_${"b".repeat(43)}`;
const FILTERS = { domains: ["stripe.com"] };
const NOW = new Date("2026-11-24T14:00:00.000Z");

function signal(id: string, createdAt: string): HiringSignal {
  return {
    id,
    type: "hiring_surge",
    detected_on: createdAt.slice(0, 10),
    created_at: createdAt,
    window_start: "2026-11-17",
    window_end: "2026-11-23",
    strength: 80,
    company: {
      id: "c1",
      name: "Stripe",
      domain: "stripe.com",
      country_code: "US",
      size: "5001-10000",
      industry: "Financial Services",
      industries: [],
      categories: [],
      is_agency: false,
    },
    details: {},
    focus: { functions: [], topics: [], job_countries: [], job_regions: [], job_cities: [] },
    evidence_job_ids: [],
  };
}

interface Page {
  signals: HiringSignal[];
  next?: string;
  /** Answer with this status instead of a page. */
  status?: number;
  body?: unknown;
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
      if (page.status) return { status: page.status, headers: {}, body: JSON.stringify(page.body ?? {}) };
      return {
        status: 200,
        headers: {},
        body: JSON.stringify({
          signals: page.signals,
          has_more: page.next !== undefined,
          ...(page.next !== undefined ? { next_cursor: page.next } : {}),
        }),
      };
    },
  };
}

function makeClient(transport: Transport) {
  return new JoboClient({ apiKey: VALID_KEY, transport, retry: { sleep: async () => {}, random: () => 0.5 } });
}

function queryOf(transport: { requests: TransportRequest[] }, index = 0): Record<string, string> {
  return Object.fromEntries(new URL(transport.requests[index]!.url).searchParams);
}

/** `count` signals a microsecond apart, as one write batch stamps them. */
function batch(prefix: string, count: number, second: string, firstMicrosecond = 0): HiringSignal[] {
  return Array.from({ length: count }, (_, i) =>
    signal(`${prefix}${i}`, `${second}.${String(firstMicrosecond + i).padStart(6, "0")}Z`),
  );
}

describe("seeding", () => {
  it("reads nothing on the first run and records where to start", async () => {
    const transport = pagingTransport([]);

    const result = await pollSignals(makeClient(transport), FILTERS, { watermark: null }, { now: () => NOW });

    expect(result.seeded).toBe(true);
    expect(result.signals).toEqual([]);
    expect(result.state).toEqual({ watermark: NOW.toISOString() });
    // Every signal already stored would be billed.
    expect(transport.requests).toHaveLength(0);
  });

  it("refuses to start without a narrowing filter", async () => {
    const transport = pagingTransport([]);

    await expect(
      pollSignals(makeClient(transport), { min_strength: 80 }, { watermark: null }, { now: () => NOW }),
    ).rejects.toThrow(/narrowing filter/);
    expect(transport.requests).toHaveLength(0);
  });
});

describe("reading what is new", () => {
  it("asks for the stored order, after the last signal delivered, with no overlap", async () => {
    const transport = pagingTransport([
      { signals: [signal("a", "2026-11-24T13:53:55.837281Z"), signal("b", "2026-11-24T13:58:02.004917Z")] },
    ]);
    const state: SignalPollState = { watermark: "2026-11-24T13:50:00.120034Z" };

    const result = await pollSignals(makeClient(transport), FILTERS, state, { now: () => NOW });

    expect(queryOf(transport)).toEqual({
      domains: "stripe.com",
      sort: "created_asc",
      // The string the API sent, not five minutes before it.
      created_after: "2026-11-24T13:50:00.120034Z",
      limit: "50",
    });
    expect(result.signals.map((s) => s.id)).toEqual(["a", "b"]);
    expect(result.state).toEqual({ watermark: "2026-11-24T13:58:02.004917Z" });
    expect(result.backlog).toBe(false);
  });

  it("keeps the last created_at as the string it came as, microseconds and all", async () => {
    // A JavaScript Date keeps milliseconds. Through one, .837281 becomes .837:
    // earlier than the signal, which would be returned and billed again.
    for (const createdAt of ["2026-11-24T13:53:55.837281Z", "2026-11-24T13:53:55.83728Z", "2026-11-24T13:53:55Z"]) {
      const transport = pagingTransport([{ signals: [signal("a", createdAt)] }, { signals: [] }]);
      const client = makeClient(transport);

      const first = await pollSignals(client, FILTERS, { watermark: "2026-11-24T13:00:00Z" }, { now: () => NOW });
      expect(first.state.watermark).toBe(createdAt);

      await pollSignals(client, FILTERS, first.state, { now: () => NOW });
      expect(queryOf(transport, 1).created_after).toBe(createdAt);
    }
  });

  it("owns created_after and the order: a caller's own value would fight the watermark", async () => {
    const transport = pagingTransport([{ signals: [] }]);
    const state: SignalPollState = { watermark: "2026-11-24T13:00:00.000001Z" };

    await pollSignals(makeClient(transport), { ...FILTERS, created_after: "2020-01-01T00:00:00Z" }, state, { now: () => NOW });

    expect(queryOf(transport).created_after).toBe("2026-11-24T13:00:00.000001Z");
    expect(queryOf(transport).sort).toBe("created_asc");
  });

  it("changes nothing when nothing is new, and a second quiet poll asks the same", async () => {
    const transport = pagingTransport([{ signals: [] }, { signals: [] }]);
    const client = makeClient(transport);
    const state: SignalPollState = { watermark: "2026-11-24T13:53:55.837281Z" };

    const first = await pollSignals(client, FILTERS, state, { now: () => NOW });
    const second = await pollSignals(client, FILTERS, first.state, { now: () => NOW });

    expect(first.signals).toEqual([]);
    expect(first.state).toEqual(state);
    expect(second.state).toEqual(state);
    expect(queryOf(transport, 1)).toEqual(queryOf(transport, 0));
  });

  it("ignores what a 0.7.0 state carried: seen ids, the settled flag, a cursor of the other order", async () => {
    const transport = pagingTransport([{ signals: [signal("b", "2026-11-24T13:58:02.004917Z")] }]);
    const old = {
      watermark: "2026-11-24T13:50:00.0000000Z",
      seenIds: ["a"],
      settled: true,
      walk: { cursor: "MjAyNjExMjQ", since: "2026-11-24T13:45:00.000Z", startedAt: null, newest: null },
    } as unknown as SignalPollState;

    const result = await pollSignals(makeClient(transport), FILTERS, old, { now: () => NOW });

    expect(queryOf(transport)).toMatchObject({ created_after: "2026-11-24T13:50:00.0000000Z", sort: "created_asc" });
    expect(queryOf(transport).cursor).toBeUndefined();
    expect(result.state).toEqual({ watermark: "2026-11-24T13:58:02.004917Z" });
  });
});

describe("more signals than one poll may read", () => {
  it("stops at maxSignals inside a batch and keeps the API's position", async () => {
    // 150 signals of one batch, a microsecond apart: all in one millisecond.
    const stored = batch("s", 150, "2026-11-24T13:53:55", 837000);
    const transport = pagingTransport([
      { signals: stored.slice(0, 50), next: "c50" },
      { signals: stored.slice(50, 100), next: "c100" },
    ]);
    const state: SignalPollState = { watermark: "2026-11-24T13:00:00Z" };

    const result = await pollSignals(makeClient(transport), FILTERS, state, { now: () => NOW, maxSignals: 100 });

    expect(transport.requests).toHaveLength(2);
    expect(queryOf(transport, 1)).toMatchObject({ cursor: "c50", created_after: "2026-11-24T13:00:00Z", sort: "created_asc" });
    expect(result.signals.map((s) => s.id)).toEqual(stored.slice(0, 100).map((s) => s.id));
    expect(result.backlog).toBe(true);
    expect(result.state).toEqual({
      // The last signal delivered, to the microsecond: signal 99 of the batch.
      watermark: "2026-11-24T13:53:55.837099Z",
      cursor: { value: "c100", since: "2026-11-24T13:00:00Z" },
    });
  });

  it("never asks for more than is left of maxSignals", async () => {
    const stored = batch("s", 120, "2026-11-24T13:53:55");
    const transport = pagingTransport([
      { signals: stored.slice(0, 50), next: "c50" },
      { signals: stored.slice(50, 70), next: "c70" },
    ]);

    await pollSignals(makeClient(transport), FILTERS, { watermark: "2026-11-24T13:00:00Z" }, { now: () => NOW, maxSignals: 70 });

    expect(queryOf(transport, 0).limit).toBe("50");
    expect(queryOf(transport, 1).limit).toBe("20");
  });

  it("carries on from the held position with the same created_after, then lets it go", async () => {
    const rest = batch("s", 50, "2026-11-24T13:53:55", 837100);
    const transport = pagingTransport([{ signals: rest }]);
    const state: SignalPollState = {
      watermark: "2026-11-24T13:53:55.837099Z",
      cursor: { value: "c100", since: "2026-11-24T13:00:00Z" },
    };

    const result = await pollSignals(makeClient(transport), FILTERS, state, { now: () => NOW });

    // `since`, not the watermark: created_after is a filter and the cursor is
    // the position. Moved up, it would drop old signals that share the
    // watermark's created_at and come after it by id.
    expect(queryOf(transport)).toMatchObject({ cursor: "c100", created_after: "2026-11-24T13:00:00Z" });
    expect(result.signals).toHaveLength(50);
    expect(result.backlog).toBe(false);
    expect(result.state).toEqual({ watermark: "2026-11-24T13:53:55.837149Z" });
  });

  it("lets a held position go when nothing is left after it", async () => {
    const transport = pagingTransport([{ signals: [] }]);
    const state: SignalPollState = {
      watermark: "2026-11-24T13:53:55.837099Z",
      cursor: { value: "c100", since: "2026-11-24T13:00:00Z" },
    };

    const result = await pollSignals(makeClient(transport), FILTERS, state, { now: () => NOW });

    expect(queryOf(transport).cursor).toBe("c100");
    // The watermark is the last signal delivered, so it says the same thing.
    expect(result.state).toEqual({ watermark: "2026-11-24T13:53:55.837099Z" });
  });

  it("reads from the last signal delivered when the API refuses a held position", async () => {
    const transport = pagingTransport([
      {
        signals: [],
        status: 400,
        body: { title: "One or more validation errors occurred.", errors: { cursor: ["cursor is not valid."] } },
      },
      { signals: [signal("next", "2026-11-24T13:59:00.000001Z")] },
    ]);
    const state: SignalPollState = {
      watermark: "2026-11-24T13:53:55.837099Z",
      cursor: { value: "refused", since: "2026-11-24T13:00:00Z" },
    };

    const result = await pollSignals(makeClient(transport), FILTERS, state, { now: () => NOW });

    expect(transport.requests).toHaveLength(2);
    expect(queryOf(transport, 1).cursor).toBeUndefined();
    // Not `since`: that would read, and bill, everything delivered since.
    expect(queryOf(transport, 1).created_after).toBe("2026-11-24T13:53:55.837099Z");
    expect(result.signals.map((s) => s.id)).toEqual(["next"]);
    expect(result.state).toEqual({ watermark: "2026-11-24T13:59:00.000001Z" });
    expect(result.requests).toBe(2);
  });

  it("does not swallow a refused position twice, or any other 400", async () => {
    const refusal = { signals: [], status: 400, body: { errors: { cursor: ["cursor is not valid."] } } };
    const twice = pagingTransport([refusal, refusal]);
    const held: SignalPollState = {
      watermark: "2026-11-24T13:53:55.837099Z",
      cursor: { value: "refused", since: "2026-11-24T13:00:00Z" },
    };
    await expect(pollSignals(makeClient(twice), FILTERS, held, { now: () => NOW })).rejects.toBeInstanceOf(JoboApiError);
    expect(twice.requests).toHaveLength(2);

    const other = pagingTransport([{ signals: [], status: 400, body: { errors: { types: ["Unknown signal type 'surge'."] } } }]);
    await expect(
      pollSignals(makeClient(other), FILTERS, { watermark: "2026-11-24T13:00:00Z" }, { now: () => NOW }),
    ).rejects.toBeInstanceOf(JoboApiError);
  });

  it("says so when the API does not know the stored order", async () => {
    const transport = pagingTransport([
      { signals: [], status: 400, body: { errors: { sort: ["sort must be one of: detected_desc, created_asc."] } } },
    ]);

    await expect(
      pollSignals(makeClient(transport), FILTERS, { watermark: "2026-11-24T13:00:00Z" }, { now: () => NOW }),
    ).rejects.toBeInstanceOf(JoboApiError);
  });
});

describe("a poll that fails", () => {
  it("throws, so the host saves nothing and the next poll reads the same signals", async () => {
    const transport = pagingTransport([
      { signals: batch("s", 50, "2026-11-24T13:53:55"), next: "c50" },
      { signals: [], status: 402, body: { title: "Insufficient credits" } },
    ]);
    const state: SignalPollState = { watermark: "2026-11-24T13:00:00Z" };

    await expect(pollSignals(makeClient(transport), FILTERS, state, { now: () => NOW, maxSignals: 100 })).rejects.toBeInstanceOf(
      JoboApiError,
    );
    // The caller's state object is never touched.
    expect(state).toEqual({ watermark: "2026-11-24T13:00:00Z" });
  });

  it("refuses to record a position from a signal that has no created_at", async () => {
    const broken = { ...signal("a", "x"), created_at: undefined } as unknown as HiringSignal;
    const transport = pagingTransport([{ signals: [broken] }]);

    await expect(
      pollSignals(makeClient(transport), FILTERS, { watermark: "2026-11-24T13:00:00Z" }, { now: () => NOW }),
    ).rejects.toThrow(/without created_at/);
  });

  it("reads at least one signal even when asked for none", async () => {
    const transport = pagingTransport([{ signals: [signal("a", "2026-11-24T13:53:55.837281Z")], next: "c1" }]);

    const result = await pollSignals(makeClient(transport), FILTERS, { watermark: "2026-11-24T13:00:00Z" }, { now: () => NOW, maxSignals: 0 });

    expect(queryOf(transport).limit).toBe("1");
    expect(result.signals).toHaveLength(1);
    expect(result.backlog).toBe(true);
  });
});
