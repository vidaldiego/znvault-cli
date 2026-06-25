import { describe, it, expect, afterEach, vi } from 'vitest';
import { PENDING_REFRESH_TTL } from '../../src/lib/constants.js';

// File-local conf mock (hoisted). The global mock in test/setup.ts does not
// survive this file's `vi.resetModules()` for the dynamically re-imported
// store/credentials modules, so without this the tests would hit the REAL conf
// and persist to the user's on-disk config. Mirrors test/lib/config.test.ts but
// seeds per-instance from `defaults` so each `_resetStoreInstance()` (which
// constructs a fresh Conf) starts from a clean store — true per-test isolation.
vi.mock('conf', () => {
  return {
    default: class MockConf {
      private store = new Map<string, unknown>();
      path = '/mock/config/path';
      constructor(options: { projectName: string; defaults?: Record<string, unknown> }) {
        if (options.defaults) {
          for (const [key, value] of Object.entries(options.defaults)) {
            this.store.set(key, structuredClone(value));
          }
        }
      }
      get<T>(key: string): T | undefined {
        return this.store.get(key) as T | undefined;
      }
      set(key: string, value: unknown): void {
        this.store.set(key, value);
      }
      delete(key: string): void {
        this.store.delete(key);
      }
      clear(): void {
        this.store.clear();
      }
    },
  };
});

async function freshCreds() {
  const mod = await import('../../src/lib/config/credentials.js');
  const store = await import('../../src/lib/config/store.js');
  store._resetStoreInstance();
  return mod;
}

// A real (unsigned-payload) JWT with a known jti claim for decoder tests.
function jwtWithJti(jti: string): string {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({ jti, sub: 'u1', exp: 9999999999 })).toString('base64url');
  return `${header}.${payload}.sig`;
}

describe('pendingRefresh marker (credentials.ts)', () => {
  afterEach(() => vi.resetModules());

  const base = {
    accessToken: 'a', refreshToken: 'r', expiresAt: Date.now() + 3600_000,
    userId: 'u1', username: 'alice', role: 'user', tenantId: null as string | null,
  };

  it('decodeRefreshJti returns the real jti claim, null on garbage', async () => {
    const c = await freshCreds();
    expect(c.decodeRefreshJti(jwtWithJti('jti-real-123'))).toBe('jti-real-123');
    expect(c.decodeRefreshJti('not-a-jwt')).toBeNull();
  });

  it('writePendingRefreshMarker sets the marker atomically on current creds', async () => {
    const c = await freshCreds();
    c.storeCredentials({ ...base });
    expect(c.writePendingRefreshMarker('jti-1')).toBe(true);
    const after = c.getCredentials();
    expect(after?.pendingRefresh?.presentedJti).toBe('jti-1');
    expect(typeof after?.pendingRefresh?.startedAt).toBe('number');
  });

  it('writePendingRefreshMarker returns false with no credentials', async () => {
    const c = await freshCreds();
    expect(c.writePendingRefreshMarker('jti-x')).toBe(false);
  });

  it('storeCredentials WITHOUT pendingRefresh clears any existing marker in the same write', async () => {
    const c = await freshCreds();
    c.storeCredentials({ ...base, pendingRefresh: { presentedJti: 'old', startedAt: Date.now() } });
    expect(c.getCredentials()?.pendingRefresh).toBeDefined();
    c.storeCredentials({ ...base, accessToken: 'a2', refreshToken: 'r2' });
    expect(c.getCredentials()?.pendingRefresh).toBeUndefined();
  });

  it('decidePendingRefresh: none / resolve-live / clean-relogin', async () => {
    const c = await freshCreds();
    c.storeCredentials({ ...base });
    expect(c.decidePendingRefresh()).toEqual({ action: 'none' });
    const now = Date.now();
    c.storeCredentials({ ...base, pendingRefresh: { presentedJti: 'j', startedAt: now } });
    expect(c.decidePendingRefresh(now + 1000)).toEqual({ action: 'resolve-live' });
    expect(c.decidePendingRefresh(now + PENDING_REFRESH_TTL + 1))
      .toEqual({ action: 'clean-relogin', reason: 'marker_past_ttl' });
  });

  it('logPendingRefreshRecovery emits a pending_refresh_recovery debug line', async () => {
    const debugMod = await import('../../src/lib/debug.js');
    const spy = vi.spyOn(debugMod, 'debug').mockImplementation(() => {});
    const c = await freshCreds();
    c.logPendingRefreshRecovery('marker_past_ttl');
    expect(spy).toHaveBeenCalledWith(
      'pending_refresh_recovery',
      expect.stringContaining('marker_past_ttl')
    );
    spy.mockRestore();
  });
});
