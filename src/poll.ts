import type { JoboClient } from "./client";
import { JoboError } from "./errors";
import { assertHasNarrowingFilter } from "./filters";
import type { Job, JobSearchParams, UsageInfo } from "./types";

/**
 * Serialisable poller state. Hosts persist this between runs — n8n workflow
 * static data, a Zapier dedupe store, a WordPress option row.
 *
 * `watermark === null` means "never polled". The first run seeds it to the
 * current time and deliberately emits nothing: Zapier and n8n both treat a
 * trigger's first run as a sample, and backfilling the entire index into
 * someone's workflow on day one is both surprising and expensive.
 */
export interface PollState {
  watermark: string | null;
  /** Recently emitted job ids, oldest first. Bounded by `seenIdLimit`. */
  seenIds: string[];
}

export interface PollOptions {
  /**
   * Rows per request. 25 is deliberate: the worst-case precheck prices the
   * *requested* page_size against shared allowance first, then wallet cover at
   * the account's tier/direct job rate. A larger page can therefore require
   * more wallet cover even though actual settlement uses returned jobs.
   */
  pageSize: number;
  /**
   * Hard cap on pages fetched per tick. Bounds the spend of any single run.
   */
  maxPages: number;
  /**
   * Seconds subtracted from the watermark when querying, to tolerate jobs whose
   * indexed timestamp lands slightly behind the previous run. Duplicates the lap
   * introduces are removed by the `seenIds` set.
   */
  lapSeconds: number;
  /** Upper bound on the dedupe set. */
  seenIdLimit: number;
  now: () => Date;
}

export const defaultPollOptions: PollOptions = {
  pageSize: 25,
  maxPages: 4,
  lapSeconds: 60,
  seenIdLimit: 2000,
  now: () => new Date(),
};

export interface PollResult {
  /** Jobs never emitted before, ready to hand to the host platform. */
  jobs: Job[];
  /** Persist this verbatim; pass it back on the next call. */
  state: PollState;
  /** One entry per HTTP request made, for run-log surfacing. */
  usage: UsageInfo[];
  pagesFetched: number;
  /** True on the seeding run, when no jobs are emitted by design. */
  seeded: boolean;
}

/**
 * The filter matches more jobs per interval than a polling trigger can safely
 * drain.
 *
 * This is terminal rather than best-effort because neither alternative is
 * acceptable: `GET /api/jobs` is relevance-ordered with no sort parameter, so a
 * partial fetch is an arbitrary subset — advancing the watermark past it drops
 * jobs silently, and holding the watermark re-bills the same window on every
 * tick forever. Failing loudly and telling the user to narrow the filter is the
 * only honest option.
 */
export class WindowOverflowError extends JoboError {
  readonly total: number;
  readonly capacity: number;

  constructor(total: number, capacity: number) {
    super(
      `This filter matched ${total} new jobs since the last check, more than the ${capacity} a single poll can safely return. ` +
        `Narrow the filter, poll more frequently, or switch to a Jobo Outbound Feed for high-volume delivery ` +
        `(included plan jobs first, then the pay-as-you-go rate; no per-job charge on Unlimited).`,
    );
    this.total = total;
    this.capacity = capacity;
  }
}

function subtractSeconds(iso: string, seconds: number): string {
  return new Date(new Date(iso).getTime() - seconds * 1000).toISOString();
}

/**
 * Run one incremental poll.
 *
 * Returned jobs use the plan's included jobs first, then the pay-as-you-go
 * rate; without a plan they are pay as you go. The Unlimited plan does not cover
 * Search. The resulting cost is independent of how often this is
 * called — an empty poll settles at zero jobs. What drives the bill is filter
 * breadth, and what causes a runaway bill is a watermark that fails to advance,
 * which is why the watermark is persisted here rather than recomputed from a
 * relative window on each run.
 */
export async function poll(
  client: JoboClient,
  filters: JobSearchParams,
  state: PollState,
  options: Partial<PollOptions> = {},
): Promise<PollResult> {
  const opts: PollOptions = { ...defaultPollOptions, ...options };

  if (state.watermark == null) {
    return {
      jobs: [],
      state: { watermark: opts.now().toISOString(), seenIds: [] },
      usage: [],
      pagesFetched: 0,
      seeded: true,
    };
  }

  assertHasNarrowingFilter(filters as Record<string, unknown>);

  const since = subtractSeconds(state.watermark, opts.lapSeconds);
  const capacity = opts.pageSize * opts.maxPages;
  const usage: UsageInfo[] = [];
  const fetched: Job[] = [];

  let pagesFetched = 0;

  for (let page = 1; page <= opts.maxPages; page++) {
    const result = await client.searchJobs({
      ...filters,
      discovered_after: since,
      page,
      page_size: opts.pageSize,
    });

    usage.push(result.usage);
    pagesFetched++;
    fetched.push(...result.data.jobs);

    // Bail before spending further pages on a window we cannot drain.
    if (page === 1 && result.data.total > capacity) {
      throw new WindowOverflowError(result.data.total, capacity);
    }

    if (page >= result.data.total_pages || result.data.jobs.length === 0) break;
  }

  const seen = new Set(state.seenIds);
  const fresh = fetched.filter((job) => !seen.has(job.id));

  // Advance only to the newest record actually observed. Safe here because the
  // overflow guard above guarantees the window was drained in full.
  let watermark = state.watermark;
  for (const job of fetched) {
    if (job.created_at > watermark) watermark = job.created_at;
  }

  const seenIds = [...state.seenIds, ...fresh.map((job) => job.id)].slice(-opts.seenIdLimit);

  return {
    jobs: fresh,
    state: { watermark, seenIds },
    usage,
    pagesFetched,
    seeded: false,
  };
}
