// Path: src/commands/ssh/types.ts

/**
 * SSH CA command types and interfaces
 */

// ============================================================================
// API Response Types
// ============================================================================

export interface CAStatus {
  initialized: boolean;
  publicKey?: string;
  fingerprint?: string;
  keyType?: string;
  defaultTtlSeconds?: number;
  maxTtlSeconds?: number;
  allowedExtensions?: string[];
  totalCertificates?: number;
  activeCertificates?: number;
  createdAt?: string;
}

export interface CA {
  id: string;
  publicKey: string;
  fingerprint: string;
  keyType: string;
  defaultTtlSeconds: number;
  maxTtlSeconds: number;
  allowedExtensions: string[];
  createdAt: string;
}

export interface Certificate {
  id: string;
  serial: string;
  userId: string;
  username?: string;
  fingerprint: string;
  principals: string[];
  extensions?: string[];
  validAfter: string;
  validBefore: string;
  revoked: boolean;
  revokedAt?: string;
  revokedBy?: string;
  revocationReason?: string;
  requestIp?: string;
  createdAt: string;
}

export interface PrincipalMapping {
  id: string;
  groupId: string;
  groupName?: string;
  groupDisplayName?: string;
  principals: string[];
  createdAt: string;
  createdBy?: string;
}

export interface ServerGroup {
  id: string;
  name: string;
  description?: string;
  accessRules?: Array<{
    linuxUser: string;
    allowedPrincipals: string[];
  }>;
  createdAt: string;
  createdBy?: string;
}

export interface SignResult {
  certificate: string;
  serial: string;
  principals: string[];
  validAfter: string;
  validBefore: string;
  fingerprint: string;
}

// ============================================================================
// Command Option Types
// ============================================================================

export interface ListOptions {
  tenant?: string;
  json?: boolean;
}

export interface CertListOptions extends ListOptions {
  limit?: string;
  offset?: string;
  activeOnly?: boolean;
  revoked?: boolean;
  userId?: string;
}

export interface InitOptions {
  tenant?: string;
  keyType?: string;
  defaultTtl?: string;
  maxTtl?: string;
  extension?: string[];
  json?: boolean;
}

export interface SignOptions {
  tenant?: string;
  ttl?: string;
  output?: string;
  json?: boolean;
}

export interface CreateMappingOptions {
  tenant?: string;
  json?: boolean;
}

export interface CreateServerGroupOptions {
  tenant?: string;
  description?: string;
  json?: boolean;
}

export interface SetAccessOptions {
  tenant?: string;
  json?: boolean;
}

export interface DeleteOptions {
  tenant?: string;
  yes?: boolean;
}

export interface GetOptions {
  tenant?: string;
  json?: boolean;
}

export interface ConnectOptions {
  identity?: string;
  port?: string;
  principals?: string;
  ttl?: string;
  tenant?: string;
  forceSign?: boolean;
  dryRun?: boolean;
  verbose?: boolean;
  t?: boolean;
  T?: boolean;
}

// ============================================================================
// Bookmark Types
// ============================================================================

export interface SSHBookmark {
  name: string;
  host: string;
  port?: number;
  user?: string;
  identity?: string;
  principals?: string[];
  description?: string;
  createdAt: string;
}

// ============================================================================
// Local Certificate Status
// ============================================================================

export interface LocalCertInfo {
  exists: boolean;
  path: string;
  valid?: boolean;
  principals?: string[];
  validAfter?: Date;
  validBefore?: Date;
  fingerprint?: string;
  keyId?: string;
  remainingTime?: string;
}
