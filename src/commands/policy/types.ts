// Path: src/commands/policy/types.ts

/**
 * Type definitions for policy commands
 */

export interface PolicyListOptions {
  tenant?: string;
  enabled?: boolean;
  disabled?: boolean;
  effect?: string;
  search?: string;
  json?: boolean;
}

export interface PolicyGetOptions {
  tenant?: string;
  json?: boolean;
}

export interface PolicyCreateOptions {
  name: string;
  effect: string;
  actions: string;
  description?: string;
  priority: string;
  tenant?: string;
  resources?: string;
  conditions?: string;
  fromFile?: string;
  json?: boolean;
}

export interface PolicyUpdateOptions {
  tenant?: string;
  name?: string;
  description?: string;
  effect?: string;
  actions?: string;
  priority?: string;
  resources?: string;
  conditions?: string;
  fromFile?: string;
  json?: boolean;
}

export interface PolicyDeleteOptions {
  tenant?: string;
  yes?: boolean;
  json?: boolean;
}

export interface PolicyToggleOptions {
  tenant?: string;
  json?: boolean;
}

export interface PolicyAttachOptions {
  tenant?: string;
  json?: boolean;
}

export interface PolicyValidateOptions {
  name: string;
  effect: string;
  actions: string;
  description?: string;
  priority: string;
  resources?: string;
  conditions?: string;
  fromFile?: string;
}

export interface PolicyAttachmentsOptions {
  tenant?: string;
  json?: boolean;
}

export interface PolicyUserPoliciesOptions {
  json?: boolean;
}

export interface PolicyRolePoliciesOptions {
  json?: boolean;
}

export interface PolicyTestOptions {
  user: string;
  action: string;
  resourceType?: string;
  resourceId?: string;
  resourceTenant?: string;
  ip?: string;
  mfa?: boolean;
  json?: boolean;
}

export interface PolicyExportOptions {
  output?: string;
}

export interface PolicyImportOptions {
  tenant?: string;
  json?: boolean;
}
