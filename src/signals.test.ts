import { describe, expect, it } from "vitest";
import { JoboClient } from "./client";
import { JoboError, JoboInputError, JoboTransportError } from "./errors";
import {
  COMPANY_SIGNAL_FILTER_KEYS,
  HIRING_SIGNAL_FILTERS,
  NARROWING_SIGNAL_FILTER_KEYS,
  assertHasNarrowingSignalFilter,
  toSignalsQuery,
} from "./signals";
import type { Transport, TransportRequest } from "./transport";

const VALID_KEY = `jbe_live_${"a".repeat(21)}_${"b".repeat(43)}`;
const EMPTY_PAGE = { signals: [], has_more: false };

function recordingTransport(body: unknown = EMPTY_PAGE): Transport & { requests: TransportRequest[] } {
  const requests: TransportRequest[] = [];
  return {
    requests,
    async request(req) {
      requests.push(req);
      return { status: 200, headers: {}, body: JSON.stringify(body) };
    },
  };
}

function makeClient(transport: Transport) {
  return new JoboClient({ apiKey: VALID_KEY, transport, retry: { sleep: async () => {}, random: () => 0.5 } });
}

describe("toSignalsQuery", () => {
  it("joins lists with commas, the only form the API reads", () => {
    expect(
      toSignalsQuery({ types: ["hiring_surge", "new_country"], domains: [" stripe.com ", "stripe.com", ""], min_strength: 70 }),
    ).toEqual({ types: "hiring_surge,new_country", domains: "stripe.com", min_strength: 70 });
  });

  it("leaves out what a form leaves untouched", () => {
    // An empty list, an unticked checkbox and a number field at zero are the
    // unset state of a host's form, not filters.
    expect(
      toSignalsQuery({ types: [], exclude_agencies: false, reposted_only: false, min_strength: 0, founded_after: 0, detected_after: "  " }),
    ).toEqual({});
  });

  it("sends a ticked checkbox, dates and paging", () => {
    expect(
      toSignalsQuery(
        { exclude_agencies: true, detected_after: "2026-11-01", created_after: "2026-11-12T09:30:00Z" },
        { limit: 25, cursor: "abc" },
      ),
    ).toEqual({
      exclude_agencies: true,
      detected_after: "2026-11-01",
      created_after: "2026-11-12T09:30:00Z",
      limit: 25,
      cursor: "abc",
    });
  });

  it("refuses a value with a comma instead of sending it as two filters", () => {
    const attempt = () => toSignalsQuery({ industries: ["Technology, Information and Internet"] });

    expect(attempt).toThrow(/comma/);
    // An input error, so a host reports it against the field, not as a failed call.
    expect(attempt).toThrow(JoboInputError);
  });

  it("refuses a list longer than the API takes", () => {
    const domains = Array.from({ length: 101 }, (_, i) => `company${i}.com`);

    expect(() => toSignalsQuery({ domains })).toThrow(JoboInputError);
    expect(() => toSignalsQuery({ domains })).toThrow(/at most 100 values/);
    expect(() => toSignalsQuery({ domains: domains.slice(0, 100) })).not.toThrow();
  });

  it("keeps only the per-company filters when asked to", () => {
    const query = toSignalsQuery(
      { types: ["leadership_hire"], domains: ["stripe.com"], functions: ["Sales"], min_strength: 50 },
      { limit: 10 },
      COMPANY_SIGNAL_FILTER_KEYS,
    );

    expect(query).toEqual({ types: "leadership_hire", min_strength: 50, limit: 10 });
  });

  it("sends the stored order, and leaves the default order out", () => {
    expect(toSignalsQuery({ domains: ["stripe.com"] }, { sort: "created_asc", limit: 10 })).toEqual({
      domains: "stripe.com",
      sort: "created_asc",
      limit: 10,
    });
    // The request that asks for no order is the one it always was.
    expect(toSignalsQuery({ domains: ["stripe.com"] }, { sort: "detected_desc" })).toEqual({ domains: "stripe.com" });
    expect(toSignalsQuery({ domains: ["stripe.com"] }, { sort: "" })).toEqual({ domains: "stripe.com" });
    // The per-company endpoint takes it too.
    expect(toSignalsQuery({ types: ["new_city"] }, { sort: "created_asc" }, COMPANY_SIGNAL_FILTER_KEYS)).toEqual({
      types: "new_city",
      sort: "created_asc",
    });
  });

  it("refuses a sort the API does not have, before any request", () => {
    expect(() => toSignalsQuery({}, { sort: "newest" })).toThrow(JoboInputError);
    expect(() => toSignalsQuery({}, { sort: "newest" })).toThrow(/detected_desc, created_asc/);
  });
});

describe("the narrowing guard", () => {
  it("accepts any filter that says which companies or subjects are wanted", () => {
    for (const key of NARROWING_SIGNAL_FILTER_KEYS) {
      expect(() => assertHasNarrowingSignalFilter({ [key]: ["x"] })).not.toThrow();
    }
  });

  it("refuses bounds that leave every company in: strength, dates, exclusions", () => {
    expect(() =>
      assertHasNarrowingSignalFilter({ min_strength: 80, detected_after: "2026-11-01", exclude_agencies: true, types: [""] }),
    ).toThrow(/narrowing filter/);
  });

  it("counts a filter as narrowing only if it names companies or a subject", () => {
    const narrowing = HIRING_SIGNAL_FILTERS.filter((filter) => filter.narrowing).map((filter) => filter.kind);
    expect(new Set(narrowing)).toEqual(new Set(["enumList", "stringList"]));
  });
});

describe("the signals endpoints", () => {
  it("listSignals() reads GET /api/signals with the filters in the query", async () => {
    const transport = recordingTransport();

    await makeClient(transport).listSignals(
      { types: ["hiring_surge"], domains: ["stripe.com", "shopify.com"], exclude_agencies: true },
      { limit: 20 },
    );

    const url = new URL(transport.requests[0]!.url);
    expect(transport.requests[0]!.method).toBe("GET");
    expect(url.pathname).toBe("/api/signals");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      types: "hiring_surge",
      domains: "stripe.com,shopify.com",
      exclude_agencies: "true",
      limit: "20",
    });
  });

  it("listCompanySignals() puts the company in the path and drops the filters that endpoint lacks", async () => {
    const transport = recordingTransport();
    const id = "6c1f0a9e-3b7d-4c55-8e21-5a4d9f0b7c33";

    await makeClient(transport).listCompanySignals(
      id,
      { types: ["new_country"], domains: ["stripe.com"] } as never,
      { cursor: "next" },
    );

    const url = new URL(transport.requests[0]!.url);
    expect(url.pathname).toBe(`/api/companies/${id}/signals`);
    expect(Object.fromEntries(url.searchParams)).toEqual({ types: "new_country", cursor: "next" });
  });

  it("refuses an empty company id before any request", async () => {
    const transport = recordingTransport();

    await expect(makeClient(transport).listCompanySignals(" ")).rejects.toBeInstanceOf(JoboError);
    expect(transport.requests).toHaveLength(0);
  });

  it("does not replay a read whose answer was lost: each signal read is billed", async () => {
    let calls = 0;
    const timedOut: Transport = {
      async request() {
        calls++;
        throw new Error("timeout of 30000ms exceeded");
      },
    };

    await expect(makeClient(timedOut).listSignals({ types: ["hiring_surge"] })).rejects.toBeInstanceOf(JoboTransportError);
    expect(calls).toBe(1);
  });
});
