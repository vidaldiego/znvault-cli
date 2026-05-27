// Path: src/commands/kms/types.ts

/**
 * KMS command types and interfaces
 */

// ============================================================================
// API Response Types
// ============================================================================

export interface KMSKey {
  keyId: string;
  alias?: string;
  arn?: string;
  keyState: string;
  keyUsage: string;
  keySpec: string;
  description?: string;
  tenant?: string;
  createdDate: string;
  deletionDate?: string;
  currentVersionId?: string;
  rotationEnabled?: boolean;
  tags?: Record<string, string>;
}

export interface KMSKeyItem {
  keyId: string;
  alias?: string;
  keyState: string;
  createdDate: string;
}

export interface ListKeysResponse {
  items: KMSKeyItem[];
  pagination: {
    total: number;
    limit: number;
    offset: number;
    hasMore: boolean;
  };
}

export interface EncryptResponse {
  keyId: string;
  ciphertext: string;
  encryptionContext: Record<string, string>;
}

export interface DecryptResponse {
  keyId: string;
  plaintext: string;
  encryptionContext: Record<string, string>;
}

export interface GenerateDataKeyResponse {
  keyId: string;
  plaintext?: string;
  ciphertext: string;
}

export interface KeyVersion {
  versionId: string;
  createdAt: string;
  isCurrentVersion: boolean;
}

// ============================================================================
// Command Option Types
// ============================================================================

export interface ListOptions {
  tenant?: string;
  state?: string;
  json?: boolean;
}

export interface GetOptions {
  tenant?: string;
  json?: boolean;
}

export interface CreateOptions {
  tenant?: string;
  alias?: string;
  description?: string;
  usage?: string;
  spec?: string;
  tags?: string;
  json?: boolean;
}

export interface EncryptOptions {
  context?: string;
  file?: string;
  output?: string;
  json?: boolean;
}

export interface DecryptOptions {
  context?: string;
  output?: string;
  json?: boolean;
}

export interface RotateOptions {
  tenant?: string;
  json?: boolean;
}

export interface DeleteOptions {
  tenant?: string;
  days?: string;
  force?: boolean;
  json?: boolean;
}

export interface EnableDisableOptions {
  tenant?: string;
  json?: boolean;
}

export interface GenerateDataKeyOptions {
  spec?: string;
  context?: string;
  output?: string;
  json?: boolean;
}

export interface VersionsOptions {
  json?: boolean;
}

// ============================================================================
// KMS Per-Key Policy & Grant Types
// ============================================================================
//
// These are the *per-key* authorization layer (kms_key_policies /
// kms_key_grants), distinct from the API-key RBAC permissions surfaced by
// `znvault api-key permissions`. A caller must clear BOTH layers to use a
// key: RBAC permits calling the KMS endpoint at all, and the per-key
// policy/grant on the target key permits this specific principal+action.
// See docs/compliance/2026-05-25/ for the auth-model summary.

export interface KMSKeyPolicy {
  sid: string;
  effect: 'ALLOW' | 'DENY';
  principal: string;
  actions: string[];
  condition?: unknown;
  priority: number;
}

export interface ListPoliciesResponse {
  policies: KMSKeyPolicy[];
}

export interface KMSKeyGrant {
  grantId: string;
  granteePrincipal: string;
  operations: string[];
  constraints?: unknown;
  name?: string;
  createdAt: string;
  createdBy: string;
  expiresAt?: string;
}

export interface ListGrantsResponse {
  grants: KMSKeyGrant[];
}

export interface CreateGrantResponse {
  grantId: string;
  grantToken: string;
}

export interface PolicyPutOptions {
  tenant?: string;
  sid: string;
  effect?: 'ALLOW' | 'DENY';
  principal: string;
  // One or more KMS actions, comma-separated, e.g. "kms:Decrypt" or
  // "kms:Encrypt,kms:Decrypt". Whitespace around commas is tolerated.
  actions: string;
  priority?: string;
  json?: boolean;
}

export interface PolicyListOptions {
  tenant?: string;
  json?: boolean;
}

export interface PolicyDeleteOptions {
  tenant?: string;
  sid: string;
  json?: boolean;
}

export interface GrantCreateOptions {
  tenant?: string;
  grantee: string;
  operations: string; // comma-separated, e.g. "kms:Decrypt,kms:Encrypt"
  name?: string;
  retiringPrincipal?: string;
  expiresAt?: string;
  json?: boolean;
}

export interface GrantListOptions {
  tenant?: string;
  json?: boolean;
}

export interface GrantRetireRevokeOptions {
  tenant?: string;
  json?: boolean;
}
