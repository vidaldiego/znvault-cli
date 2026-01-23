// Path: src/commands/secret/types.ts

/**
 * Type definitions for secret commands
 */

// ============================================================================
// Core Types
// ============================================================================

export interface SecretMetadata {
  id: string;
  alias: string;
  tenant: string;
  type: 'opaque' | 'credential' | 'setting';
  subType?: string;
  version: number;
  fileName?: string;
  fileSize?: number;
  fileMime?: string;
  expiresAt?: string;
  ttlUntil?: string;
  tags?: string[];
  contentType?: string;
  createdBy?: string;
  createdAt: string;
  updatedAt: string;
}

export interface DecryptedSecret extends SecretMetadata {
  data: Record<string, unknown>;
  content_type?: string;
}

// ============================================================================
// Option Interfaces
// ============================================================================

export interface ListOptions {
  tenant?: string;
  type?: string;
  subType?: string;
  aliasPrefix?: string;
  expiring?: string;
  json?: boolean;
}

export interface GetOptions {
  json?: boolean;
}

export interface DecryptOptions {
  output?: string;
  json?: boolean;
}

export interface CreateOptions {
  tenant?: string;
  type: string;
  subType?: string;
  tags?: string;
  ttl?: string;
  expires?: string;
  contentType?: string;
  json?: boolean;
  suggest?: boolean;
  // Non-interactive data options
  username?: string;
  password?: string;
  text?: string;
  data?: string;
  file?: string;
}

export interface SuggestResult {
  alias: string;
  alternativeAliases?: string[];
  type: string;
  subType?: string;
  tags: string[];
  expiresInDays?: number;
  rotationRecommendation?: string;
  warnings?: string[];
  confidence: number;
  reasoning: string;
}

export interface UpdateOptions {
  tags?: string;
  ttl?: string;
  expires?: string;
  json?: boolean;
  // Non-interactive data option
  data?: string;
}

export interface DeleteOptions {
  force?: boolean;
}

export interface RotateOptions {
  json?: boolean;
}

export interface HistoryOptions {
  json?: boolean;
}

export interface CopyOptions {
  noMetadata?: boolean;
  json?: boolean;
}

// ============================================================================
// Response Types
// ============================================================================

export interface SecretsListResponse {
  items: SecretMetadata[];
  pagination: { total: number; limit: number; offset: number; hasMore: boolean };
}

export interface HistoryEntry {
  version: number;
  // Server returns camelCase, but we handle both for robustness
  createdAt?: string;
  created_at?: string;
  createdBy?: string;
  created_by?: string;
  createdByUsername?: string;
  created_by_username?: string;
  supersededAt?: string;
  superseded_at?: string;
  supersededBy?: string;
  superseded_by?: string;
  supersededByUsername?: string;
  superseded_by_username?: string;
}

export interface HistoryResponse {
  items: HistoryEntry[];
  pagination: {
    total: number;
    limit: number;
    offset: number;
    hasMore: boolean;
  };
}

export interface CopyResponse {
  id: string;
  alias: string;
  tenant: string;
  type: string;
  subType?: string;
  version: number;
  copiedFrom: {
    id: string;
    alias: string;
    tenant: string;
    version: number;
  };
  createdAt: string;
}
