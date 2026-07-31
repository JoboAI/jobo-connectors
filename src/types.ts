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
}

export interface JobSearchResponse {
  jobs: Job[];
  total: number;
  page: number;
  page_size: number;
  total_pages: number;
  facets: Record<string, JobFacet[]>;
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
  posted_after?: string;
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
