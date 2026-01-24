// Path: src/commands/ssh-ca/types.ts

/**
 * Type definitions for SSH CA commands
 */

export interface SSHCAStatus {
  initialized: boolean;
  publicKey?: string;
  fingerprint?: string;
  keyType?: string;
  defaultTtlSeconds?: number;
  maxTtlSeconds?: number;
  allowedExtensions?: string[];
  totalCertificatesIssued?: number;
  activeCertificates?: number;
}

export interface SSHCA {
  id: string;
  publicKey: string;
  fingerprint: string;
  keyType: string;
  defaultTtlSeconds: number;
  maxTtlSeconds: number;
  allowedExtensions: string[];
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
  description?: string | null;
  createdAt: string;
  createdBy?: string;
}

export interface AccessRule {
  linuxUser: string;
  allowedPrincipals: string[];
}

export interface SSHCertificate {
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

export interface SignedCertificate {
  certificate: string;
  serial: string;
  principals: string[];
  validAfter: string;
  validBefore: string;
  fingerprint: string;
}

// Command option interfaces
export interface InitCAOptions {
  keyType?: string;
  defaultTtl?: string;
  maxTtl?: string;
  extensions?: string;
  json?: boolean;
}

export interface MappingCreateOptions {
  groupId?: string;
  principals?: string;
  json?: boolean;
}

export interface MappingUpdateOptions {
  principals?: string;
  json?: boolean;
}

export interface ServerGroupCreateOptions {
  name?: string;
  description?: string;
  json?: boolean;
}

export interface AccessRuleOptions {
  linuxUser?: string;
  principals?: string;
  json?: boolean;
}

export interface SignOptions {
  publicKey?: string;
  file?: string;
  ttl?: string;
  json?: boolean;
}

export interface CertListOptions {
  activeOnly?: boolean;
  revoked?: boolean;
  userId?: string;
  limit?: string;
  json?: boolean;
}

export interface RevokeOptions {
  reason?: string;
  force?: boolean;
  json?: boolean;
}

// API response types
export interface MappingsListResponse {
  items: PrincipalMapping[];
}

export interface ServerGroupsListResponse {
  items: ServerGroup[];
}

export interface CertificatesListResponse {
  items: SSHCertificate[];
  pagination: {
    total: number;
    limit: number;
    offset: number;
    hasMore: boolean;
  };
}
