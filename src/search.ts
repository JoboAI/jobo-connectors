import type { IncludeExclude, JobSearchFilters, JobSearchRequest } from "./types";

/** Non-filter body fields a caller adds on top of the filters. */
export type JobSearchPaging = Pick<
  JobSearchRequest,
  "page" | "page_size" | "include_facets" | "include_fields"
>;

/** Trimmed, de-duplicated, blank-free; undefined when nothing is left. */
function clean(values: readonly string[] | undefined): string[] | undefined {
  if (!Array.isArray(values)) return undefined;
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of values) {
    if (typeof raw !== "string") continue;
    const value = raw.trim();
    if (value === "" || seen.has(value)) continue;
    seen.add(value);
    out.push(value);
  }
  return out.length > 0 ? out : undefined;
}

function includeExclude(
  include: readonly string[] | undefined,
  exclude: readonly string[] | undefined,
): IncludeExclude | undefined {
  const inc = clean(include);
  const exc = clean(exclude);
  if (!inc && !exc) return undefined;
  return { ...(inc ? { include: inc } : {}), ...(exc ? { exclude: exc } : {}) };
}

function text(value: string | undefined): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
}

/** Zero is the n8n default for an unset number field, so it means "no bound". */
function bound(value: number | undefined): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : undefined;
}

/**
 * Map connector filter values (keyed by `JOB_SEARCH_FILTERS` keys) onto a
 * `POST /api/jobs/search` body.
 *
 * The include/exclude filters are nested objects on the wire; the API ignores
 * a flat `skills_exclude` key without failing (it reports it as an
 * `unknown_request_fields` warning), which is exactly the class of silent
 * mistake this function exists to keep out of every connector. Empty values
 * are left out, so an untouched form field never becomes a filter, and
 * defaults (`search_description: true`, `sort: relevance`,
 * `description_format: markdown`) are not sent.
 */
export function toJobSearchBody(filters: JobSearchFilters, paging: JobSearchPaging = {}): JobSearchRequest {
  const body: JobSearchRequest = {};

  const q = text(filters.q);
  if (q) body.queries = [q];
  if (filters.search_description === false) body.search_description = false;

  const location = text(filters.location);
  if (location) body.locations = [location];

  const sources = clean(filters.sources);
  if (sources) body.sources = sources;

  const lists: Array<[keyof JobSearchRequest, string[] | undefined]> = [
    ["work_models", clean(filters.work_model)],
    ["employment_types", clean(filters.employment_type)],
    ["experience_levels", clean(filters.experience_level)],
    ["languages", clean(filters.language)],
  ];
  for (const [key, value] of lists) {
    if (value) (body as Record<string, unknown>)[key] = value;
  }

  const pairs: Array<[keyof JobSearchRequest, IncludeExclude | undefined]> = [
    ["skills", includeExclude(filters.skills, filters.exclude_skills)],
    ["companies", includeExclude(filters.companies, filters.exclude_companies)],
    ["industries", includeExclude(filters.industries, filters.exclude_industries)],
    ["company_categories", includeExclude(filters.company_categories, filters.exclude_company_categories)],
    ["job_categories", includeExclude(filters.job_categories, filters.exclude_job_categories)],
    ["job_subcategories", includeExclude(filters.job_subcategories, filters.exclude_job_subcategories)],
    ["occupation_ids", includeExclude(filters.occupation_ids, filters.exclude_occupation_ids)],
  ];
  for (const [key, value] of pairs) {
    if (value) (body as Record<string, unknown>)[key] = value;
  }

  const min = bound(filters.min_salary_usd);
  const max = bound(filters.max_salary_usd);
  if (min !== undefined || max !== undefined) {
    body.salary_usd = { ...(min !== undefined ? { min } : {}), ...(max !== undefined ? { max } : {}) };
  }

  for (const key of ["posted_after", "posted_before", "discovered_after", "discovered_before"] as const) {
    const value = text(filters[key]);
    if (value) body[key] = value;
  }

  if (filters.sort && filters.sort !== "relevance") body.sort = filters.sort;
  if (filters.description_format && filters.description_format !== "markdown") body.description_format = filters.description_format;

  if (paging.page !== undefined) body.page = paging.page;
  if (paging.page_size !== undefined) body.page_size = paging.page_size;
  if (paging.include_facets !== undefined) body.include_facets = [...paging.include_facets];
  if (paging.include_fields !== undefined) body.include_fields = [...paging.include_fields];

  return body;
}

/**
 * Turn a list field into values. Arrays pass through entry by entry (values
 * such as industry names may contain commas); a single string, which is what
 * an AI agent or an expression usually hands a list field, is split on commas
 * and newlines. Blank entries and duplicates are dropped.
 */
export function toList(value: unknown): string[] | undefined {
  if (value == null) return undefined;
  if (Array.isArray(value)) {
    return clean(value.filter((entry) => entry != null).map((entry) => String(entry)));
  }
  if (typeof value === "string") return clean(value.split(/[\n,]/));
  return clean([String(value)]);
}
