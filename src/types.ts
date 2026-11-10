/**
 * Wire types for the Jobo public API (https://connect.jobo.world).
 *
 * The API serialises with a snake_case policy for both property names and enum
 * values, so these mirror the wire format exactly rather than idiomatic JS
 * casing — connectors hand these objects straight to platform field mappers and
 * renaming would break every user's saved mapping.
 *
 * Canonical source: Jobo.Enterprise/Modules/Jobo.Enterprise.Shared/Models/Feed/JobDto.cs
 */

export interface JobCompany {
  id: string;
  name: string;
  website: string | null;
  logo_url: string | null;
  summary: string | null;
  industries: string[];
  categories: string[];
  linkedin_url: string | null;
  crunchbase_url: string | null;
  details_url: string | null;
}

export interface JobLocation {
  location: string | null;
  city: string | null;
  region: string | null;
  country: string | null;
  latitude: number | null;
  longitude: number | null;
}

export interface JobCompensation {
  min: number | null;
  max: number | null;
  currency: string | null;
  /** hourly | daily | weekly | monthly | yearly | per-diem */
  period: string | null;
}

export interface JobSkill {
  name: string;
  /** hard | soft */
  type: string | null;
}

export interface JobQualificationGroup {
  education: string[];
  certifications: string[];
  skills: JobSkill[];
}

export interface JobQualifications {
  must_have: JobQualificationGroup | null;
  preferred: JobQualificationGroup | null;
}

export interface Job {
  id: string;
  title: string;
  normalized_title: string | null;
  company: JobCompany | null;
  description: string | null;
  summary: string | null;
  listing_url: string | null;
  apply_url: string | null;
  locations: JobLocation[];
  compensation: JobCompensation | null;
  /** Output values are display-cased ("Full-time"), unlike the lowercase filter inputs. */
  employment_type: string | null;
  workplace_type: string | null;
  experience_level: string | null;
  source: string | null;
  created_at: string;
  updated_at: string;
  date_posted: string | null;
  valid_through: string | null;
  qualifications: JobQualifications | null;
  responsibilities: string[];
  benefits: string[];
  is_work_auth_required: boolean | null;
  is_h1b_sponsor: boolean | null;
  is_clearance_required: boolean | null;
}

export interface JobFacet {
  key: string;
  count: number;
  /**
   * Display name, on the occupation facets only ("Healthcare" for the key
   * "healthcare", or an occupation's name for its id).
   */
  name?: string | null;
  /** Key of the level above, on job_subcategories and occupations buckets. */
  parent?: string | null;
}

/** A non-fatal note about the request, e.g. `companies_unmatched`. */
export interface SearchWarning {
  code: string;
  field?: string | null;
  message: string;
  values?: string[] | null;
}

export interface JobSearchResponse {
  jobs: Job[];
  total: number;
  page: number;
  page_size: number;
  total_pages: number;
  facets: Record<string, JobFacet[]>;
  /** Present only when there is something to warn about. */
  warnings?: SearchWarning[] | null;
  /** Company-filter diagnostics, present only when `companies` was sent. */
  filters?: Record<string, unknown> | null;
}

export interface JobFeedResponse {
  jobs: Job[];
  next_cursor: string | null;
  has_more: boolean;
  estimated_total?: number;
}

export interface ExpiredJobIdsResponse {
  job_ids: string[];
  next_cursor: string | null;
  has_more: boolean;
}

/**
 * Connector filter values, keyed exactly by `JOB_SEARCH_FILTERS` keys.
 * `toJobSearchBody()` turns them into a `POST /api/jobs/search` body.
 */
export interface JobSearchFilters {
  q?: string;
  location?: string;
  sources?: string[];
  companies?: string[];
  exclude_companies?: string[];
  work_model?: string[];
  employment_type?: string[];
  experience_level?: string[];
  language?: string[];
  skills?: string[];
  exclude_skills?: string[];
  industries?: string[];
  exclude_industries?: string[];
  company_categories?: string[];
  exclude_company_categories?: string[];
  job_categories?: string[];
  exclude_job_categories?: string[];
  job_subcategories?: string[];
  exclude_job_subcategories?: string[];
  occupation_ids?: string[];
  exclude_occupation_ids?: string[];
  min_salary_usd?: number;
  max_salary_usd?: number;
  posted_after?: string;
  posted_before?: string;
  discovered_after?: string;
  discovered_before?: string;
  search_description?: boolean;
  sort?: SearchSortValue;
  description_format?: DescriptionFormatValue;
}

export type SearchSortValue = "relevance" | "discovered_asc" | "discovered_desc";
export type DescriptionFormatValue = "markdown" | "html" | "enhanced" | "enhanced_html";

/** An include/exclude filter on `POST /api/jobs/search` and `POST /api/jobs/feed`. */
export interface IncludeExclude {
  include?: string[];
  exclude?: string[];
}

/** Body accepted by `POST /api/jobs/search`. */
export interface JobSearchRequest {
  queries?: string[];
  search_description?: boolean;
  locations?: string[];
  sources?: string[];
  skills?: IncludeExclude;
  companies?: IncludeExclude;
  industries?: IncludeExclude;
  company_categories?: IncludeExclude;
  job_categories?: IncludeExclude;
  job_subcategories?: IncludeExclude;
  occupation_ids?: IncludeExclude;
  work_models?: string[];
  employment_types?: string[];
  experience_levels?: string[];
  languages?: string[];
  salary_usd?: { min?: number; max?: number };
  posted_after?: string;
  posted_before?: string;
  discovered_after?: string;
  discovered_before?: string;
  sort?: SearchSortValue;
  page?: number;
  page_size?: number;
  /** Tri-state like the GET parameter: omitted = default subset, [] = none. */
  include_facets?: string[];
  /** Omitted = full job, [] = core fields only, a list = core plus those. */
  include_fields?: string[];
  description_format?: DescriptionFormatValue;
}

/** Query parameters accepted by `GET /api/jobs`. */
export interface JobSearchParams {
  q?: string;
  location?: string;
  sources?: string[];
  work_model?: string[];
  employment_type?: string[];
  experience_level?: string[];
  posted_after?: string;
  posted_before?: string;
  discovered_after?: string;
  discovered_before?: string;
  min_salary_usd?: number;
  max_salary_usd?: number;
  skills?: string[];
  industries?: string[];
  /**
   * Facet names to include (work_model | experience_level | employment_type |
   * sources | industries | skills). The API treats this as tri-state: omitted →
   * its default subset, `[]` → no facets, list → exactly those. It is NOT a
   * boolean — `include_facets=true` would be parsed as a facet literally named
   * "true" and silently disable facets.
   */
  include_facets?: string[];
  include_fields?: string[];
  search_description?: boolean;
  page?: number;
  page_size?: number;
}

/** Body accepted by `POST /api/jobs/feed`. */
export interface JobFeedParams {
  locations?: Array<{ country?: string; region?: string; city?: string }>;
  sources?: string[];
  work_models?: string[];
  employment_types?: string[];
  experience_levels?: string[];
  languages?: string[];
  exclude_sources?: string[];
  exclude_work_models?: string[];
  exclude_employment_types?: string[];
  exclude_experience_levels?: string[];
  exclude_languages?: string[];
  companies?: IncludeExclude;
  job_categories?: IncludeExclude;
  job_subcategories?: IncludeExclude;
  occupation_ids?: IncludeExclude;
  industries?: IncludeExclude;
  company_primary_industries?: IncludeExclude;
  company_categories?: IncludeExclude;
  company_sizes?: IncludeExclude;
  company_revenues?: IncludeExclude;
  /** false leaves out staffing-agency jobs; true returns only theirs. */
  company_is_agency?: boolean;
  posted_after?: string;
  /** Also re-deliver jobs reactivated on or after posted_after. */
  include_reactivated?: boolean;
  description_format?: DescriptionFormatValue;
  updated_after?: string;
  stable_scan?: boolean;
  cursor?: string;
  batch_size?: number;
}

/**
 * Canonical filter vocabulary served by `GET /api/connectors/filters`.
 * Enum values come from the backend's SearchFieldKeys, so they are by
 * construction the values the exact-match filter hits; `sources` is the live
 * provider list with per-source job counts.
 */
export interface ConnectorFiltersResponse {
  enums: ConnectorFilterEnums;
  sources: JobFacet[];
}

export interface ConnectorFilterEnums {
  work_models: string[];
  employment_types: string[];
  experience_levels: string[];
}

/**
 * One real company from `GET /api/connectors/companies/suggest`. The catalog
 * holds one row per career-site board, so a company is every board sharing
 * its name and website. Send all of `ids` as `companies` filter values; the
 * name would also match every other company called that.
 */
export interface CompanySuggestion {
  /** The board with the most live jobs, for single-value pickers. */
  id: string;
  ids: string[];
  name: string;
  domain: string | null;
  logo_url: string | null;
  /** HQ country, ISO 3166-1 alpha-2. */
  country: string | null;
  /** Live jobs across `ids`; null when the count was unavailable. */
  job_count: number | null;
}

/** Response of `GET /api/connectors/companies/suggest`. */
export interface SuggestCompaniesResponse {
  suggestions: CompanySuggestion[];
}

/** One occupation in `GET /api/occupations`. */
export interface OccupationItem {
  /** The `occupation_ids` filter value: `esco:<uuid>` or `jobo:<slug>`. */
  id: string;
  name: string;
  isco_code?: string | null;
  onet_soc_codes?: string[];
}

export interface OccupationSubcategory {
  /** The `job_subcategories` filter value, e.g. "Nursing". */
  name: string;
  occupations: OccupationItem[];
}

export interface OccupationCategory {
  /** The `job_categories` filter value, e.g. "Healthcare". */
  name: string;
  subcategories: OccupationSubcategory[];
}

/** Response of `GET /api/occupations` (404 until occupations are published). */
export interface OccupationTaxonomyResponse {
  version: string;
  categories: OccupationCategory[];
}

/** Response of `GET /api/connectors/filter-options/{facet}`. */
export interface FilterOptionsResponse {
  facet: string;
  options: JobFacet[];
}

/**
 * One Photon-normalized location suggestion. Picked values carry the exact
 * city/region/country labels the job index stores, so a stored filter always
 * matches what search matches.
 */
export interface LocationSuggestion {
  city: string | null;
  region: string | null;
  country: string | null;
  latitude: number | null;
  longitude: number | null;
  display_name: string | null;
  country_code: string | null;
}

/** Response of `GET /api/connectors/locations/suggest`. */
export interface SuggestLocationsResponse {
  suggestions: LocationSuggestion[];
}

/**
 * Metering and throttling signals lifted off the response headers.
 *
 * Every connector is expected to surface these in whatever run-log the host
 * platform provides — a user who sees "this run cost 75 credits" once will never
 * be surprised by an invoice.
 */
export interface UsageInfo {
  creditsRequired: number | null;
  creditsDeducted: number | null;
  creditsBalance: number | null;
  rateLimitLimit: number | null;
  rateLimitRemaining: number | null;
  rateLimitResetUnix: number | null;
  rateLimitGroup: string | null;
  quotaLimit: number | null;
  quotaRemaining: number | null;
  totalCount: number | null;
}

export interface Result<T> {
  data: T;
  usage: UsageInfo;
}
