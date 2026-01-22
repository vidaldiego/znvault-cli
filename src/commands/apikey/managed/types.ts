// Path: src/commands/apikey/managed/types.ts

/**
 * Type definitions for managed API key commands
 */

export interface ManagedListOptions {
  tenant?: string;
  json?: boolean;
}

export interface ManagedCreateOptions {
  expires: string;
  permissions?: string;
  description?: string;
  rotationMode: string;
  rotationInterval?: string;
  gracePeriod: string;
  notifyBefore?: string;
  webhookUrl?: string;
  ip?: string;
  tenant?: string;
  json?: boolean;
}

export interface ManagedGetOptions {
  tenant?: string;
  json?: boolean;
}

export interface ManagedBindOptions {
  tenant?: string;
  json?: boolean;
}

export interface ManagedRotateOptions {
  tenant?: string;
}

export interface ManagedConfigOptions {
  rotationInterval?: string;
  gracePeriod?: string;
  notifyBefore?: string;
  webhookUrl?: string;
  tenant?: string;
  json?: boolean;
}

export interface ManagedDeleteOptions {
  tenant?: string;
  force?: boolean;
}

export interface ManagedPermissionsOptions {
  set?: string;
  add?: string;
  remove?: string;
  tenant?: string;
  json?: boolean;
}

export interface ManagedConditionsOptions {
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
