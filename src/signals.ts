/**
 * Hiring Signals: the filter surface of `GET /api/signals`, described once.
 *
 * A signal is one event at one company, detected from its job postings: a
 * hiring surge, a first job in a country, a leadership search. Each platform
 * renders its own fields from `HIRING_SIGNAL_FILTERS`, as it does for jobs
 * from `JOB_SEARCH_FILTERS`, so a filter cannot exist in one connector and go
 * missing from another.
 *
 * Source of truth: HiringSignalsController.cs (the query parameters),
 * HiringSignalTypes.cs and HiringSignalSeniority in HiringSignalFocus.cs.
 * `signals.contract.test.ts` reads those files when they are there and fails
 * when this one has drifted from them.
 *
 * Signals are billed per signal returned, and a signal read again is billed
 * again, at ten times a job's rate. Every surface built on this should take a
 * limit from the user and say what a read costs.
 */
import { JoboInputError } from "./errors";
import { COMPANY_SIZES } from "./filters";
import type { HiringSignalFilters } from "./types";

/** `type` values, in the API's own order. More may be added: ignore one you do not know. */
export const SIGNAL_TYPES = [
  "hiring_surge",
  "new_function",
  "new_country",
  "leadership_hire",
  "new_skill",
  "hiring_slowdown",
  "first_role",
  "new_technology",
  "function_surge",
  "new_city",
  "hard_to_fill",
  "leadership_role_closed",
  "hiring_freeze",
  "hiring_resumed",
] as const;

/** `seniority` values, lowest first. */
export const SIGNAL_SENIORITY = ["junior", "mid", "senior", "director", "vp", "c_level", "executive"] as const;

/** Signals per page: `limit` runs from 1 to this, and defaults to 50. */
export const SIGNAL_MAX_LIMIT = 200;
export const SIGNAL_DEFAULT_LIMIT = 50;

/** The most values one comma-separated filter takes. */
export const SIGNAL_MAX_LIST_VALUES = 100;

/**
 * `sort` values, the default first.
 *
 * `detected_desc` is the newest detection day first: the order to browse in.
 * `created_asc` is the order signals were stored in, oldest first: the order
 * to poll in, because the next page is always the next signals stored. A
 * `next_cursor` belongs to the order it was issued under.
 */
export const SIGNAL_SORTS = ["detected_desc", "created_asc"] as const;
export const SIGNAL_DEFAULT_SORT = "detected_desc";
/** The order `pollSignals()` reads in. */
export const SIGNAL_POLL_SORT = "created_asc";

export type SignalType = (typeof SIGNAL_TYPES)[number];
export type SignalSeniority = (typeof SIGNAL_SENIORITY)[number];
export type SignalSort = (typeof SIGNAL_SORTS)[number];

/** `date` is a calendar day (`yyyy-MM-dd`); `dateTime` is an instant. */
export type SignalFilterKind = "stringList" | "enumList" | "number" | "boolean" | "date" | "dateTime";

export interface SignalFilterDescriptor {
  /** The query parameter name on `GET /api/signals`. */
  key: keyof HiringSignalFilters & string;
  label: string;
  kind: SignalFilterKind;
  description: string;
  /** Present for `enumList`. */
  options?: readonly string[];
  /**
   * True when the filter says which companies or which subjects are wanted.
   * A polling trigger needs at least one — see `assertHasNarrowingSignalFilter`.
   */
  narrowing?: boolean;
  /** True when `GET /api/companies/{id}/signals` takes it too. */
  company?: boolean;
  /** Lowest and highest value the API accepts, for `number`. */
  min?: number;
  max?: number;
}

export const HIRING_SIGNAL_FILTERS: readonly SignalFilterDescriptor[] = [
  {
    key: "types",
    label: "Signal Types",
    kind: "enumList",
    description: "Only these kinds of signal, e.g. hiring_surge, new_country, leadership_hire. Leave empty for every kind.",
    options: SIGNAL_TYPES,
    narrowing: true,
    company: true,
  },
  {
    key: "domains",
    label: "Company Domains",
    kind: "stringList",
    description: 'Only signals at these companies, by website domain, e.g. "stripe.com". At most 100.',
    narrowing: true,
  },
  {
    key: "company_ids",
    label: "Company IDs",
    kind: "stringList",
    description: "Only signals at these companies, by Jobo company id (a GUID). At most 100.",
    narrowing: true,
  },
  {
    key: "exclude_domains",
    label: "Exclude Company Domains",
    kind: "stringList",
    description: "Leave out these companies, by website domain, e.g. your existing customers. At most 100.",
  },
  {
    key: "countries",
    label: "Company Countries",
    kind: "stringList",
    description: 'Countries the companies are headquartered in, as two-letter codes, e.g. "US", "DE".',
    narrowing: true,
  },
  {
    key: "company_sizes",
    label: "Company Sizes",
    kind: "enumList",
    description: "Headcount bands of the companies.",
    options: COMPANY_SIZES,
    narrowing: true,
  },
  {
    key: "industries",
    label: "Industries",
    kind: "stringList",
    description:
      "Industries of the companies, matched against the primary industry and the industry list. A value cannot contain a comma.",
    narrowing: true,
  },
  {
    key: "categories",
    label: "Company Categories",
    kind: "stringList",
    description: "Company categories, as returned in company.categories, e.g. SaaS.",
    narrowing: true,
  },
  {
    key: "funding_stages",
    label: "Funding Stages",
    kind: "stringList",
    description: 'Latest funding round of the companies, as returned in company.funding_stage, e.g. "Seed", "Series A".',
    narrowing: true,
  },
  {
    key: "founded_after",
    label: "Founded In or After",
    kind: "number",
    description: "Only companies founded in this year or later.",
    min: 1800,
    max: 2100,
  },
  {
    key: "exclude_agencies",
    label: "Exclude Staffing Agencies",
    kind: "boolean",
    description: "Leave out staffing agencies, whose postings are their clients' hiring.",
  },
  {
    key: "functions",
    label: "Functions",
    kind: "stringList",
    description: 'Job categories the signal must be about, e.g. "Technology", "Sales". A focus filter.',
    narrowing: true,
  },
  {
    key: "roles",
    label: "Roles",
    kind: "stringList",
    description:
      'Words or phrases to look for in the job title or occupation behind the signal, e.g. "data engineer". At least 2 characters each. A focus filter.',
    narrowing: true,
  },
  {
    key: "seniority",
    label: "Seniority",
    kind: "enumList",
    description: "Seniority of the role behind the signal. A focus filter.",
    options: SIGNAL_SENIORITY,
    narrowing: true,
  },
  {
    key: "technologies",
    label: "Technologies",
    kind: "stringList",
    description: 'Named tools the signal must be about, e.g. "Snowflake". A focus filter, combined with skills and technology categories.',
    narrowing: true,
  },
  {
    key: "skills",
    label: "Skills",
    kind: "stringList",
    description: "Named skills the signal must be about. A focus filter, combined with technologies.",
    narrowing: true,
  },
  {
    key: "technology_categories",
    label: "Technology Categories",
    kind: "stringList",
    description: 'Every tool in a category, as returned in details.technology_category, e.g. "CRM". A focus filter.',
    narrowing: true,
  },
  {
    key: "job_countries",
    label: "Job Countries",
    kind: "stringList",
    description: "Countries the jobs are in (not the company's headquarters), as two-letter codes. A focus filter.",
    narrowing: true,
  },
  {
    key: "job_regions",
    label: "Job Regions",
    kind: "stringList",
    description: 'States, provinces or regions the jobs are in, e.g. "Texas". A focus filter.',
    narrowing: true,
  },
  {
    key: "job_cities",
    label: "Job Cities",
    kind: "stringList",
    description: 'Cities the jobs are in, e.g. "Austin". A focus filter; only new_city and hard_to_fill record a city.',
    narrowing: true,
  },
  {
    key: "min_strength",
    label: "Minimum Strength",
    kind: "number",
    description: "Only signals at least this strong. Strength runs from 1 to 100 and compares signals of the same type.",
    min: 1,
    max: 100,
    company: true,
  },
  {
    key: "min_new_jobs",
    label: "Minimum New Jobs",
    kind: "number",
    description: "Only hiring_surge and function_surge signals of at least this many new jobs. Other types are not affected.",
    min: 1,
    max: 10_000,
  },
  {
    key: "min_days_open",
    label: "Minimum Days Open",
    kind: "number",
    description: "Only hard_to_fill signals for jobs open at least this many days. Other types are not affected.",
    min: 1,
    max: 365,
  },
  {
    key: "reposted_only",
    label: "Reposted Jobs Only",
    kind: "boolean",
    description: "Only hard_to_fill signals for jobs posted again after closing. Other types are not affected.",
  },
  {
    key: "detected_after",
    label: "Detected On or After",
    kind: "date",
    description: "Earliest detection day, inclusive, as yyyy-MM-dd.",
    company: true,
  },
  {
    key: "detected_before",
    label: "Detected On or Before",
    kind: "date",
    description: "Latest detection day, inclusive, as yyyy-MM-dd.",
    company: true,
  },
  {
    key: "created_after",
    label: "Created After",
    kind: "dateTime",
    description:
      "Only signals first stored after this instant, exclusive. To read what is new, read in stored order and pass the created_at of the last signal received, unchanged.",
    company: true,
  },
];

/** Keys `GET /api/companies/{id}/signals` takes; the company is in the path. */
export const COMPANY_SIGNAL_FILTER_KEYS: readonly string[] = HIRING_SIGNAL_FILTERS.filter(
  (filter) => filter.company,
).map((filter) => filter.key);

/** Keys that count as narrowing, derived so the two can never drift. */
export const NARROWING_SIGNAL_FILTER_KEYS: readonly string[] = HIRING_SIGNAL_FILTERS.filter(
  (filter) => filter.narrowing,
).map((filter) => filter.key);

/**
 * Guard against a signals trigger that reads every signal there is.
 *
 * A signal costs ten times a job, so a trigger with nothing to say which
 * companies or subjects it wants is the most expensive misconfiguration this
 * package can be asked for. A strength or date bound alone does not count.
 */
export function assertHasNarrowingSignalFilter(filters: Record<string, unknown>): void {
  const hasOne = NARROWING_SIGNAL_FILTER_KEYS.some((key) => {
    const value = filters[key];
    if (value == null) return false;
    if (Array.isArray(value)) return value.some((entry) => String(entry ?? "").trim() !== "");
    if (typeof value === "string") return value.trim().length > 0;
    return true;
  });

  if (!hasOne) {
    throw new Error(
      "At least one narrowing filter is required before watching hiring signals: " +
        `${NARROWING_SIGNAL_FILTER_KEYS.join(", ")}. ` +
        "Without one the trigger reads every signal Jobo detects, and each signal is billed.",
    );
  }
}

/** Trimmed, de-duplicated, blank-free; undefined when nothing is left. */
function cleanList(values: unknown): string[] | undefined {
  if (!Array.isArray(values)) return undefined;
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of values) {
    if (raw == null) continue;
    const value = String(raw).trim();
    if (value === "" || seen.has(value)) continue;
    seen.add(value);
    out.push(value);
  }
  return out.length > 0 ? out : undefined;
}

/**
 * Map signal filters onto the query of `GET /api/signals`.
 *
 * Lists are sent comma-separated, which is the only form the API reads, so a
 * value that itself contains a comma is refused here rather than silently
 * split into two filters, and so is a list longer than the API takes. Both
 * throw `JoboInputError`. Empty values are left out, so an untouched form
 * field never becomes a filter; `false` and non-positive numbers are the
 * unset state of a host's checkbox or number field and are left out too.
 *
 * Pass `keys` to keep only some filters: `COMPANY_SIGNAL_FILTER_KEYS` for the
 * per-company endpoint.
 *
 * `sort` is sent only when it is not the default, so a request that does not
 * ask for an order is the one it always was. A value the API does not know
 * throws `JoboInputError`.
 */
export function toSignalsQuery(
  filters: HiringSignalFilters,
  paging: { limit?: number; sort?: string; cursor?: string } = {},
  keys?: readonly string[],
): Record<string, string | number | boolean> {
  const query: Record<string, string | number | boolean> = {};
  const source = filters as Record<string, unknown>;

  for (const filter of HIRING_SIGNAL_FILTERS) {
    if (keys && !keys.includes(filter.key)) continue;
    const value = source[filter.key];
    if (value == null) continue;

    if (filter.kind === "stringList" || filter.kind === "enumList") {
      const list = cleanList(Array.isArray(value) ? value : [value]);
      if (!list) continue;
      const withComma = list.find((entry) => entry.includes(","));
      if (withComma !== undefined) {
        throw new JoboInputError(
          `"${withComma}" cannot be used in ${filter.label}: the signals API separates values with commas, so a value that contains one is read as two.`,
        );
      }
      if (list.length > SIGNAL_MAX_LIST_VALUES) {
        throw new JoboInputError(
          `${filter.label} takes at most ${SIGNAL_MAX_LIST_VALUES} values, and ${list.length} were given. Split them over several requests.`,
        );
      }
      query[filter.key] = list.join(",");
    } else if (filter.kind === "boolean") {
      if (value === true) query[filter.key] = true;
    } else if (filter.kind === "number") {
      const number = typeof value === "number" ? value : Number(value);
      if (Number.isFinite(number) && number > 0) query[filter.key] = Math.trunc(number);
    } else {
      const text = String(value).trim();
      if (text !== "") query[filter.key] = text;
    }
  }

  if (paging.sort != null && String(paging.sort).trim() !== "") {
    const sort = String(paging.sort).trim().toLowerCase();
    if (!(SIGNAL_SORTS as readonly string[]).includes(sort)) {
      throw new JoboInputError(`"${paging.sort}" is not a signals sort. Use one of: ${SIGNAL_SORTS.join(", ")}.`);
    }
    if (sort !== SIGNAL_DEFAULT_SORT) query.sort = sort;
  }
  if (paging.limit !== undefined) query.limit = paging.limit;
  if (paging.cursor) query.cursor = paging.cursor;

  return query;
}
