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
  references?: { count: number };
}

export interface DecryptedSecret extends SecretMetadata {
  data: Record<string, unknown>;
  content_type?: string;
  resolvedFrom?: { alias: string; field?: string };
  resolved?: { count: number };
}

// ============================================================================
// Option Interfaces
// ============================================================================

export interface ListOptions {
  // `tenant` removed in v3.0.0 — see secret/list.ts.
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
  resolve?: boolean;
}

export interface CreateOptions {
  // `tenant` removed in v3.0.0 — secret creation is always against the
  // caller's own tenant (derived from JWT). See secret/create.ts.
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
  enableReferences?: boolean;
  link?: string;
  linkField?: string;
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
  enableReferences?: boolean;
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
