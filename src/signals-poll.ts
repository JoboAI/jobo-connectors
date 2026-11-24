import type { JoboClient } from "./client";
import { JoboApiError } from "./errors";
import { SIGNAL_MAX_LIMIT, SIGNAL_POLL_SORT, assertHasNarrowingSignalFilter } from "./signals";
import type { HiringSignal, HiringSignalFilters, UsageInfo } from "./types";

/**
 * Serialisable state of a signals poller. Hosts persist it between runs, and
 * only when the signals a poll returned are being handed on.
 *
 * `watermark === null` means "never polled". The first run seeds it to the
 * current time and reads nothing, like the jobs poller: a trigger's first run
 * is a sample, and reading every signal already stored would be billed.
 *
 * A state saved by connector-core 0.7.0 also had `seenIds`, `settled` and
 * `walk`. They are ignored: nothing is read twice any more, so there is
 * nothing to de-duplicate, and a 0.7.0 cursor belongs to the other order.
 */
export interface SignalPollState {
  /**
   * The `created_at` of the last signal delivered, exactly as the API sent
   * it; before the first signal, the moment the poller was seeded. Everything
   * stored up to here has been delivered.
   *
   * Never parse it into a date: `created_at` has microseconds, and the
   * signals of one batch are a microsecond apart. Rounded down, the last
   * signal would be after the bound again and billed again on every poll;
   * rounded up, later signals of the same millisecond would be skipped.
   */
  watermark: string | null;
  /**
   * Present while more signals are waiting than one poll was allowed to read:
   * the API's position after the last signal delivered, and the
   * `created_after` it was issued with.
   *
   * The next poll continues from it. `created_after` is a filter and the
   * cursor is the position, so `since` stays as it was: moving it up to the
   * watermark would drop the rest of a batch of old signals that share one
   * `created_at`.
   */
  cursor?: { value: string; since: string };
}

export interface SignalPollOptions {
  /** Signals per request, 1 to 200. */
  pageSize: number;
  /**
   * The most signals one poll reads, and so the most it is billed for. When
   * more are waiting, the next polls carry on where this one stopped.
   */
  maxSignals: number;
  now: () => Date;
}

export const defaultSignalPollOptions: SignalPollOptions = {
  pageSize: 50,
  maxSignals: 100,
  now: () => new Date(),
};

export interface SignalPollResult {
  /** The signals stored since the previous poll, oldest first. None was delivered before. */
  signals: HiringSignal[];
  /** Persist this verbatim when the signals are handed on; pass it back next time. */
  state: SignalPollState;
  /** One entry per HTTP request made, for run-log surfacing. */
  usage: UsageInfo[];
  requests: number;
  /** True on the seeding run, when nothing is read by design. */
  seeded: boolean;
  /** True when the poll stopped at `maxSignals` with more to read on the next one. */
  backlog: boolean;
}

/** A 400 that names the cursor: the API does not continue it. */
function isRejectedCursor(error: unknown): boolean {
  if (!(error instanceof JoboApiError) || error.status !== 400) return false;
  const body = error.body;
  if (!body || typeof body !== "object") return false;
  const errors = (body as { errors?: unknown }).errors;
  return errors != null && typeof errors === "object" && "cursor" in errors;
}

/**
 * Read the hiring signals stored since the previous poll, each exactly once.
 *
 * Signals are billed per signal returned, and one read again is billed again.
 * The poll reads in the order signals were stored (`sort=created_asc`) and
 * asks for `created_after` the last signal it delivered, so the API returns
 * the next signals stored and nothing else: no overlap to pay for, no list of
 * ids to remember, and no reason to stay behind the newest signal, because a
 * signal that becomes readable later never has an earlier `created_at`. A
 * poll with nothing new returns nothing, and that request is free.
 *
 * `maxSignals` bounds one poll. When more are waiting, the state keeps the
 * API's `next_cursor` and the next poll continues from it.
 *
 * Needs an API that knows `sort=created_asc`. One that does not answers
 * `400` naming `sort`, which is thrown as it is.
 */
export async function pollSignals(
  client: JoboClient,
  filters: HiringSignalFilters,
  state: SignalPollState,
  options: Partial<SignalPollOptions> = {},
): Promise<SignalPollResult> {
  const opts: SignalPollOptions = { ...defaultSignalPollOptions, ...options };

  assertHasNarrowingSignalFilter(filters as Record<string, unknown>);

  if (state.watermark == null) {
    return {
      signals: [],
      state: { watermark: opts.now().toISOString() },
      usage: [],
      requests: 0,
      seeded: true,
      backlog: false,
    };
  }

  const watermark = state.watermark;
  const pageSize = Math.min(Math.max(1, Math.trunc(opts.pageSize) || 1), SIGNAL_MAX_LIMIT);
  // At least one: a poll that may read nothing could never move on.
  const maxSignals = Math.max(1, Math.trunc(opts.maxSignals) || 1);

  const usage: UsageInfo[] = [];
  const read: HiringSignal[] = [];
  let since = state.cursor ? state.cursor.since : watermark;
  let cursor = state.cursor?.value;
  let requests = 0;

  while (read.length < maxSignals) {
    const limit = Math.min(pageSize, maxSignals - read.length);

    let result;
    try {
      // The poller owns created_after and the order; a caller's own value would fight it.
      result = await client.listSignals(
        { ...filters, created_after: since },
        { limit, sort: SIGNAL_POLL_SORT, ...(cursor ? { cursor } : {}) },
      );
    } catch (error) {
      requests++;
      // The cursor held over from an earlier poll is not continued. Read from
      // the last signal delivered instead: every signal stored since
      // `sort=created_asc` was released has a `created_at` of its own, so
      // that is the same position. A refused request is not billed.
      if (state.cursor && cursor === state.cursor.value && read.length === 0 && isRejectedCursor(error)) {
        cursor = undefined;
        since = watermark;
        continue;
      }
      throw error;
    }

    requests++;
    usage.push(result.usage);

    read.push(...(result.data.signals ?? []));

    const next = result.data.has_more ? result.data.next_cursor : null;
    if (!next) {
      cursor = undefined;
      break;
    }
    cursor = next;
  }

  // Nothing read means the read reached its end with nothing after the last
  // signal delivered. The watermark is already that signal's `created_at`,
  // so a held cursor has nothing left to say and is let go.
  if (read.length === 0) {
    return { signals: [], state: { watermark }, usage, requests, seeded: false, backlog: false };
  }

  const reached = (read[read.length - 1] as HiringSignal).created_at;
  if (typeof reached !== "string" || reached.trim() === "") {
    // Saving a state without it would seed the poller again and skip what
    // came after. Failing leaves the state alone; the next poll reads these
    // signals again.
    throw new Error("The API returned a hiring signal without created_at, so the poll cannot record where it stopped.");
  }

  return {
    signals: read,
    state: cursor ? { watermark: reached, cursor: { value: cursor, since } } : { watermark: reached },
    usage,
    requests,
    seeded: false,
    backlog: cursor !== undefined,
  };
}
