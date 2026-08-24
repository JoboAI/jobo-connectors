/**
 * @jobo-ai/connector-core
 *
 * Shared client behind every Jobo marketplace connector (n8n, Zapier, Pipedream,
 * Google Sheets, WordPress). Zero runtime dependencies and an injectable
 * transport, because the host sandboxes disagree: n8n's verified-node scanner
 * rejects a non-empty `dependencies`, Make has no JS runtime, and Apps Script
 * has no npm. Consume this as a devDependency and bundle it.
 */

export {
  JoboClient,
  DEFAULT_BASE_URL,
  isValidApiKeyFormat,
  assertValidApiKeyFormat,
  type JoboClientOptions,
} from "./client";

export {
  JoboError,
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
  assertHasNarrowingFilter,
  type FilterDescriptor,
  type FilterKind,
  type WorkModel,
  type EmploymentType,
  type ExperienceLevel,
} from "./filters";

export type {
  Job,
  JobCompany,
  JobLocation,
  JobCompensation,
  JobSkill,
  JobQualifications,
  JobQualificationGroup,
  JobFacet,
  JobSearchResponse,
  JobFeedResponse,
  ExpiredJobIdsResponse,
  JobSearchParams,
  JobFeedParams,
  ConnectorFiltersResponse,
  ConnectorFilterEnums,
  FilterOptionsResponse,
  LocationSuggestion,
  SuggestLocationsResponse,
  UsageInfo,
  Result,
} from "./types";
