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
  json?: boolean;
}

export interface DeleteOptions {
  days?: string;
  force?: boolean;
  json?: boolean;
}

export interface EnableDisableOptions {
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
