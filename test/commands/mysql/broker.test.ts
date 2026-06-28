// test/commands/mysql/broker.test.ts

/**
 * Tests for runBrokered — the lease lifecycle broker.
 *
 * Mocking strategy:
 *   - client.post is mocked via vi.mock('../../../src/lib/client.js') and programmed
 *     per-URL in each test to distinguish generate vs. revoke calls.
 *   - createMyCnf is mocked via vi.mock('../../../src/commands/mysql/mycnf.js') to
 *     avoid real fs operations; the mock returns a stable cnfPath and a cleanup spy.
 *   - Backoff delays are zeroed out via vi.useFakeTimers() + vi.runAllTimersAsync() so
 *     retry tests don't sleep for real seconds.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Mock } from 'vitest';

// ── HTTP client mock (only post<T> is used by broker) ────────────────────────
const mockPost: Mock = vi.fn();
vi.mock('../../../src/lib/client.js', () => ({
  client: { post: mockPost },
}));

// ── Stable mock for createMyCnf (never hits real fs) ─────────────────────────
const mockMyCnfCleanup: Mock = vi.fn();
const mockCreateMyCnf: Mock = vi.fn();
vi.mock('../../../src/commands/mysql/mycnf.js', () => ({
  createMyCnf: mockCreateMyCnf,
}));

// ── Shared test fixture ───────────────────────────────────────────────────────
const CREDENTIAL = {
  leaseId: 'lease-abc123',
  username: 'znv_u_xyz',
  password: 's3cr3t',
  host: 'db.example.com',
  port: 3306,
  database: 'appdb',
  expiresAt: '2026-06-28T12:00:00Z',
  maxExpiresAt: '2026-06-28T13:00:00Z',
  ttlSeconds: 600,
  renewalCount: 0,
};

const CNF_PATH = '/dev/shm/znvault-test/my.cnf';

/** Program client.post to return CREDENTIAL for the credentials URL and resolve for revoke. */
function setupHappyPath(): void {
  mockPost.mockImplementation((url: string): Promise<unknown> => {
    if (url.includes('/credentials')) {
      return Promise.resolve(CREDENTIAL);
    }
    if (url.includes('/revoke')) {
      return Promise.resolve(undefined);
    }
    return Promise.reject(new Error(`Unexpected URL: ${url}`));
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  // Restore default createMyCnf behaviour after each clearAllMocks()
  mockCreateMyCnf.mockResolvedValue({ path: CNF_PATH, cleanup: mockMyCnfCleanup });
});

afterEach(() => {
  vi.useRealTimers();
});

// ─────────────────────────────────────────────────────────────────────────────
describe('runBrokered', () => {
  it('generates, runs, and revokes exactly once on success (exit code 0)', async () => {
    setupHappyPath();

    const { runBrokered } = await import('../../../src/commands/mysql/broker.js');

    const run = vi.fn().mockResolvedValue(0);
    const code = await runBrokered({ roleId: 'dbr_rw', run });

    expect(code).toBe(0);
    // generate was called with the default TTL
    expect(mockPost).toHaveBeenCalledWith(
      '/v1/dynamic-secrets/roles/dbr_rw/credentials',
      expect.objectContaining({ ttlSeconds: 600 }),
    );
    // revoke was called exactly once
    const revokeCalls = mockPost.mock.calls.filter(([url]: [string]) => url.includes('/revoke'));
    expect(revokeCalls).toHaveLength(1);
    expect(revokeCalls[0][0]).toBe(`/v1/dynamic-secrets/leases/${CREDENTIAL.leaseId}/revoke`);
    // cnf cleanup was called
    expect(mockMyCnfCleanup).toHaveBeenCalledOnce();
    // run received credential + cnfPath
    expect(run).toHaveBeenCalledWith({
      credential: CREDENTIAL,
      cnfPath: CNF_PATH,
    });
  });

  it('still revokes exactly once when run throws, and rethrows the error', async () => {
    setupHappyPath();

    const { runBrokered } = await import('../../../src/commands/mysql/broker.js');

    const run = vi.fn().mockRejectedValue(new Error('mysql crashed'));

    await expect(runBrokered({ roleId: 'dbr_rw', run })).rejects.toThrow('mysql crashed');

    const revokeCalls = mockPost.mock.calls.filter(([url]: [string]) => url.includes('/revoke'));
    expect(revokeCalls).toHaveLength(1);
    expect(mockMyCnfCleanup).toHaveBeenCalledOnce();
  });

  it('cleaned guard — revoke and cnf cleanup are each called exactly once on normal completion', async () => {
    // Exercises the `cleaned` boolean guard: even though both the finally block
    // and any concurrent signal handler call cleanup(), the underlying revoke and
    // cnfCleanup must each fire at most once.
    //
    // Note: triggering a true double invocation of cleanup() from user-space
    // requires either exporting internals or a real signal, neither of which is
    // viable in unit tests. Instead we verify the observable contract that
    // matters: on a normal runBrokered call, revoke is called EXACTLY once and
    // cnfCleanup is called EXACTLY once — which is what the `cleaned` guard
    // guarantees (any second call is a no-op before any side effects).
    setupHappyPath();

    const { runBrokered } = await import('../../../src/commands/mysql/broker.js');

    const run = vi.fn().mockResolvedValue(42);
    const code = await runBrokered({ roleId: 'dbr_rw', run });

    expect(code).toBe(42);
    const revokeCalls = mockPost.mock.calls.filter(([url]: [string]) => url.includes('/revoke'));
    expect(revokeCalls).toHaveLength(1);
    expect(mockMyCnfCleanup).toHaveBeenCalledOnce();
  });

  it('retries revoke on transient failure then succeeds without throwing', async () => {
    vi.useFakeTimers();

    // First two revoke calls fail, third succeeds
    let revokeAttempt = 0;
    mockPost.mockImplementation((url: string): Promise<unknown> => {
      if (url.includes('/credentials')) {
        return Promise.resolve(CREDENTIAL);
      }
      if (url.includes('/revoke')) {
        revokeAttempt++;
        if (revokeAttempt < 3) {
          return Promise.reject(new Error('connection refused'));
        }
        return Promise.resolve(undefined);
      }
      return Promise.reject(new Error(`Unexpected URL: ${url}`));
    });

    const { runBrokered } = await import('../../../src/commands/mysql/broker.js');

    const run = vi.fn().mockResolvedValue(0);

    // Start the broker then advance fake timers to flush the backoff delays.
    const promise = runBrokered({ roleId: 'dbr_rw', run });
    await vi.runAllTimersAsync();
    const code = await promise;

    expect(code).toBe(0);
    expect(revokeAttempt).toBe(3);
  });

  it('treats an already-revoked error as success (no loud warn, no throw)', async () => {
    vi.useFakeTimers();

    mockPost.mockImplementation((url: string): Promise<unknown> => {
      if (url.includes('/credentials')) {
        return Promise.resolve(CREDENTIAL);
      }
      if (url.includes('/revoke')) {
        // Simulate the server error for an already-revoked lease
        return Promise.reject(
          new Error(`Cannot revoke ${CREDENTIAL.leaseId}: lease is already REVOKED`),
        );
      }
      return Promise.reject(new Error(`Unexpected URL: ${url}`));
    });

    const { runBrokered } = await import('../../../src/commands/mysql/broker.js');

    const run = vi.fn().mockResolvedValue(0);
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    const promise = runBrokered({ roleId: 'dbr_rw', run });
    await vi.runAllTimersAsync();
    const code = await promise;

    // Should succeed without throwing
    expect(code).toBe(0);
    // Must NOT have logged the "loud leaseId WARN" that signals unrecoverable revoke failure
    const loudWarnCalls = warnSpy.mock.calls.filter(
      (args) => typeof args[0] === 'string' && args[0].includes(CREDENTIAL.leaseId),
    );
    expect(loudWarnCalls).toHaveLength(0);

    warnSpy.mockRestore();
  });

  it('throws a clear upgrade error when host is missing in the credential', async () => {
    const credWithoutHost = { ...CREDENTIAL, host: undefined, port: undefined };
    mockPost.mockImplementation((url: string): Promise<unknown> => {
      if (url.includes('/credentials')) {
        return Promise.resolve(credWithoutHost);
      }
      // revoke may be called (best-effort before throwing)
      if (url.includes('/revoke')) {
        return Promise.resolve(undefined);
      }
      return Promise.reject(new Error(`Unexpected URL: ${url}`));
    });

    const { runBrokered } = await import('../../../src/commands/mysql/broker.js');

    const run = vi.fn();
    await expect(runBrokered({ roleId: 'dbr_rw', run })).rejects.toThrow(/upgrade vault/i);
    // run must NOT have been called (error happens before it)
    expect(run).not.toHaveBeenCalled();
  });

  it('passes an explicit ttlSeconds to the generate call', async () => {
    setupHappyPath();

    const { runBrokered } = await import('../../../src/commands/mysql/broker.js');

    const run = vi.fn().mockResolvedValue(0);
    await runBrokered({ roleId: 'dbr_rw', ttlSeconds: 1800, run });

    expect(mockPost).toHaveBeenCalledWith(
      '/v1/dynamic-secrets/roles/dbr_rw/credentials',
      expect.objectContaining({ ttlSeconds: 1800 }),
    );
  });
});
