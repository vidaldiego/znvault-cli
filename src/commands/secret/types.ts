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
  /** Server-derived: the secret is opted-in to reference resolution. Additive on /meta (undefined on old servers). */
  referencesEnabled?: boolean;
  /** Server-derived: the secret currently carries ${ref:...} tokens or is a link. Additive on /meta (undefined on old servers). */
  hasReferences?: boolean;
  protectionMode?: 'STANDARD' | 'USER_SESSION_ONLY';
  grantCount?: number;
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
  /** Print only the value (no metadata) — for `$(...)` / env-var injection and `> file`. */
  raw?: boolean;
  /** Print only this field of the data payload; implies `raw`. */
  field?: string;
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
  dataStdin?: boolean;
  file?: string;
  enableReferences?: boolean;
  link?: string;
  linkField?: string;
  protection?: 'standard' | 'user-session';
  grantUser?: string[];
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
  dataStdin?: boolean;
  enableReferences?: boolean;
}

export interface DeleteOptions {
  force?: boolean;
}

export interface RotateOptions {
  json?: boolean;
  dataStdin?: boolean;
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

// ============================================================================
// Can-Decrypt Preflight Types (SPEC B4/B6)
// ============================================================================

export interface CanDecryptOptions {
  asApiKey?: string;
  asUser?: string;
  json?: boolean;
}

export type CanDecryptNodeVerdict = 'allowed' | 'denied' | 'conditional' | 'indeterminate';

export interface CanDecryptTarget {
  alias: string | null;
  verdict: CanDecryptNodeVerdict;
  conditionalOn?: string[];
  reason?: string;
}

export interface CanDecryptVerdict {
  verdict: CanDecryptNodeVerdict;
  simulatedIdentity: { kind: 'apikey' | 'user' | 'self'; id: string | null };
  secret: { id: string; alias: string; subType?: string; hasReferences?: boolean };
  self: {
    verdict: 'allowed' | 'denied' | 'conditional';
    conditionalOn?: string[];
    reason?: string;
  };
  targets: CanDecryptTarget[];
  firstDenial: { alias: string | null; reason: string } | null;
}
