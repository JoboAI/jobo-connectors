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
 * Jobo.Enterprise/Modules/Jobo.Enterprise.Shared/Models/Feed/FeedDtos.cs and
 * Jobo.Enterprise/Modules/Jobo.Enterprise.Module.Search/Models/SearchDtos.cs.
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

/**
 * Business-model buckets a company's `categories` hold. Source of truth:
 * Jobo.Enterprise.Shared/Models/Companies/CompanyCategories.cs.
 */
export const COMPANY_CATEGORIES = [
  "b2b",
  "b2c",
  "b2b2c",
  "b2g",
  "saas",
  "marketplace",
  "e-commerce",
  "service-provider",
  "hardware",
  "agency",
  "nonprofit",
  "government",
  "education",
] as const;

/** Headcount bands, smallest first (feed `company_sizes`). FeedFieldCatalog.CompanySizeBands. */
export const COMPANY_SIZES = [
  "1-10",
  "11-50",
  "51-200",
  "201-500",
  "501-1000",
  "1001-5000",
  "5001-10000",
  "10001+",
] as const;

/** Annual revenue bands, smallest first (feed `company_revenues`). FeedFieldCatalog.CompanyRevenueBands. */
export const COMPANY_REVENUES = [
  "under-1m",
  "1m-10m",
  "10m-50m",
  "50m-100m",
  "100m-200m",
  "200m-1b",
  "over-1b",
] as const;

/**
 * Job description languages as ISO 639-1 codes, with English names for
 * pickers. Not exhaustive — the API takes any ISO 639-1 code (and maps
 * language names and locales such as "English" or "en-US" to one) — but these
 * cover the languages the index actually holds in volume.
 */
export const LANGUAGES = [
  { code: "en", name: "English" },
  { code: "de", name: "German" },
  { code: "fr", name: "French" },
  { code: "es", name: "Spanish" },
  { code: "pt", name: "Portuguese" },
  { code: "it", name: "Italian" },
  { code: "nl", name: "Dutch" },
  { code: "pl", name: "Polish" },
  { code: "sv", name: "Swedish" },
  { code: "da", name: "Danish" },
  { code: "no", name: "Norwegian" },
  { code: "fi", name: "Finnish" },
  { code: "cs", name: "Czech" },
  { code: "sk", name: "Slovak" },
  { code: "hu", name: "Hungarian" },
  { code: "ro", name: "Romanian" },
  { code: "bg", name: "Bulgarian" },
  { code: "el", name: "Greek" },
  { code: "hr", name: "Croatian" },
  { code: "sl", name: "Slovenian" },
  { code: "lt", name: "Lithuanian" },
  { code: "lv", name: "Latvian" },
  { code: "et", name: "Estonian" },
  { code: "tr", name: "Turkish" },
  { code: "ru", name: "Russian" },
  { code: "uk", name: "Ukrainian" },
  { code: "he", name: "Hebrew" },
  { code: "ar", name: "Arabic" },
  { code: "hi", name: "Hindi" },
  { code: "id", name: "Indonesian" },
  { code: "ms", name: "Malay" },
  { code: "th", name: "Thai" },
  { code: "vi", name: "Vietnamese" },
  { code: "zh", name: "Chinese" },
  { code: "ja", name: "Japanese" },
  { code: "ko", name: "Korean" },
] as const;

export const LANGUAGE_CODES: readonly string[] = LANGUAGES.map((language) => language.code);

/**
 * Result orders for search. `discovered_asc` / `discovered_desc` key on the
 * immutable first-indexed time, so pages over a fixed `discovered_*` window
 * stay stable while jobs are updated — what a polling trigger needs.
 */
export const SEARCH_SORTS = ["relevance", "discovered_asc", "discovered_desc"] as const;

/** `description_format` values: Markdown as stored (default) or rendered HTML. */
export const DESCRIPTION_FORMATS = ["markdown", "html"] as const;

/** Heavy, non-core job fields `include_fields` selects (search only). */
export const INCLUDE_FIELDS = ["description", "summary", "qualifications", "responsibilities", "benefits"] as const;

export type WorkModel = (typeof WORK_MODELS)[number];
export type EmploymentType = (typeof EMPLOYMENT_TYPES)[number];
export type ExperienceLevel = (typeof EXPERIENCE_LEVELS)[number];
export type CompanyCategory = (typeof COMPANY_CATEGORIES)[number];
export type CompanySize = (typeof COMPANY_SIZES)[number];
export type CompanyRevenue = (typeof COMPANY_REVENUES)[number];
export type SearchSort = (typeof SEARCH_SORTS)[number];
export type DescriptionFormat = (typeof DESCRIPTION_FORMATS)[number];
export type IncludeField = (typeof INCLUDE_FIELDS)[number];

/** `enum` is a single choice from `options`; `enumList` is any number of them. */
export type FilterKind = "string" | "number" | "boolean" | "dateTime" | "stringList" | "enumList" | "enum";

/**
 * Sources of runtime-loaded values:
 * - `sources`, `industries`, `skills`, `company_categories`, `job_categories`,
 *   `job_subcategories`, `occupations` — facet names `JoboClient.filterOptions()`
 *   accepts (values with live job counts). The three occupation facets 404
 *   until occupations are published; fall back to `JoboClient.occupations()`.
 * - `companies` — `JoboClient.suggestCompanies()`; send every id of a picked
 *   company (`ids`), never its name.
 *
 * Location fields are backed by `JoboClient.suggestLocations()`.
 */
export type DynamicOptionsSource =
  | "sources"
  | "industries"
  | "skills"
  | "company_categories"
  | "job_categories"
  | "job_subcategories"
  | "occupations"
  | "companies";

/** Facet names `GET /api/connectors/filter-options/{facet}` serves. */
export type FilterOptionsFacet = Exclude<DynamicOptionsSource, "companies">;

export interface FilterDescriptor {
  /**
   * Connector-facing filter key. For filters `GET /api/jobs` also takes this
   * is its query-parameter name; the rest are named after the body field with
   * an `exclude_` prefix for the exclude half of an include/exclude filter.
   * `toJobSearchBody()` maps every key onto `POST /api/jobs/search`.
   */
  key: string;
  label: string;
  kind: FilterKind;
  description: string;
  /** Present for `enumList` and `enum`. */
  options?: readonly string[];
  /**
   * True when this filter meaningfully narrows the result set. At least one
   * narrowing filter is required before a polling trigger may run — see
   * `assertHasNarrowingFilter`.
   */
  narrowing?: boolean;
  /** Loaded at runtime rather than hard-coded, because the value set churns. */
  dynamicOptions?: DynamicOptionsSource;
}

export const JOB_SEARCH_FILTERS: readonly FilterDescriptor[] = [
  {
    key: "q",
    label: "Search Query",
    kind: "string",
    description:
      'Free-text query matched against job title and, unless disabled, description. Wrap a phrase in double quotes for an exact title match; prefix a term with "-" to exclude it.',
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
    key: "companies",
    label: "Companies",
    kind: "stringList",
    description:
      'Only jobs at these companies. Each value is a Jobo company id (GUID), a website domain ("stripe.com") or a whole company name ("Stripe"); ids are exact, names also match every other company of that name.',
    narrowing: true,
    dynamicOptions: "companies",
  },
  {
    key: "exclude_companies",
    label: "Exclude Companies",
    kind: "stringList",
    description: "Leave out jobs at these companies (ids, domains or whole names, as for companies).",
    dynamicOptions: "companies",
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
    key: "language",
    label: "Languages",
    kind: "enumList",
    description: 'Description language, as ISO 639-1 codes ("en", "de"). Names and locales are mapped server-side.',
    options: LANGUAGE_CODES,
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
    key: "exclude_skills",
    label: "Exclude Skills",
    kind: "stringList",
    description: "Leave out jobs asking for any of these skills.",
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
    key: "exclude_industries",
    label: "Exclude Industries",
    kind: "enumList",
    description: "Leave out companies in any of these industries.",
    dynamicOptions: "industries",
  },
  {
    key: "company_categories",
    label: "Company Categories",
    kind: "enumList",
    description: "Hiring company's business model, e.g. b2b, saas, marketplace.",
    options: COMPANY_CATEGORIES,
    dynamicOptions: "company_categories",
  },
  {
    key: "exclude_company_categories",
    label: "Exclude Company Categories",
    kind: "enumList",
    description: "Leave out companies with any of these business models, e.g. agency.",
    options: COMPANY_CATEGORIES,
    dynamicOptions: "company_categories",
  },
  {
    key: "job_categories",
    label: "Job Categories",
    kind: "stringList",
    description: 'Occupation category names, e.g. "Healthcare" (GET /api/occupations lists them). Case-insensitive.',
    narrowing: true,
    dynamicOptions: "job_categories",
  },
  {
    key: "exclude_job_categories",
    label: "Exclude Job Categories",
    kind: "stringList",
    description: "Leave out jobs in these occupation categories.",
    dynamicOptions: "job_categories",
  },
  {
    key: "job_subcategories",
    label: "Job Subcategories",
    kind: "stringList",
    description: 'Occupation subcategory names, e.g. "Nursing". Case-insensitive.',
    narrowing: true,
    dynamicOptions: "job_subcategories",
  },
  {
    key: "exclude_job_subcategories",
    label: "Exclude Job Subcategories",
    kind: "stringList",
    description: "Leave out jobs in these occupation subcategories.",
    dynamicOptions: "job_subcategories",
  },
  {
    key: "occupation_ids",
    label: "Occupations",
    kind: "stringList",
    description:
      'Occupation ids, e.g. "esco:8d3e8aaa-791b-4c75-a465-f3f827028f50" or "jobo:backend-developer". Ids, not names: names can change.',
    narrowing: true,
    dynamicOptions: "occupations",
  },
  {
    key: "exclude_occupation_ids",
    label: "Exclude Occupations",
    kind: "stringList",
    description: "Leave out jobs with these occupation ids.",
    dynamicOptions: "occupations",
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
  {
    key: "sort",
    label: "Sort",
    kind: "enum",
    description:
      "relevance (default), discovered_asc or discovered_desc. The discovered orders key on the first-indexed time and keep pages stable.",
    options: SEARCH_SORTS,
  },
  {
    key: "description_format",
    label: "Description Format",
    kind: "enum",
    description: "markdown (default, as stored) or html.",
    options: DESCRIPTION_FORMATS,
  },
];

/**
 * Body keys accepted by `POST /api/jobs/feed` (plus pagination:
 * stable_scan / cursor / batch_size). This is a different surface from
 * search — the plural enum keys are the feed's correct wire contract, not
 * drift. The include/exclude filters (`companies`, `industries`, …) take
 * `{ include, exclude }` objects; the five plain lists have `exclude_*`
 * siblings instead. WordPress builds on this surface; its settings are
 * validated against this list.
 */
export const JOB_FEED_FILTER_KEYS = [
  "locations",
  "sources",
  "work_models",
  "employment_types",
  "experience_levels",
  "languages",
  "exclude_sources",
  "exclude_work_models",
  "exclude_employment_types",
  "exclude_experience_levels",
  "exclude_languages",
  "companies",
  "job_categories",
  "job_subcategories",
  "occupation_ids",
  "industries",
  "company_primary_industries",
  "company_categories",
  "company_sizes",
  "company_revenues",
  "company_is_agency",
  "posted_after",
  "include_reactivated",
  "description_format",
  "updated_after",
] as const;

export type JobFeedFilterKey = (typeof JOB_FEED_FILTER_KEYS)[number];

/** Keys that count as narrowing, derived so the two can never drift. */
export const NARROWING_FILTER_KEYS: readonly string[] = JOB_SEARCH_FILTERS.filter(
  (filter) => filter.narrowing,
).map((filter) => filter.key);

/**
 * Guard against the single most expensive misconfiguration: an unfiltered
 * polling trigger.
 *
 * Delivered jobs use a Job Search plan's included jobs first, then the
 * pay-as-you-go rate; without a plan they are pay as you go. The Unlimited plan
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
