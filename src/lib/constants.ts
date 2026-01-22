// Path: src/lib/constants.ts

/**
 * CLI configuration constants
 * Extracted magic numbers for maintainability and consistency
 */

// ============================================================================
// Timeouts and Intervals
// ============================================================================

/** Default HTTP request timeout in milliseconds */
export const DEFAULT_TIMEOUT_MS = 30000;

/** Token refresh buffer - refresh token this many ms before expiry */
export const TOKEN_REFRESH_BUFFER_MS = 60000;

/** Update check interval in milliseconds (24 hours) */
export const UPDATE_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;

/** Spinner timeout for long operations */
export const SPINNER_TIMEOUT_MS = 120000;

/** Redis CLI ping timeout in milliseconds */
export const REDIS_PING_TIMEOUT_MS = 5000;

/** Redis Sentinel command timeout in milliseconds */
export const REDIS_SENTINEL_TIMEOUT_MS = 3000;

/** Config cache TTL in milliseconds */
export const CONFIG_CACHE_TTL_MS = 5000;

// ============================================================================
// Pagination
// ============================================================================

/** Default page size for list operations */
export const DEFAULT_PAGE_SIZE = 100;

/** Maximum page size for list operations */
export const MAX_PAGE_SIZE = 1000;

// ============================================================================
// API Key and Token Settings
// ============================================================================

/** Default API key expiry in days */
export const DEFAULT_EXPIRY_DAYS = 90;

/** Maximum API key expiry in days (10 years) */
export const MAX_EXPIRY_DAYS = 3650;

/** Minimum password length */
export const MIN_PASSWORD_LENGTH = 12;

// ============================================================================
// File System
// ============================================================================

/** Maximum directory search depth for binary search */
export const MAX_DIRECTORY_DEPTH = 5;

/** Maximum file size to read (10MB) */
export const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024;

// ============================================================================
// Display Settings
// ============================================================================

/** Default number of items to display in lists */
export const DEFAULT_DISPLAY_LIMIT = 50;

/** Maximum string truncation length for table cells */
export const MAX_CELL_LENGTH = 50;

/** Maximum number of items in a formatted list summary */
export const MAX_LIST_ITEMS = 5;

// ============================================================================
// Time Constants (in seconds)
// ============================================================================

export const SECONDS = {
  MINUTE: 60,
  HOUR: 60 * 60,
  DAY: 24 * 60 * 60,
  WEEK: 7 * 24 * 60 * 60,
} as const;

// ============================================================================
// HTTP Status Codes
// ============================================================================

export const HTTP_STATUS = {
  OK: 200,
  CREATED: 201,
  NO_CONTENT: 204,
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  INTERNAL_ERROR: 500,
  SERVICE_UNAVAILABLE: 503,
} as const;

// ============================================================================
// Exit Codes
// ============================================================================

export const EXIT_CODE = {
  SUCCESS: 0,
  ERROR: 1,
  INVALID_ARGS: 2,
  AUTH_REQUIRED: 3,
  PERMISSION_DENIED: 4,
  NOT_FOUND: 5,
} as const;
