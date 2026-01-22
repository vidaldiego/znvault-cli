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
