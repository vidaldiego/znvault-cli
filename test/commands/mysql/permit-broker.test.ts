import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import type {Mock} from 'vitest';
import type {
  MintOperation,
  RecoveryHpkeCredential,
} from '../../../src/commands/dynamic-secrets/recovery-types.js';

const mockPut: Mock = vi.fn();
const mockGet: Mock = vi.fn();
vi.mock('../../../src/lib/client.js', () => ({
  client: {put: mockPut, get: mockGet},
}));

const mockCnfCleanup: Mock = vi.fn();
const mockCreateMyCnf: Mock = vi.fn();
vi.mock('../../../src/commands/mysql/mycnf.js', () => ({
  createMyCnf: mockCreateMyCnf,
}));

const mockGenerateRecipient: Mock = vi.fn();
const mockOpenCredential: Mock = vi.fn();
vi.mock('../../../src/commands/mysql/recovery-hpke.js', () => ({
  generateEphemeralRecoveryRecipient: mockGenerateRecipient,
  openRecoveryCredential: mockOpenCredential,
}));

const PERMIT_ID = 'dmp_0123456789abcdef';
const REQUEST_ID = 'recovery-request-1';
const BASE_PATH = `/v1/dynamic-secrets/mint-permits/${PERMIT_ID}/operations/${REQUEST_ID}`;

const DELIVERY: RecoveryHpkeCredential = {
  permitId: PERMIT_ID,
  requestId: REQUEST_ID,
  state: 'CONSUMED',
  envelopeSha256: `sha256:${'4'.repeat(64)}`,
  deliveryFormat: 'hpke-v1',
  envelope: {
    version: 'hpke-v1',
    suite: 'X25519-HKDF-SHA256-ChaCha20Poly1305',
    enc: 'a'.repeat(43),
    ciphertext: 'b'.repeat(64),
    aadSha256: `sha256:${'5'.repeat(64)}`,
  },
  aad: 'c'.repeat(64),
};

function operation(state: MintOperation['state'] = 'CONSUMED'): MintOperation {
  return {
    operationId: 'dmo_0123456789abcdef',
    permitId: PERMIT_ID,
    requestId: REQUEST_ID,
    state,
    fenceId: 'drf_0123456789abcdef',
    fenceEpoch: 7,
    roleId: 'role-readwrite', // gitleaks:allow reason=synthetic recovery role fixture
    roleRevision: 42,
    roleConfigSha256: '1'.repeat(64),
    grantPlanSha256: '2'.repeat(64),
    effectiveGrantPlanSha256: '3'.repeat(64),
    privilegeOverlay: 'MYSQL_SCHEMA_LOCK_TABLES',
    leaseId: 'lease-recovery-1',
    username: 'znr_user',
    credentialExpiresAt: '2026-08-28T12:15:00.000Z',
    createdAt: '2026-08-28T12:00:00.000Z',
    claimedAt: '2026-08-28T12:00:01.000Z',
    consumedAt: '2026-08-28T12:00:02.000Z',
    deliveredAt: state === 'DELIVERED' ? '2026-08-28T12:00:03.000Z' : null,
    terminalAt: state === 'REVOKED' ? '2026-08-28T12:00:04.000Z' : null,
    lastErrorCode: null,
    credential: state === 'CONSUMED' || state === 'DELIVERED' ? DELIVERY : undefined,
  };
}

function setupHappyPath(): void {
  mockPut.mockImplementation((path: string): Promise<MintOperation> => {
    if (path === BASE_PATH) return Promise.resolve(operation('CONSUMED'));
    if (path === `${BASE_PATH}/delivery-ack`) return Promise.resolve(operation('DELIVERED'));
    if (path === `${BASE_PATH}/revoke`) return Promise.resolve(operation('REVOKED'));
    return Promise.reject(new Error(`Unexpected PUT ${path}`));
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGenerateRecipient.mockResolvedValue({
    recipientPublicKey: 'p'.repeat(43),
    recipientKeyId: `sha256:${'6'.repeat(64)}`,
    privateKey: {},
  });
  mockOpenCredential.mockResolvedValue({
    schema: 'znvault.dynsec.recovery-credential.v1',
    version: 1,
    username: 'znr_user',
    password: 'memory-only-password',
    host: 'mysql.example.internal',
    port: 3306,
    database: 'packleader',
    expiresAt: '2026-08-28T12:15:00.000Z',
  });
  mockCreateMyCnf.mockResolvedValue({fd: 11, fdPath: '/dev/fd/11', cleanup: mockCnfCleanup});
});

afterEach(() => {
  vi.useRealTimers();
});

describe('mysql exec-permit broker', () => {
  it('consumes, validates, ACKs before MySQL, and revokes by requestId', async () => {
    setupHappyPath();
    const {runExecPermit} = await import('../../../src/commands/mysql/permit-broker.js');
    const run = vi.fn().mockResolvedValue(0);

    const result = await runExecPermit({
      permitId: PERMIT_ID,
      requestId: REQUEST_ID,
      fenceEpoch: 7,
      files: ['reconcile.sql'],
      passthrough: ['--batch'],
      run,
    });

    expect(result).toMatchObject({
      permitId: PERMIT_ID,
      requestId: REQUEST_ID,
      deliveryState: 'DELIVERED',
      mysqlExitCode: 0,
      revokeState: 'REVOKED',
    });
    expect(mockCreateMyCnf).toHaveBeenCalledWith({
      user: 'znr_user',
      password: 'memory-only-password',
      host: 'mysql.example.internal',
      port: 3306,
    });
    expect(run).toHaveBeenCalledWith({
      fd: 11,
      fdPath: '/dev/fd/11',
      database: 'packleader',
      files: ['reconcile.sql'],
      passthrough: ['--batch'],
    });
    expect(mockCnfCleanup).toHaveBeenCalledOnce();

    const ackCall = mockPut.mock.calls.find(([path]) => path === `${BASE_PATH}/delivery-ack`);
    const revokeCall = mockPut.mock.calls.find(([path]) => path === `${BASE_PATH}/revoke`);
    expect(ackCall?.[1]).toEqual({envelopeSha256: DELIVERY.envelopeSha256});
    expect(revokeCall?.[1]).toEqual({reason: 'znvault_mysql_exec_permit_complete'});
    expect(mockPut.mock.invocationCallOrder[1]).toBeLessThan(run.mock.invocationCallOrder[0]);

    // No API call contains the decrypted credential, lease ID, or MySQL target.
    expect(JSON.stringify(mockPut.mock.calls)).not.toContain('memory-only-password');
    expect(JSON.stringify(mockPut.mock.calls)).not.toContain('mysql.example.internal');
    expect(JSON.stringify(mockPut.mock.calls)).not.toContain('lease-recovery-1');
  });

  it('retries an uncertain consume with the exact same public-key body', async () => {
    vi.useFakeTimers();
    let consumes = 0;
    mockPut.mockImplementation((path: string): Promise<MintOperation> => {
      if (path === BASE_PATH) {
        consumes++;
        if (consumes === 1) return Promise.reject(new Error('response lost'));
        return Promise.resolve(operation('CONSUMED'));
      }
      if (path === `${BASE_PATH}/delivery-ack`) return Promise.resolve(operation('DELIVERED'));
      if (path === `${BASE_PATH}/revoke`) return Promise.resolve(operation('REVOKED'));
      return Promise.reject(new Error(`Unexpected PUT ${path}`));
    });
    const {runExecPermit} = await import('../../../src/commands/mysql/permit-broker.js');
    const promise = runExecPermit({
      permitId: PERMIT_ID,
      requestId: REQUEST_ID,
      fenceEpoch: 7,
      run: vi.fn().mockResolvedValue(0),
    });
    await vi.runAllTimersAsync();
    await promise;

    const consumeBodies = mockPut.mock.calls
      .filter(([path]) => path === BASE_PATH)
      .map(([, body]) => body);
    expect(consumeBodies).toHaveLength(2);
    expect(consumeBodies[0]).toBe(consumeBodies[1]);
  });

  it('does not invoke MySQL when delivery ACK is rejected, then revokes', async () => {
    const ackError = Object.assign(new Error('ack rejected'), {statusCode: 409});
    mockPut.mockImplementation((path: string): Promise<MintOperation> => {
      if (path === BASE_PATH) return Promise.resolve(operation('CONSUMED'));
      if (path === `${BASE_PATH}/delivery-ack`) return Promise.reject(ackError);
      if (path === `${BASE_PATH}/revoke`) return Promise.resolve(operation('REVOKED'));
      return Promise.reject(new Error(`Unexpected PUT ${path}`));
    });
    const {runExecPermit} = await import('../../../src/commands/mysql/permit-broker.js');
    const run = vi.fn().mockResolvedValue(0);
    await expect(runExecPermit({
      permitId: PERMIT_ID,
      requestId: REQUEST_ID,
      fenceEpoch: 7,
      run,
    })).rejects.toThrow(/ack rejected/i);
    expect(run).not.toHaveBeenCalled();
    expect(mockPut).toHaveBeenCalledWith(`${BASE_PATH}/revoke`, {
      reason: 'znvault_mysql_exec_permit_failure',
    });
    expect(mockCnfCleanup).toHaveBeenCalledOnce();
  });

  it('does not tombstone a permit after a definitive pre-operation 403', async () => {
    const forbidden = Object.assign(new Error('wrong API key'), {statusCode: 403});
    mockPut.mockRejectedValue(forbidden);
    const {runExecPermit} = await import('../../../src/commands/mysql/permit-broker.js');
    await expect(runExecPermit({
      permitId: PERMIT_ID,
      requestId: REQUEST_ID,
      fenceEpoch: 7,
      run: vi.fn(),
    })).rejects.toThrow(/wrong API key/i);
    expect(mockPut).toHaveBeenCalledTimes(1);
    expect(mockCreateMyCnf).not.toHaveBeenCalled();
  });

  it('still revokes when an uncertain consume is followed by a definitive conflict', async () => {
    vi.useFakeTimers();
    const unavailable = Object.assign(new Error('response unavailable'), {statusCode: 503});
    const conflict = Object.assign(new Error('request conflict'), {statusCode: 409});
    let consumeAttempt = 0;
    mockPut.mockImplementation((path: string): Promise<MintOperation> => {
      if (path === BASE_PATH) {
        consumeAttempt++;
        return Promise.reject(consumeAttempt === 1 ? unavailable : conflict);
      }
      if (path === `${BASE_PATH}/revoke`) return Promise.resolve(operation('REVOKED'));
      return Promise.reject(new Error(`Unexpected PUT ${path}`));
    });
    const {runExecPermit} = await import('../../../src/commands/mysql/permit-broker.js');
    const promise = runExecPermit({
      permitId: PERMIT_ID,
      requestId: REQUEST_ID,
      fenceEpoch: 7,
      run: vi.fn(),
    });
    const assertion = expect(promise).rejects.toThrow(/request conflict/i);
    await vi.runAllTimersAsync();
    await assertion;
    expect(mockPut).toHaveBeenCalledWith(`${BASE_PATH}/revoke`, {
      reason: 'znvault_mysql_exec_permit_failure',
    });
  });

  it('fetches the byte-stable credential endpoint when consume omits it', async () => {
    setupHappyPath();
    const withoutCredential = operation('CONSUMED');
    delete withoutCredential.credential;
    mockPut.mockImplementation((path: string): Promise<MintOperation> => {
      if (path === BASE_PATH) return Promise.resolve(withoutCredential);
      if (path === `${BASE_PATH}/delivery-ack`) return Promise.resolve(operation('DELIVERED'));
      if (path === `${BASE_PATH}/revoke`) return Promise.resolve(operation('REVOKED'));
      return Promise.reject(new Error(`Unexpected PUT ${path}`));
    });
    mockGet.mockResolvedValue(DELIVERY);
    const {runExecPermit} = await import('../../../src/commands/mysql/permit-broker.js');
    await runExecPermit({
      permitId: PERMIT_ID,
      requestId: REQUEST_ID,
      fenceEpoch: 7,
      run: vi.fn().mockResolvedValue(0),
    });
    expect(mockGet).toHaveBeenCalledWith(`${BASE_PATH}/credential`);
  });
});
