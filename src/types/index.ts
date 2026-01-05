// Configuration types
export interface CLIConfig {
  url: string;
  insecure: boolean;
  timeout: number;
  defaultTenant?: string;
}

export interface StoredCredentials {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  userId: string;
  username: string;
  role: string;
  tenantId: string | null;
}

export interface FullConfig extends CLIConfig {
  credentials?: StoredCredentials;
}

// API Response types
export interface HealthResponse {
  status: 'ok' | 'degraded' | 'error';
  version: string;
  uptime: number;
  timestamp: string;
  database?: { status: string };
  redis?: { status: string };
  ha?: {
    enabled: boolean;
    nodeId: string;
    isLeader: boolean;
    clusterSize: number;
  };
}

export interface ClusterNode {
  nodeId: string;
  host: string;
  port: number;
  isLeader: boolean;
  isHealthy: boolean;
  lastHeartbeat: string;
  version?: string;
  uptime?: number;
}

export interface ClusterStatus {
  enabled: boolean;
  nodeId: string;
  isLeader: boolean;
  leaderNodeId: string | null;
  nodes: ClusterNode[];
  infrastructure?: {
    postgres?: { status: string; primary?: string };
    redis?: { status: string; master?: string };
    etcd?: { status: string };
  };
}

export interface Tenant {
  id: string;
  name: string;
  status: 'active' | 'suspended' | 'archived';
  maxSecrets?: number;
  maxKmsKeys?: number;
  maxStorageMb?: number;
  planTier?: string;
  contactEmail?: string;
  contactName?: string;
  createdAt: string;
  updatedAt: string;
}

export interface TenantUsage {
  secretsCount: number;
  kmsKeysCount: number;
  storageUsedMb: number;
  usersCount: number;
  apiKeysCount: number;
}

export interface TenantWithUsage extends Tenant {
  usage?: TenantUsage;
}

export interface User {
  id: string;
  username: string;
  email?: string;
  role: 'user' | 'admin' | 'superadmin';
  tenantId?: string;
  status: 'active' | 'disabled' | 'locked';
  totpEnabled: boolean;
  failedAttempts: number;
  lockedUntil?: string;
  lastLogin?: string;
  createdAt: string;
  updatedAt: string;
}

export interface Superadmin {
  id: string;
  username: string;
  email?: string;
  status: 'active' | 'disabled' | 'locked';
  totpEnabled: boolean;
  failedAttempts: number;
  lockedUntil?: string;
  lastLogin?: string;
  createdAt: string;
}

export interface LockdownStatus {
  scope: 'SYSTEM' | 'TENANT';
  tenantId?: string;
  status: 'NORMAL' | 'ALERT' | 'RESTRICT' | 'LOCKDOWN' | 'PANIC';
  reason?: string;
  triggeredAt?: string;
  triggeredBy?: string;
  escalationCount: number;
  metrics?: {
    authFailures: number;
    apiAbuse: number;
    permissionViolations: number;
  };
}

export interface ThreatEvent {
  id: string;
  ts: string;
  tenantId?: string;
  userId?: string;
  ip: string;
  userAgent?: string;
  category: string;
  signal: string;
  suggestedLevel: number;
  endpoint: string;
  method: string;
  statusCode: number;
  escalated: boolean;
}

export interface LockdownHistoryEntry {
  id: string;
  previousStatus: string;
  newStatus: string;
  transitionReason: string;
  changedByUserId?: string;
  changedBySystem: boolean;
  ts: string;
}

export interface AuditEntry {
  id: number;
  ts: string;
  clientCn: string;
  action: string;
  resource: string;
  statusCode: number;
  tenantId?: string;
  ip?: string;
  requestBody?: string;
  responseBody?: string;
}

export interface AuditVerifyResult {
  valid: boolean;
  totalEntries: number;
  verifiedEntries: number;
  firstBrokenEntry?: number;
  message: string;
}

export interface LoginResponse {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  user: {
    id: string;
    username: string;
    role: string;
    tenantId: string | null;
  };
}

export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page?: number;
  pageSize?: number;
}

export interface ApiError {
  error: string;
  message: string;
  statusCode: number;
}

// Command options types
export interface GlobalOptions {
  url?: string;
  insecure?: boolean;
  json?: boolean;
  quiet?: boolean;
}

export interface TenantListOptions extends GlobalOptions {
  status?: 'active' | 'suspended' | 'archived';
  withUsage?: boolean;
}

export interface UserListOptions extends GlobalOptions {
  tenant?: string;
  role?: 'user' | 'admin' | 'superadmin';
  status?: 'active' | 'disabled' | 'locked';
}

export interface AuditListOptions extends GlobalOptions {
  user?: string;
  action?: string;
  days?: number;
  limit?: number;
}

export interface ThreatListOptions extends GlobalOptions {
  category?: string;
  since?: string;
  limit?: number;
}

// Output format type
export type OutputFormat = 'table' | 'json' | 'yaml';

// Certificate types
export interface CertificateMetadata {
  id: string;
  tenantId: string;
  clientId: string;
  kind: string;
  alias: string;
  certificateType: 'PEM' | 'P12' | 'DER';
  purpose: 'SIGNING' | 'AUTHENTICATION' | 'ENCRYPTION';
  fingerprintSha256: string;
  subjectCn: string;
  issuerCn: string;
  notBefore: string;
  notAfter: string;
  clientName: string;
  organizationId?: string;
  contactEmail?: string;
  status: 'ACTIVE' | 'EXPIRING_SOON' | 'EXPIRED' | 'REVOKED' | 'SUSPENDED';
  version: number;
  createdAt: string;
  createdBy: string;
  updatedAt: string;
  lastAccessedAt?: string;
  accessCount: number;
  tags: string[];
  daysUntilExpiry: number;
  isExpired: boolean;
  hasPrivateKey: boolean;  // Whether the certificate bundle includes a private key
}

export interface CertificateListResponse {
  items: CertificateMetadata[];
  total: number;
  page: number;
  pageSize: number;
}

export interface CertificateStats {
  total: number;
  byStatus: Record<string, number>;
  byKind: Record<string, number>;
  expiringIn30Days: number;
  expiringIn7Days: number;
}

export interface DecryptedCertificate {
  id: string;
  alias: string;
  certificateData: string;
  privateKeyData?: string;
  chainData?: string;
  certificateType: 'PEM' | 'P12' | 'DER';
  fingerprint: string;
  fingerprintSha256: string;
  version: number;
}

// API Key types - Independent, tenant-scoped with direct permissions

export interface APIKey {
  id: string;
  tenant_id: string;
  created_by: string | null;
  name: string;
  description: string | null;
  prefix: string;
  expires_at: string;
  last_used: string | null;
  created_at: string;
  ip_allowlist: string[] | null;
  permissions: string[];
  conditions?: Record<string, unknown>;
  // Username of creator (for display)
  created_by_username?: string;
  // Enable/disable status
  enabled: boolean;
  // Rotation tracking
  rotation_count: number;
  last_rotation: string | null;
}

export interface CreateAPIKeyRequest {
  name: string;
  description?: string;
  expiresInDays?: number;
  permissions: string[];
  tenantId?: string;
  ipAllowlist?: string[];
}

export interface CreateAPIKeyResponse {
  key: string;
  apiKey: APIKey;
  message: string;
}

export interface ListAPIKeysResponse {
  keys: APIKey[];
  expiringSoon: APIKey[];
}

export interface RotateAPIKeyResponse {
  key: string;
  apiKey: APIKey;
  message: string;
}

export interface APIKeySelfResponse {
  apiKey: APIKey;
  expiresInDays: number;
  isExpiringSoon: boolean;
}

export interface APIKeyPolicyAttachment {
  policyId: string;
  policyName: string;
  apiKeyId: string;
  attachedAt: string;
}

// ABAC Policy types
export type PolicyEffect = 'allow' | 'deny';

export interface PolicyCondition {
  type: 'ip' | 'ipAddress' | 'mfaVerified' | 'timeRange' | 'tags' | 'resourceTags' | 'userAttributes';
  operator?: 'in' | 'not_in' | 'equals' | 'contains';
  value: unknown;
}

export interface PolicyResource {
  type: 'secret' | 'certificate' | 'kms_key' | 'user' | 'role' | 'tenant' | 'policy' | 'api_key';
  id?: string;
  tenantId?: string;
  tags?: Record<string, string>;
}

export interface Policy {
  id: string;
  name: string;
  description?: string;
  effect: PolicyEffect;
  actions: string[];
  resources?: PolicyResource[];
  conditions?: PolicyCondition[];
  priority: number;
  isActive: boolean;
  tenantId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface PolicyAttachment {
  policyId: string;
  policyName: string;
  userId?: string;
  roleId?: string;
  username?: string;
  roleName?: string;
  attachedAt: string;
}

export interface CreatePolicyInput {
  name: string;
  description?: string;
  effect: PolicyEffect;
  actions: string[];
  resources?: PolicyResource[];
  conditions?: PolicyCondition[];
  priority?: number;
  tenantId?: string;
}

export interface UpdatePolicyInput {
  name?: string;
  description?: string;
  effect?: PolicyEffect;
  actions?: string[];
  resources?: PolicyResource[];
  conditions?: PolicyCondition[];
  priority?: number;
}

export interface PolicyTestRequest {
  userId: string;
  action: string;
  resource?: {
    type: string;
    id?: string;
    tenantId?: string;
  };
  requestContext?: {
    ip?: string;
    mfaVerified?: boolean;
  };
}

export interface PolicyTestResult {
  allowed: boolean;
  effect: 'allow' | 'deny' | 'no_match';
  reason: string;
  matchedPolicies: Array<{
    id: string;
    name: string;
    effect: PolicyEffect;
    priority: number;
  }>;
  evaluatedPolicies: number;
  evaluationTimeMs: number;
}

export interface PolicyListResponse {
  data: Policy[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

// Managed API Key types
export type RotationMode = 'scheduled' | 'on-use' | 'on-bind';

export interface ManagedKeyConfig {
  rotationMode: RotationMode;
  rotationInterval?: string;
  gracePeriod: string;
  notifyBefore?: string;
  webhookUrl?: string;
}

export interface ManagedAPIKey {
  id: string;
  tenant_id: string;
  created_by: string | null;
  name: string;
  description: string | null;
  prefix: string;
  expires_at: string;
  last_used: string | null;
  created_at: string;
  ip_allowlist: string[] | null;
  permissions: string[];
  conditions?: Record<string, unknown>;
  created_by_username?: string;
  enabled: boolean;
  rotation_count: number;
  last_rotation: string | null;
  // Managed key specific fields
  is_managed: boolean;
  rotation_mode: RotationMode;
  rotation_interval?: string;
  grace_period: string;
  notify_before?: string;
  webhook_url?: string;
  next_rotation_at?: string;
  last_bound_at?: string;
  grace_key_expires_at?: string;
}

export interface ManagedKeyBindResponse {
  id: string;
  key: string;
  prefix: string;
  name: string;
  expiresAt: string;
  gracePeriod: string;
  graceExpiresAt?: string;
  rotationMode: RotationMode;
  permissions: string[];
  nextRotationAt?: string;
  _notice?: string;
}

export interface ManagedKeyListResponse {
  keys: ManagedAPIKey[];
  total: number;
}

export interface CreateManagedKeyRequest {
  name: string;
  description?: string;
  expiresInDays?: number;
  permissions: string[];
  tenantId?: string;
  ipAllowlist?: string[];
  conditions?: Record<string, unknown>;
  managed: ManagedKeyConfig;
}

export interface CreateManagedKeyResponse {
  apiKey: ManagedAPIKey;
  message: string;
}

export interface UpdateManagedKeyConfigRequest {
  rotationInterval?: string;
  gracePeriod?: string;
  notifyBefore?: string;
  webhookUrl?: string;
}
