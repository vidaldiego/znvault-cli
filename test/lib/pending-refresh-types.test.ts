import { describe, it, expect } from 'vitest';
import { PENDING_REFRESH_TTL } from '../../src/lib/constants.js';
import type { StoredCredentials } from '../../src/types/index.js';

describe('pending-refresh marker model', () => {
  it('PENDING_REFRESH_TTL is 60000ms', () => {
    expect(PENDING_REFRESH_TTL).toBe(60000);
  });

  it('StoredCredentials accepts an optional pendingRefresh marker', () => {
    const creds: StoredCredentials = {
      accessToken: 'a',
      refreshToken: 'r',
      expiresAt: Date.now() + 3600_000,
      userId: 'u1',
      username: 'alice',
      role: 'user',
      tenantId: null,
      pendingRefresh: { presentedJti: 'jti-1', startedAt: Date.now() },
    };
    expect(creds.pendingRefresh?.presentedJti).toBe('jti-1');
    const without: StoredCredentials = { ...creds };
    delete without.pendingRefresh;
    expect(without.pendingRefresh).toBeUndefined();
  });
});
