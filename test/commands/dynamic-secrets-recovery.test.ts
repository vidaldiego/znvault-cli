import {beforeEach, describe, expect, it, vi} from 'vitest';
import type {Mock} from 'vitest';
import type {
  MintOperation,
  MintPermit,
  RecoveryFence,
} from '../../src/commands/dynamic-secrets/recovery-types.js';

const mockRequest: Mock = vi.fn();
const mockGet: Mock = vi.fn();
const mockPut: Mock = vi.fn();
vi.mock('../../src/lib/client.js', () => ({
  client: {request: mockRequest, get: mockGet, put: mockPut},
}));

const spinner = {start: vi.fn(), stop: vi.fn(), succeed: vi.fn(), fail: vi.fn()};
spinner.start.mockReturnValue(spinner);
const mockJson: Mock = vi.fn();
const mockKeyValue: Mock = vi.fn();
vi.mock('../../src/lib/output.js', () => ({
  spinner: vi.fn(() => spinner),
  json: mockJson,
  keyValue: mockKeyValue,
  error: vi.fn(),
}));

const PERMIT: MintPermit = {
  permitId: 'dmp_0123456789abcdef',
  fenceId: 'drf_0123456789abcdef',
  fenceEpoch: 7,
  state: 'READY',
  maxMints: 1,
  mintsConsumed: 0,
  roleRevision: 42,
  roleConfigSha256: '1'.repeat(64),
  grantPlanSha256: '2'.repeat(64),
  effectiveGrantPlanSha256: '3'.repeat(64),
  consumerApiKeyId: 'api-key-packleader',
  phase: 'historical-reconcile',
  privilegeOverlay: 'MYSQL_SCHEMA_LOCK_TABLES',
  credentialTtlSeconds: 900,
  expiresAt: '2026-08-28T12:02:00.000Z',
};

const OPERATION: MintOperation = {
  operationId: 'dmo_0123456789abcdef',
  permitId: PERMIT.permitId,
  requestId: 'request-1',
  state: 'UNKNOWN',
  fenceId: PERMIT.fenceId,
  fenceEpoch: 7,
  roleId: 'role-1',
  roleRevision: 42,
  roleConfigSha256: PERMIT.roleConfigSha256,
  grantPlanSha256: PERMIT.grantPlanSha256,
  effectiveGrantPlanSha256: PERMIT.effectiveGrantPlanSha256,
  privilegeOverlay: PERMIT.privilegeOverlay,
  leaseId: 'lease-1',
  username: 'znr_user',
  credentialExpiresAt: '2026-08-28T12:15:00.000Z',
  createdAt: '2026-08-28T12:00:00.000Z',
  claimedAt: '2026-08-28T12:00:01.000Z',
  consumedAt: null,
  deliveredAt: null,
  terminalAt: null,
  lastErrorCode: null,
};

const FENCE: RecoveryFence = {
  fenceId: PERMIT.fenceId,
  runId: 'packleader-recovery-1',
  fenceEpoch: 7,
  closeEpoch: null,
  state: 'OPEN',
  roleEnabled: false,
  roleRevision: 42,
  roleConfigSha256: PERMIT.roleConfigSha256,
  grantPlanSha256: PERMIT.grantPlanSha256,
  inFlightMints: 0,
  activeLeases: 0,
  recoveryRequired: 0,
  nonterminalOperations: 0,
  readyPermits: 0,
  expiresAt: '2026-08-28T12:30:00.000Z',
  closedAt: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  spinner.start.mockReturnValue(spinner);
});

describe('dynasec Recovery Fence v1 commands', () => {
  it('issues with an explicit Idempotency-Key and the exact bounded body', async () => {
    mockRequest.mockResolvedValue(PERMIT);
    const {issueMintPermit} = await import('../../src/commands/dynamic-secrets/permit.js');
    await issueMintPermit('role-1', {
      fenceId: PERMIT.fenceId,
      consumerApiKeyId: PERMIT.consumerApiKeyId,
      phase: PERMIT.phase,
      expiresInSeconds: '120',
      credentialTtlSeconds: '900',
      privilegeOverlay: 'MYSQL_SCHEMA_LOCK_TABLES',
      reason: 'PackLeader recovery request-1',
      idempotencyKey: '6c4a9aea-a265-4c71-8b70-cc4418d152e7', // gitleaks:allow reason=synthetic UUID for idempotency test
      json: true,
    });
    expect(mockRequest).toHaveBeenCalledWith({
      method: 'POST',
      path: '/v1/dynamic-secrets/roles/role-1/mint-permits',
      headers: {'Idempotency-Key': '6c4a9aea-a265-4c71-8b70-cc4418d152e7'}, // gitleaks:allow reason=synthetic UUID for idempotency test
      body: {
        fenceId: PERMIT.fenceId,
        consumerApiKeyId: PERMIT.consumerApiKeyId,
        phase: PERMIT.phase,
        expiresInSeconds: 120,
        credentialTtlSeconds: 900,
        privilegeOverlay: 'MYSQL_SCHEMA_LOCK_TABLES',
        reason: 'PackLeader recovery request-1',
      },
    });
    expect(mockJson).toHaveBeenCalledWith(PERMIT);
  });

  it('reads operation status by permitId/requestId and never asks for leaseId', async () => {
    mockGet.mockResolvedValue(OPERATION);
    const {getMintOperationStatus} = await import('../../src/commands/dynamic-secrets/permit.js');
    await getMintOperationStatus(PERMIT.permitId, OPERATION.requestId, {json: true});
    expect(mockGet).toHaveBeenCalledWith(
      `/v1/dynamic-secrets/mint-permits/${PERMIT.permitId}/operations/${OPERATION.requestId}`,
    );
    expect(mockJson).toHaveBeenCalledWith(OPERATION);
  });

  it('opens a fence with pinned revision/digest and closes using the OPEN epoch', async () => {
    mockPut.mockResolvedValueOnce(FENCE).mockResolvedValueOnce({...FENCE, state: 'CLOSED'});
    const {openRecoveryFence, closeRecoveryFence} = await import(
      '../../src/commands/dynamic-secrets/recovery-fence.js'
    );
    await openRecoveryFence('role-1', FENCE.runId, {
      consumerApiKeyId: PERMIT.consumerApiKeyId,
      expectedRoleRevision: '42',
      expectedRoleConfigSha256: PERMIT.roleConfigSha256,
      expiresInSeconds: '1800',
      purpose: 'packleader-client-v1-recovery',
      json: true,
    });
    await closeRecoveryFence('role-1', FENCE.runId, {
      expectedFenceEpoch: '7',
      json: true,
    });
    expect(mockPut).toHaveBeenNthCalledWith(
      1,
      `/v1/dynamic-secrets/roles/role-1/recovery-fences/${FENCE.runId}`,
      {
        consumerApiKeyId: PERMIT.consumerApiKeyId,
        expectedRoleRevision: 42,
        expectedRoleConfigSha256: PERMIT.roleConfigSha256,
        expiresInSeconds: 1800,
        purpose: 'packleader-client-v1-recovery',
      },
    );
    expect(mockPut).toHaveBeenNthCalledWith(
      2,
      `/v1/dynamic-secrets/roles/role-1/recovery-fences/${FENCE.runId}/close`,
      {expectedFenceEpoch: 7},
    );
  });
});
