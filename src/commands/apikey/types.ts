// Path: src/commands/apikey/types.ts

/**
 * Type definitions for API key commands
 */

// ============================================================================
// Option Interfaces
// ============================================================================

export interface ListOptions {
  tenant?: string;
  json?: boolean;
}

export interface CreateOptions {
  expires: string;
  permissions?: string;
  description?: string;
  ip?: string;
  timeRange?: string;
  methods?: string;
  resources?: string;
  aliases?: string;
  tags?: string;
  tenant?: string;
  json?: boolean;
}

export interface ShowOptions {
  tenant?: string;
  json?: boolean;
}

export interface DeleteOptions {
  tenant?: string;
  force?: boolean;
}

export interface RotateOptions {
  name?: string;
  tenant?: string;
  json?: boolean;
}

export interface EnableDisableOptions {
  tenant?: string;
}

export interface UpdatePermissionsOptions {
  set?: string;
  add?: string;
  remove?: string;
  tenant?: string;
  json?: boolean;
}

export interface UpdateConditionsOptions {
  ip?: string;
  timeRange?: string;
  methods?: string;
  resources?: string;
  aliases?: string;
  tags?: string;
  clearAll?: boolean;
  tenant?: string;
  json?: boolean;
}

export interface ListPoliciesOptions {
  tenant?: string;
  json?: boolean;
}

export interface AttachDetachPolicyOptions {
  tenant?: string;
}

export interface SelfOptions {
  json?: boolean;
}

export interface SelfRotateOptions {
  name?: string;
  json?: boolean;
}

// ============================================================================
// Condition Type Definitions
// ============================================================================

export interface TimeRangeCondition {
  start: string;
  end: string;
  timezone?: string;
}

export interface ApiKeyConditions {
  ip?: string[];
  timeRange?: TimeRangeCondition;
  methods?: string[];
  resources?: Record<string, string[]>;
  aliases?: string[];
  resourceTags?: Record<string, string>;
  [key: string]: unknown;
}
