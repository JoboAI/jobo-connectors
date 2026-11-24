/**
 * @jobo-ai/connector-core
 *
 * Shared client behind every Jobo marketplace connector (n8n, Zapier, Pipedream,
 * Google Sheets, WordPress). Zero runtime dependencies and an injectable
 * transport, because the host sandboxes disagree: n8n's verified-node scanner
 * rejects a non-empty `dependencies`, Make has no JS runtime, and Apps Script
 * has no npm. Consume this as a devDependency and bundle it.
 */

export { VERSION } from "./version";

export {
  JoboClient,
  DEFAULT_BASE_URL,
  DEFAULT_FEED_TIMEOUT_MS,
  isValidApiKeyFormat,
  assertValidApiKeyFormat,
  type JoboClientOptions,
} from "./client";

export {
  JoboError,
  JoboInputError,
  JoboApiError,
  JoboTransportError,
  InsufficientCreditsError,
  FeedCursorRestartRequiredError,
  RateLimitError,
  CreditFloorReachedError,
} from "./errors";

export type { Transport, TransportRequest, TransportResponse } from "./transport";

export {
  withRetry,
  isRetryable,
  nextDelayMs,
  resolveRetryOptions,
  defaultRetryOptions,
  type RetryOptions,
  type RetryDefaults,
  type RetryOverrides,
  type RetryScope,
} from "./retry";

export {
  poll,
  shouldSkipPoll,
  defaultPollOptions,
  MIN_POLL_INTERVAL_SECONDS,
  POLL_INTERVAL_GRACE_SECONDS,
  WindowOverflowError,
  type PollState,
  type PollOptions,
  type PollResult,
} from "./poll";

export {
  JOB_SEARCH_FILTERS,
  JOB_FEED_FILTER_KEYS,
  NARROWING_FILTER_KEYS,
  WORK_MODELS,
  EMPLOYMENT_TYPES,
  EXPERIENCE_LEVELS,
  COMPANY_CATEGORIES,
  COMPANY_SIZES,
  COMPANY_REVENUES,
  LANGUAGES,
  LANGUAGE_CODES,
  SEARCH_SORTS,
  DESCRIPTION_FORMATS,
  INCLUDE_FIELDS,
  assertHasNarrowingFilter,
  type FilterDescriptor,
  type FilterKind,
  type DynamicOptionsSource,
  type FilterOptionsFacet,
  type JobFeedFilterKey,
  type WorkModel,
  type EmploymentType,
  type ExperienceLevel,
  type CompanyCategory,
  type CompanySize,
  type CompanyRevenue,
  type SearchSort,
  type DescriptionFormat,
  type IncludeField,
} from "./filters";

export { toJobSearchBody, toList, type JobSearchPaging } from "./search";

export {
  HIRING_SIGNAL_FILTERS,
  COMPANY_SIGNAL_FILTER_KEYS,
  NARROWING_SIGNAL_FILTER_KEYS,
  SIGNAL_TYPES,
  SIGNAL_SENIORITY,
  SIGNAL_MAX_LIMIT,
  SIGNAL_DEFAULT_LIMIT,
  SIGNAL_MAX_LIST_VALUES,
  SIGNAL_SORTS,
  SIGNAL_DEFAULT_SORT,
  SIGNAL_POLL_SORT,
  assertHasNarrowingSignalFilter,
  toSignalsQuery,
  type SignalFilterDescriptor,
  type SignalFilterKind,
  type SignalType,
  type SignalSeniority,
  type SignalSort,
} from "./signals";

export { SIGNAL_TYPE_LABELS, signalTypeLabel, signalStrengthBand, describeSignal } from "./signal-summary";

export {
  pollSignals,
  defaultSignalPollOptions,
  type SignalPollState,
  type SignalPollOptions,
  type SignalPollResult,
} from "./signals-poll";

export type {
  Job,
  JobCompany,
  JobLocation,
  JobCompensation,
  JobSkill,
  JobQualifications,
  JobQualificationGroup,
  JobFacet,
  SearchWarning,
  JobSearchResponse,
  JobFeedResponse,
  ExpiredJobIdsResponse,
  JobSearchParams,
  JobSearchFilters,
  JobSearchRequest,
  IncludeExclude,
  SearchSortValue,
  DescriptionFormatValue,
  JobFeedParams,
  ConnectorFiltersResponse,
  ConnectorFilterEnums,
  FilterOptionsResponse,
  LocationSuggestion,
  SuggestLocationsResponse,
  CompanySuggestion,
  SuggestCompaniesResponse,
  OccupationItem,
  OccupationSubcategory,
  OccupationCategory,
  OccupationTaxonomyResponse,
  HiringSignal,
  HiringSignalCompany,
  HiringSignalFocus,
  HiringSignalListResponse,
  HiringSignalFilters,
  CompanySignalFilters,
  HiringSignalPaging,
  UsageInfo,
  Result,
} from "./types";
