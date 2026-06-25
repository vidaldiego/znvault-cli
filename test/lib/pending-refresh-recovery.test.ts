// Path: test/lib/pending-refresh-recovery.test.ts
//
// Crash-recovery / marker-liveness / both-entry-points-gated survival tests
// (design §5.2 cases 5 & 6, A3). A real http.Server records every refresh token
// presented on the wire, so "the marked (possibly-consumed) token is NEVER
// presented" is asserted against the actual network, not just internal state.
// The config layer is the global conf mock; the lock is mocked out (this suite
// targets the marker/recovery wiring, not the cross-process lock — that is
// covered by refresh-lock-crossproc.test.ts with real processes).

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';

let creds: any;
let presented: string[] = [];
let reuseHits = 0;
const recoveryLog = vi.fn();

vi.mock('../../src/lib/config.js', () => ({
  storeCredentials: vi.fn((c: any) => { creds = c; }),
  getCredentials: vi.fn(() => creds),
  clearCredentials: vi.fn(() => { creds = undefined; }),
  isTokenExpired: vi.fn(() => true),
  decodeRefreshJti: vi.fn((t: string) => `jti-of-${t}`),
  writePendingRefreshMarker: vi.fn((jti: string) => { if (!creds) return false; creds = { ...creds, pendingRefresh: { presentedJti: jti, startedAt: Date.now() } }; return true; }),
  decidePendingRefresh: vi.fn(() => {
    const m = creds?.pendingRefresh;
    if (!m) return { action: 'none' };
    return (Date.now() - m.startedAt >= 60000) ? { action: 'clean-relogin', reason: 'marker_past_ttl' } : { action: 'resolve-live' };
  }),
  logPendingRefreshRecovery: recoveryLog,
  hasEnvCredentials: vi.fn(() => false), getEnvCredentials: vi.fn(() => undefined),
  hasApiKey: vi.fn(() => false), getApiKey: vi.fn(() => undefined),
  getConfig: vi.fn(() => ({ url: process.env.ZNVAULT_URL, insecure: false, timeout: 30000 })),
  getEffectiveUrl: vi.fn(() => process.env.ZNVAULT_URL),
  getActiveProfileName: vi.fn(() => 'default'),
}));
vi.mock('../../src/lib/client/refresh-lock.js', () => ({
  computeLockKey: vi.fn(() => 'k'),
  acquireRefreshLock: vi.fn(async () => ({ lockKey: 'k', release: vi.fn(async () => {}) })),
  REFRESH_LOCK_TIMEOUT_MS: 5000,
}));

let server: http.Server;
beforeEach(async () => {
  presented = []; reuseHits = 0; recoveryLog.mockClear();
  server = http.createServer((req, res) => {
    let body = ''; req.on('data', c => body += c);
    req.on('end', () => {
      res.setHeader('Content-Type', 'application/json');
      if (req.url === '/auth/refresh') {
        const { refreshToken } = JSON.parse(body || '{}');
        presented.push(refreshToken);
        if (refreshToken === 'consumed-r') { reuseHits++; res.statusCode = 401; res.end(JSON.stringify({ error: 'reuse_detected' })); return; }
        res.statusCode = 200; res.end(JSON.stringify({ accessToken: 'a2', refreshToken: 'r2', expiresIn: 3600, user: { id: 'u', username: 'al', role: 'user', tenantId: null } }));
      } else { res.statusCode = 401; res.end(JSON.stringify({ error: 'unauthorized' })); }
    });
  });
  await new Promise<void>(r => server.listen(0, '127.0.0.1', () => r()));
  process.env.ZNVAULT_URL = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterEach(async () => { delete process.env.ZNVAULT_URL; await new Promise<void>(r => server.close(() => r())); vi.resetModules(); });

it('crash recovery: a past-TTL marked (consumed) token is NEVER presented -> no reuse_detected, recovery logged', async () => {
  creds = { accessToken: 'a', refreshToken: 'consumed-r', expiresAt: Date.now() - 1, userId: 'u', username: 'al', role: 'user', tenantId: null, pendingRefresh: { presentedJti: 'jti-of-consumed-r', startedAt: Date.now() - 61000 } };
  const { HttpClient, RefreshHardReauthError } = await import('../../src/lib/client/http.js');
  await expect(new HttpClient().refreshToken()).rejects.toBeInstanceOf(RefreshHardReauthError);
  expect(presented).not.toContain('consumed-r'); // wire proof: never presented
  expect(reuseHits).toBe(0);
  expect(recoveryLog).toHaveBeenCalledWith('marker_past_ttl'); // A3
});

it('marker within TTL + live token -> refresh succeeds and clears marker', async () => {
  creds = { accessToken: 'a', refreshToken: 'r-live', expiresAt: Date.now() - 1, userId: 'u', username: 'al', role: 'user', tenantId: null, pendingRefresh: { presentedJti: 'x', startedAt: Date.now() } };
  const { HttpClient } = await import('../../src/lib/client/http.js');
  await new HttpClient().refreshToken();
  expect(presented).toEqual(['r-live']);
  expect(creds.refreshToken).toBe('r2');
  expect(creds.pendingRefresh).toBeUndefined();
});

it('both entry points gated: 401-replay also refuses a past-TTL marked token', async () => {
  creds = { accessToken: 'a', refreshToken: 'consumed-r', expiresAt: Date.now() + 3600_000, userId: 'u', username: 'al', role: 'user', tenantId: null, pendingRefresh: { presentedJti: 'jti-of-consumed-r', startedAt: Date.now() - 61000 } };
  const cfg = await import('../../src/lib/config.js');
  (cfg.isTokenExpired as any).mockReturnValue(false); // access token valid -> only 401-replay path can fire
  const { HttpClient } = await import('../../src/lib/client/http.js');
  const c = new HttpClient();
  await c.request({ method: 'GET', path: '/v1/whoami' }).catch(() => {});
  expect(presented).not.toContain('consumed-r');
  expect(recoveryLog).toHaveBeenCalledWith('marker_past_ttl'); // A3 on the 401-replay path too
});
