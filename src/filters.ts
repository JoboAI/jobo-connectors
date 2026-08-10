/**
 * One description of the filter surface, shared by every connector.
 *
 * Each platform renders its own field UI (n8n `INodeProperties`, Zapier
 * `inputFields`, Make module JSON, a WordPress settings screen), but all of them
 * derive from this array — so a filter cannot exist in the n8n node and quietly
 * go missing from the Zapier trigger.
 *
 * NOTE: the enum values below are the *input* filter values, which are lowercase
 * and canonical. They differ from the display-cased values the API returns on a
 * job ("remote" in, "Remote" out). Source of truth is
 * Jobo.Enterprise/Modules/Jobo.Enterprise.Shared/Models/Feed/FeedDtos.cs.
 *
 * TODO: once docs/openapi.yaml carries real `enum:` arrays rather than prose
 * inside `description:` strings, generate this file from the spec (see
 * connector-codegen) and add a drift guard, mirroring the approach in
 * Jobo.Enterprise.Web/scripts/generate-job-field-catalogue.mjs.
 */

export const WORK_MODELS = ["remote", "hybrid", "onsite"] as const;

export const EMPLOYMENT_TYPES = [
  "full-time",
  "part-time",
  "contract",
  "internship",
  "freelance",
  "temporary",
] as const;

export const EXPERIENCE_LEVELS = ["intern", "entry", "mid", "senior", "lead", "executive"] as const;

export type WorkModel = (typeof WORK_MODELS)[number];
export type EmploymentType = (typeof EMPLOYMENT_TYPES)[number];
export type ExperienceLevel = (typeof EXPERIENCE_LEVELS)[number];

export type FilterKind = "string" | "number" | "boolean" | "dateTime" | "stringList" | "enumList";

export interface FilterDescriptor {
  /** Query-parameter name as the API expects it. */
  key: string;
  label: string;
  kind: FilterKind;
  description: string;
  /** Present for `enumList`. */
  options?: readonly string[];
  /**
   * True when this filter meaningfully narrows the result set. At least one
   * narrowing filter is required before a polling trigger may run — see
   * `assertHasNarrowingFilter`.
   */
  narrowing?: boolean;
  /**
   * Loaded at runtime rather than hard-coded, because the value set churns.
   * Values are exactly the facet names `JoboClient.filterOptions()` accepts —
   * back these fields with that call (plus `suggestLocations()` for the
   * location field).
   */
  dynamicOptions?: "sources" | "industries" | "skills";
}

export const JOB_SEARCH_FILTERS: readonly FilterDescriptor[] = [
  {
    key: "q",
    label: "Search Query",
    kind: "string",
    description: "Free-text query matched against job title and, unless disabled, description.",
    narrowing: true,
  },
  {
    key: "location",
    label: "Location",
    kind: "string",
    description: 'Free-form location, e.g. "Berlin, Germany" or "Remote".',
    narrowing: true,
  },
  {
    key: "sources",
    label: "Sources",
    kind: "enumList",
    description: "Restrict to specific ATS sources, e.g. greenhouse, lever_co, ashby.",
    narrowing: true,
    dynamicOptions: "sources",
  },
  {
    key: "work_model",
    label: "Work Model",
    kind: "enumList",
    description: "Remote, hybrid or onsite.",
    options: WORK_MODELS,
  },
  {
    key: "employment_type",
    label: "Employment Type",
    kind: "enumList",
    description: "Full-time, part-time, contract, internship, freelance or temporary.",
    options: EMPLOYMENT_TYPES,
  },
  {
    key: "experience_level",
    label: "Experience Level",
    kind: "enumList",
    description: "Intern through executive.",
    options: EXPERIENCE_LEVELS,
  },
  {
    key: "skills",
    label: "Skills",
    kind: "stringList",
    description: "Require one or more skills, e.g. Python, Kubernetes.",
    narrowing: true,
    dynamicOptions: "skills",
  },
  {
    key: "industries",
    label: "Industries",
    kind: "enumList",
    description: "Restrict to companies in specific industries.",
    narrowing: true,
    dynamicOptions: "industries",
  },
  {
    key: "min_salary_usd",
    label: "Minimum Salary (USD)",
    kind: "number",
    description: "Only jobs whose advertised compensation meets this floor.",
  },
  {
    key: "max_salary_usd",
    label: "Maximum Salary (USD)",
    kind: "number",
    description: "Only jobs whose advertised compensation is at or below this ceiling.",
  },
  {
    key: "posted_after",
    label: "Posted After",
    kind: "dateTime",
    description: "Only jobs posted by the employer on or after this timestamp.",
  },
  {
    key: "posted_before",
    label: "Posted Before",
    kind: "dateTime",
    description: "Only jobs posted by the employer on or before this timestamp.",
  },
  {
    key: "discovered_after",
    label: "Discovered After",
    kind: "dateTime",
    description:
      "Only jobs Jobo first indexed on or after this timestamp. This is the field polling triggers advance; prefer it over posted_after for incremental sync.",
  },
  {
    key: "discovered_before",
    label: "Discovered Before",
    kind: "dateTime",
    description: "Only jobs Jobo first indexed on or before this timestamp.",
  },
  {
    key: "search_description",
    label: "Search Descriptions",
    kind: "boolean",
    description: "Match the query against full descriptions as well as titles. Defaults to true.",
  },
];

/**
 * Body keys accepted by `POST /api/jobs/feed` (plus pagination:
 * stable_scan / cursor / batch_size). This is a different surface from
 * search — the plural enum keys are the feed's correct wire contract, not
 * drift. WordPress builds on this surface; its settings are validated
 * against this list.
 */
export const JOB_FEED_FILTER_KEYS = [
  "locations",
  "sources",
  "work_models",
  "employment_types",
  "experience_levels",
  "posted_after",
  "updated_after",
] as const;

/** Keys that count as narrowing, derived so the two can never drift. */
export const NARROWING_FILTER_KEYS: readonly string[] = JOB_SEARCH_FILTERS.filter(
  (filter) => filter.narrowing,
).map((filter) => filter.key);

/**
 * Guard against the single most expensive misconfiguration: an unfiltered
 * polling trigger.
 *
 * Delivered jobs consume a shared Job Search allowance first, then tier
 * overage; without that plan they use the account's direct job rate. Jobs Feed
 * does not cover Search. Cost is independent of poll frequency, so what actually
 * drives a runaway bill is filter breadth. A trigger with no narrowing filter
 * matches the entire firehose.
 */
export function assertHasNarrowingFilter(params: Record<string, unknown>): void {
  const hasOne = NARROWING_FILTER_KEYS.some((key) => {
    const value = params[key];
    if (value == null) return false;
    if (Array.isArray(value)) return value.length > 0;
    if (typeof value === "string") return value.trim().length > 0;
    return true;
  });

  if (!hasOne) {
    throw new Error(
      "At least one narrowing filter is required before polling: " +
        `${NARROWING_FILTER_KEYS.join(", ")}. ` +
        "Polling without one matches every job Jobo indexes and will consume credits very quickly.",
    );
  }
}
