/** Wire contracts for Dynamic Secrets Recovery Fence v1. */

export type RecoveryPrivilegeOverlay = 'NONE' | 'MYSQL_SCHEMA_LOCK_TABLES';
export type RecoveryFenceState = 'OPEN' | 'CLOSING' | 'CLOSED';
export type MintPermitState = 'READY' | 'CONSUMED';
export type MintOperationState =
  | 'READY'
  | 'CLAIMED'
  | 'UNKNOWN'
  | 'CONSUMED'
  | 'DELIVERED'
  | 'REVOKING'
  | 'REVOKED'
  | 'CANCELLED_NO_TARGET'
  | 'FAILED_NO_TARGET'
  | 'EXPIRED_REVOKED'
  | 'RECOVERY_REQUIRED';

export interface RecoveryFence {
  fenceId: string;
  runId: string;
  fenceEpoch: number;
  closeEpoch: number | null;
  state: RecoveryFenceState;
  roleEnabled: false;
  roleRevision: number;
  roleConfigSha256: string;
  grantPlanSha256: string;
  inFlightMints: number;
  activeLeases: number;
  recoveryRequired: number;
  nonterminalOperations: number;
  readyPermits: number;
  expiresAt: string;
  closedAt: string | null;
}

export interface MintPermit {
  permitId: string;
  fenceId: string;
  fenceEpoch: number;
  state: MintPermitState;
  maxMints: 1;
  mintsConsumed: 0 | 1;
  roleRevision: number;
  roleConfigSha256: string;
  grantPlanSha256: string;
  effectiveGrantPlanSha256: string;
  consumerApiKeyId: string;
  phase: string;
  privilegeOverlay: RecoveryPrivilegeOverlay;
  credentialTtlSeconds: number;
  expiresAt: string;
}

export interface RecoveryHpkeEnvelope {
  version: 'hpke-v1';
  suite: 'X25519-HKDF-SHA256-ChaCha20Poly1305';
  enc: string;
  ciphertext: string;
  aadSha256: string;
}

export interface RecoveryHpkeCredential {
  permitId: string;
  requestId: string;
  state: 'CONSUMED' | 'DELIVERED';
  envelopeSha256: string;
  deliveryFormat: 'hpke-v1';
  envelope: RecoveryHpkeEnvelope;
  aad: string;
}

export interface MintOperation {
  operationId: string;
  tenantId: string;
  permitId: string;
  requestId: string;
  state: MintOperationState;
  fenceId: string;
  fenceEpoch: number;
  roleId: string;
  roleRevision: number;
  roleConfigSha256: string;
  grantPlanSha256: string;
  effectiveGrantPlanSha256: string;
  privilegeOverlay: RecoveryPrivilegeOverlay;
  consumerApiKeyId: string;
  leaseId: string | null;
  username: string | null;
  credentialExpiresAt: string | null;
  createdAt: string;
  claimedAt: string | null;
  consumedAt: string | null;
  deliveredAt: string | null;
  terminalAt: string | null;
  lastErrorCode: string | null;
  credential?: RecoveryHpkeCredential;
}

export interface PermitIssueOptions {
  fenceId: string;
  consumerApiKeyId: string;
  phase: string;
  expiresInSeconds: string;
  credentialTtlSeconds: string;
  /** Untrusted Commander string; validated before the request is sent. */
  privilegeOverlay: string;
  reason: string;
  idempotencyKey: string;
  json?: boolean;
}

export interface PermitStatusOptions {
  json?: boolean;
}

export interface PermitRevokeOptions {
  reason?: string;
  json?: boolean;
}

export interface RecoveryFenceOpenOptions {
  consumerApiKeyId: string;
  expectedRoleRevision: string;
  expectedRoleConfigSha256: string;
  expiresInSeconds: string;
  purpose: string;
  json?: boolean;
}

export interface RecoveryFenceStatusOptions {
  json?: boolean;
}

export interface RecoveryFenceCloseOptions {
  expectedFenceEpoch: string;
  json?: boolean;
}
