// Path: src/lib/client/types.ts

/**
 * Internal types for HTTP client module
 */

export interface RequestOptions {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  path: string;
  body?: unknown;
  query?: Record<string, string | number | boolean | undefined>;
  skipAuth?: boolean;
  /**
   * Additional application headers for endpoints with a header-level
   * contract (currently Recovery Fence v1's Idempotency-Key). Authentication
   * and transport headers are protected and cannot be overridden here.
   */
  headers?: Readonly<Record<string, string>>;
  // Internal: set by the http client when retrying once after a 401
  // refresh. Prevents infinite recursion when the refresh succeeds
  // but the next request still 401s (which would mean the refresh
  // token itself is rejected — surface that to the user as a hard
  // re-login).
  _retriedAfter401Refresh?: boolean;
}

export interface MessageResponse {
  message: string;
}

export interface PermissionItem {
  permission: string;
  description: string;
  category: string;
}

export interface PermissionsResponse {
  permissions: PermissionItem[];
  categories: string[];
  total: number;
}

export interface ValidatePermissionsResponse {
  valid: string[];
  invalid: string[];
  allValid: boolean;
}

export interface ValidatePolicyResponse {
  valid: boolean;
  errors?: string[];
}

export interface PolicyAttachmentsResponse {
  users: Array<import('../../types/index.js').PolicyAttachment>;
  roles: Array<import('../../types/index.js').PolicyAttachment>;
}

/**
 * HTTP client configuration
 */
export interface ClientConfig {
  baseUrl: string;
  insecure: boolean;
  timeout: number;
}
