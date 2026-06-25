import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';

// Regression test for M-1 (stale-cache-after-lock-acquire seam).
//
// In refreshToken(), the pre-acquire getCredentials() populates a 5s in-process
// profile cache. acquireRefreshLock() can then block for up to 5s while a PEER
// process rotates the on-disk token and releases. The post-acquire re-read is
// meant to detect that rotation and SKIP the network — but if nothing
// invalidated the profile cache during the lock wait, the re-read is served the
// STALE pre-rotation creds, the rotation is missed, and the OLD (now
// server-consumed) token is POSTed -> reuse_detected / 409.
//
// The fix invalidates the active profile's cache immediately after the lock is
// acquired (in BOTH the initial acquire and the TOCTOU-reacquire paths) so the
// re-reads hit disk. This suite models that cache faithfully: getCredentials()
// returns the STALE expired creds until invalidateProfileCache() is called, at
// which point it returns the peer-rotated LIVE creds. With the fix the network
// POST is skipped; without it, the POST fires (and the assertion fails).

let creds: any;
/** "On-disk" creds the peer rotated to during the lock wait (live token). */
let diskCreds: any;
/** Simulated profile-cache validity: when false, reads must hit "disk". */
let cacheValid = false;

const acquireSpy = vi.fn();
const releaseSpy = vi.fn(async () => {});
const invalidateSpy = vi.fn((_p: string) => {
  // Model the real cache.ts: invalidation forces the next read to hit disk.
  cacheValid = false;
});

vi.mock('../../src/lib/config.js', () => ({
  storeCredentials: vi.fn((c: any) => { creds = c; }),
  // Models getCredentials() reading through the 5s profile cache:
  // - while the cache is valid it returns the cached (pre-rotation, expired) creds
  // - once invalidated, it reads "disk" (the peer-rotated live creds)
  getCredentials: vi.fn(() => (cacheValid ? creds : (diskCreds ?? creds))),
  clearCredentials: vi.fn(() => { creds = undefined; }),
  // Token is expired iff we are looking at the stale cached creds; the rotated
  // disk creds are live. Mirror getCredentials()'s cache logic.
  isTokenExpired: vi.fn(() => (cacheValid ? true : !(diskCreds ?? creds)?.live)),
  decodeRefreshJti: vi.fn((t: string) => `jti-of-${t}`),
  writePendingRefreshMarker: vi.fn((jti: string) => {
    if (!creds) return false;
    creds = { ...creds, pendingRefresh: { presentedJti: jti, startedAt: Date.now() } };
    return true;
  }),
  decidePendingRefresh: vi.fn(() => (creds?.pendingRefresh
    ? { action: 'resolve-live' } : { action: 'none' })),
  logPendingRefreshRecovery: vi.fn(),
  hasEnvCredentials: vi.fn(() => false),
  getEnvCredentials: vi.fn(() => undefined),
  hasApiKey: vi.fn(() => false),
  getApiKey: vi.fn(() => undefined),
  getConfig: vi.fn(() => ({ url: process.env.ZNVAULT_URL, insecure: false, timeout: 30000 })),
  getEffectiveUrl: vi.fn(() => process.env.ZNVAULT_URL),
  getActiveProfileName: vi.fn(() => 'default'),
  invalidateProfileCache: invalidateSpy,
}));

vi.mock('../../src/lib/client/refresh-lock.js', () => ({
  computeLockKey: vi.fn(() => 'lock-key'),
  // The acquire is where the peer "wins": by the time we return, the on-disk
  // token has already been rotated to a live one. The in-process profile cache
  // is still warm (cacheValid === true) holding the pre-rotation creds — exactly
  // the M-1 seam.
  acquireRefreshLock: acquireSpy,
  REFRESH_LOCK_TIMEOUT_MS: 5000,
}));

let server: http.Server;
let posts: Array<{ refreshToken: string }> = [];

beforeEach(async () => {
  posts = [];
  // Pre-acquire state: the cached creds are expired (need refresh).
  creds = { accessToken: 'a', refreshToken: 'r1', expiresAt: Date.now() - 1, userId: 'u', username: 'al', role: 'user', tenantId: null, live: false };
  // The peer rotates to THIS live token during the lock wait. Same lock key
  // (computeLockKey is stubbed constant) so no TOCTOU reacquire is triggered.
  diskCreds = { accessToken: 'a2', refreshToken: 'r1', expiresAt: Date.now() + 3_600_000, userId: 'u', username: 'al', role: 'user', tenantId: null, live: true };
  cacheValid = true; // pre-acquire getCredentials() warmed the cache

  invalidateSpy.mockClear();
  releaseSpy.mockClear();
  acquireSpy.mockReset().mockImplementation(async () => {
    // Peer rotated on disk while we "waited" for the lock; the cache is still warm.
    return { lockKey: 'lock-key', release: releaseSpy };
  });

  server = http.createServer((req, res) => {
    let body = ''; req.on('data', c => body += c);
    req.on('end', () => {
      res.setHeader('Content-Type', 'application/json');
      if (req.url === '/auth/refresh') {
        posts.push(JSON.parse(body || '{}'));
        res.statusCode = 200;
        res.end(JSON.stringify({ accessToken: 'a3', refreshToken: 'r2', expiresIn: 3600, user: { id: 'u', username: 'al', role: 'user', tenantId: null } }));
        return;
      }
      res.statusCode = 200; res.end('{}');
    });
  });
  await new Promise<void>(r => server.listen(0, '127.0.0.1', () => r()));
  process.env.ZNVAULT_URL = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterEach(async () => {
  delete process.env.ZNVAULT_URL;
  await new Promise<void>(r => server.close(() => r()));
  vi.resetModules();
});

it('invalidates the profile cache after acquire so a peer rotation during the lock wait is observed (network skipped)', async () => {
  const { HttpClient } = await import('../../src/lib/client/http.js');
  await new HttpClient().refreshToken();

  // The fix: cache invalidated for the active profile after the lock acquire.
  expect(invalidateSpy).toHaveBeenCalledWith('default');

  // ...and it MUST run AFTER the lock is acquired (the whole point is to make the
  // post-acquire re-read hit disk). Assert call ordering deterministically.
  const acquireOrder = acquireSpy.mock.invocationCallOrder[0];
  const invalidateOrder = invalidateSpy.mock.invocationCallOrder[0];
  expect(invalidateOrder).toBeGreaterThan(acquireOrder);

  // Because the post-acquire re-read now sees the peer's live token, the network
  // POST is skipped. Without the invalidation the stale cache would still report
  // an expired token and we would POST the old (consumed) r1 -> this is the bug.
  expect(posts.length).toBe(0);
});
