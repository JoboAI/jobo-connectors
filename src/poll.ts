import type { JoboClient } from "./client";
import { JoboError } from "./errors";
import { assertHasNarrowingFilter } from "./filters";
import { toJobSearchBody } from "./search";
import type { Job, JobSearchFilters, UsageInfo } from "./types";

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
  /**
   * True while the poller is working through a window larger than one poll
   * can return: the previous poll stopped at its page cap, part-way through
   * a `discovered_asc` walk, and the next one resumes at the watermark it
   * reached. Absent on state written before 0.4.0, which reads as false.
   */
  backlog?: boolean;
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
   * Hard cap on pages fetched per tick. Bounds the spend of any single run;
   * a window larger than `pageSize * maxPages` is drained over several ticks.
   *
   * Sized against the *minimum poll interval*, not against a one-minute tick:
   * `MIN_POLL_INTERVAL_SECONDS` means a window holds an interval's worth of
   * newly indexed jobs.
   */
  maxPages: number;
  /**
   * Seconds subtracted from the watermark when querying, to tolerate jobs whose
   * indexed timestamp lands slightly behind the previous run. Duplicates the lap
   * introduces are removed by the `seenIds` set. Not applied while resuming a
   * backlog: the watermark is then in the past, so nothing behind it is late.
   */
  lapSeconds: number;
  /** Upper bound on the dedupe set. */
  seenIdLimit: number;
  /**
   * `include_fields` for each request (omit for the full job). Lets a host
   * trim descriptions out of what it emits.
   */
  includeFields?: string[];
  now: () => Date;
}

export const defaultPollOptions: PollOptions = {
  pageSize: 25,
  maxPages: 10,
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
  /**
   * True when the window held more than this poll could return: the rest
   * arrives on the next polls, oldest first. `remaining` estimates how many.
   */
  backlog: boolean;
  remaining: number;
}

/**
 * Floor on how often a poller may actually call the API, in seconds.
 *
 * Host schedulers do not let us set this. n8n injects its own Poll Times
 * property into every `polling: true` node with a hard-coded `everyMinute`
 * default that the node cannot narrow or override, so a trigger nobody
 * configured still fires 1,440 times a day. Cost is unaffected — search is
 * metered per job returned and an empty poll settles at zero — but the request
 * volume is real, and each one costs the API a set of sliding-window counts.
 *
 * The floor is therefore enforced where we do have control: the poller checks
 * it and skips the tick, making no HTTP call at all.
 */
export const MIN_POLL_INTERVAL_SECONDS = 900;

/**
 * Tolerance subtracted when comparing against the floor.
 *
 * Without it the floor fights the scheduler it is meant to cooperate with: an
 * hourly cron tick landing at 59m58s would be judged early and deferred a full
 * extra hour, halving the user's configured rate rather than honouring it.
 */
export const POLL_INTERVAL_GRACE_SECONDS = 60;

/**
 * Whether this tick is too soon after the previous *attempted* poll.
 *
 * Pure, and separate from `poll()`, because the two have different persistence
 * rules. Poll state may only be committed on success — an advanced watermark
 * paired with a failed emit drops jobs permanently — whereas the last-polled
 * stamp must survive a failure, or a poller that is erroring drops straight
 * back to hammering the API once a minute. Hosts persist them separately and
 * call this before `poll()`.
 *
 * `lastPolledAt == null` (never polled, or an unparseable stored value) allows
 * the poll: a first run should not be deferred, and a corrupt stamp should not
 * wedge a trigger shut.
 */
export function shouldSkipPoll(
  lastPolledAt: string | null | undefined,
  minIntervalSeconds: number,
  now: Date,
): boolean {
  if (lastPolledAt == null) return false;

  const last = new Date(lastPolledAt).getTime();
  if (!Number.isFinite(last)) return false;

  // A stamp in the future means the clock moved backwards. Treat it as "poll
  // now" rather than locking the trigger out until the clock catches up.
  const elapsedSeconds = (now.getTime() - last) / 1000;
  if (elapsedSeconds < 0) return false;

  const floor = Math.max(minIntervalSeconds, MIN_POLL_INTERVAL_SECONDS);
  return elapsedSeconds < floor - POLL_INTERVAL_GRACE_SECONDS;
}

/**
 * The poll cannot make progress through its window.
 *
 * Polls walk the window oldest-first (`sort=discovered_asc`, which keys on
 * the immutable first-indexed time), so a window larger than one poll's
 * capacity is normally drained over several polls: each resumes at the
 * watermark the previous one reached. The one thing that cannot be resumed is
 * more matching jobs sharing a single first-indexed second than a poll can
 * return — the next poll would start at the same second and read the same
 * page. That stops loudly rather than skipping jobs.
 */
export class WindowOverflowError extends JoboError {
  readonly total: number;
  readonly capacity: number;

  constructor(total: number, capacity: number) {
    super(
      `This filter matched more than ${capacity} jobs indexed in the same second, more than a single poll can return, so the trigger cannot move past them without skipping some. ` +
        `Narrow the filter, or switch to a Jobo Outbound Feed for high-volume delivery ` +
        `(included plan jobs first, then the pay-as-you-go rate; no per-job charge on Unlimited). ` +
        `${total} jobs matched the window in all.`,
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
 *
 * Uses `POST /api/jobs/search` with `sort=discovered_asc`, so every filter in
 * `JOB_SEARCH_FILTERS` (companies, excludes, occupations…) applies, and a page
 * walk is oldest-first: stopping at the page cap leaves a clean resume point
 * instead of an arbitrary relevance-ranked subset.
 */
export async function poll(
  client: JoboClient,
  filters: JobSearchFilters,
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
      backlog: false,
      remaining: 0,
    };
  }

  assertHasNarrowingFilter(filters as Record<string, unknown>);

  const resuming = state.backlog === true;
  const since = resuming ? state.watermark : subtractSeconds(state.watermark, opts.lapSeconds);
  const capacity = opts.pageSize * opts.maxPages;
  const usage: UsageInfo[] = [];
  const fetched: Job[] = [];

  let pagesFetched = 0;
  let drained = false;
  let total = 0;

  for (let page = 1; page <= opts.maxPages; page++) {
    const result = await client.searchJobsAdvanced(
      toJobSearchBody(
        // The watermark owns discovered_after and the order; a caller's own
        // values for either would fight the incremental walk.
        { ...filters, discovered_after: since, discovered_before: undefined, sort: "discovered_asc" },
        {
          page,
          page_size: opts.pageSize,
          include_facets: [],
          ...(opts.includeFields ? { include_fields: opts.includeFields } : {}),
        },
      ),
    );

    usage.push(result.usage);
    pagesFetched++;
    fetched.push(...result.data.jobs);
    total = result.data.total;

    if (page >= result.data.total_pages || result.data.jobs.length === 0) {
      drained = true;
      break;
    }
  }

  const seen = new Set(state.seenIds);
  const fresh = fetched.filter((job) => !seen.has(job.id));

  // Advance only to the newest record actually observed. Oldest-first order
  // means everything before it in the window has been read, drained or not.
  let watermark = state.watermark;
  for (const job of fetched) {
    if (job.created_at > watermark) watermark = job.created_at;
  }

  // A capped walk that ends on the watermark it started from cannot progress:
  // the next poll would ask for the same page. Resuming already starts at the
  // watermark, so only a same-second pile-up larger than a poll gets here.
  if (!drained && resuming && watermark === state.watermark && fresh.length === 0) {
    throw new WindowOverflowError(total, capacity);
  }

  const seenIds = [...state.seenIds, ...fresh.map((job) => job.id)].slice(-opts.seenIdLimit);
  const backlog = !drained;

  return {
    jobs: fresh,
    state: backlog ? { watermark, seenIds, backlog: true } : { watermark, seenIds },
    usage,
    pagesFetched,
    seeded: false,
    backlog,
    remaining: backlog ? Math.max(0, total - fetched.length) : 0,
  };
}
