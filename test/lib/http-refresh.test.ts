import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';

let creds: any;
const acquireSpy = vi.fn();
const releaseSpy = vi.fn(async () => {});
let lockKeyForToken: (t: string | undefined) => string = () => 'lock-key';

vi.mock('../../src/lib/config.js', () => ({
  storeCredentials: vi.fn((c: any) => { creds = c; }),
  getCredentials: vi.fn(() => creds),
  clearCredentials: vi.fn(() => { creds = undefined; }),
  isTokenExpired: vi.fn(() => true),
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
  invalidateProfileCache: vi.fn(),
}));

vi.mock('../../src/lib/client/refresh-lock.js', () => ({
  computeLockKey: vi.fn((t: string | undefined) => lockKeyForToken(t)),
  acquireRefreshLock: acquireSpy,
  REFRESH_LOCK_TIMEOUT_MS: 5000,
}));

let server: http.Server;
let posts: Array<{ refreshToken: string }> = [];
let nextResponses: Array<{ code: number; body: unknown }> = [];

beforeEach(async () => {
  posts = []; nextResponses = [];
  lockKeyForToken = () => 'lock-key';
  creds = { accessToken: 'a', refreshToken: 'r1', expiresAt: Date.now() - 1, userId: 'u', username: 'al', role: 'user', tenantId: null };
  acquireSpy.mockReset().mockResolvedValue({ lockKey: 'lock-key', release: releaseSpy });
  releaseSpy.mockClear();
  // Restore the canonical config-mock implementations. `vi.resetModules()` in
  // afterEach re-imports http.js fresh, but it does NOT reset .mockImplementation
  // overrides individual tests install on these spies (getCredentials,
  // isTokenExpired) — so re-bind them to their defaults to isolate each test.
  const cfg = await import('../../src/lib/config.js');
  (cfg.getCredentials as any).mockReset().mockImplementation(() => creds);
  (cfg.isTokenExpired as any).mockReset().mockReturnValue(true);
  server = http.createServer((req, res) => {
    let body = ''; req.on('data', c => body += c);
    req.on('end', () => {
      res.setHeader('Content-Type', 'application/json');
      if (req.url === '/auth/refresh') {
        posts.push(JSON.parse(body || '{}'));
        const r = nextResponses.shift() ?? { code: 200, body: { accessToken: 'a2', refreshToken: 'r2', expiresIn: 3600, user: { id: 'u', username: 'al', role: 'user', tenantId: null } } };
        res.statusCode = r.code; res.end(JSON.stringify(r.body)); return;
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

it('refresh acquires the cross-process lock, writes the real-jti marker, clears it atomically', async () => {
  const { HttpClient } = await import('../../src/lib/client/http.js');
  await new HttpClient().refreshToken();
  expect(acquireSpy).toHaveBeenCalledTimes(1);
  expect(posts).toEqual([{ refreshToken: 'r1' }]);
  expect(creds.refreshToken).toBe('r2');
  expect(creds.pendingRefresh).toBeUndefined(); // cleared in the same write as new tokens
});

it('TOCTOU: re-read token has a DIFFERENT lock key -> release + reacquire once under the new key (A1)', async () => {
  // computeLockKey returns a different key for the re-read token than for r1.
  lockKeyForToken = (t) => (t === 'r1' ? 'key-r1' : 'key-other');
  acquireSpy.mockReset()
    .mockResolvedValueOnce({ lockKey: 'key-r1', release: releaseSpy })   // first acquire (under r1's key)
    .mockResolvedValueOnce({ lockKey: 'key-other', release: releaseSpy }); // reacquire under the re-read key
  const cfg = await import('../../src/lib/config.js');
  // After first acquire, getCredentials returns a token whose key differs but is still expired
  // (NOT a peer-rotated live token -> we must reacquire, not skip).
  let phase = 0;
  (cfg.getCredentials as any).mockImplementation(() => {
    phase += 1;
    return phase <= 1
      ? { ...creds, refreshToken: 'r1' }
      : { ...creds, refreshToken: 'r1-rekeyed' };
  });
  (cfg.isTokenExpired as any).mockReturnValue(true);
  const { HttpClient } = await import('../../src/lib/client/http.js');
  await new HttpClient().refreshToken();
  expect(acquireSpy).toHaveBeenCalledTimes(2);   // released then reacquired under the new key
  expect(releaseSpy).toHaveBeenCalled();         // the first (wrong-key) lock was released
});

it('skips the network when a peer already rotated (re-read after acquire is fresh)', async () => {
  const cfg = await import('../../src/lib/config.js');
  (cfg.isTokenExpired as any).mockReturnValueOnce(true).mockReturnValue(false);
  const { HttpClient } = await import('../../src/lib/client/http.js');
  await new HttpClient().refreshToken();
  expect(posts.length).toBe(0); // network skipped
});

it('409 -> single retry with a DIFFERENT token; second 409 -> hard re-auth, never re-presents same token', async () => {
  nextResponses = [
    { code: 409, body: { error: 'refresh_in_progress', message: 'refresh_in_progress', retryAfterMs: 50 } },
    { code: 409, body: { error: 'refresh_in_progress', message: 'refresh_in_progress', retryAfterMs: 50 } },
  ];
  const cfg = await import('../../src/lib/config.js');
  let token = 'r1';
  (cfg.getCredentials as any).mockImplementation(() => ({ ...creds, refreshToken: token }));
  const { HttpClient, RefreshHardReauthError } = await import('../../src/lib/client/http.js');
  setTimeout(() => { token = 'r1b'; }, 0); // peer rotates storage between the two POSTs
  await expect(new HttpClient().refreshToken()).rejects.toBeInstanceOf(RefreshHardReauthError);
  expect(new Set(posts.map(p => p.refreshToken)).size).toBe(posts.length); // never the same token twice
});

it('lock acquire times out (null) -> refresh proceeds best-effort, no hang (A5)', async () => {
  acquireSpy.mockReset().mockResolvedValue(null); // timeout path
  const { HttpClient } = await import('../../src/lib/client/http.js');
  await new HttpClient().refreshToken();           // must resolve, not hang
  expect(posts).toEqual([{ refreshToken: 'r1' }]); // POSTed best-effort without the lock
  expect(creds.refreshToken).toBe('r2');
});

it('401-replay forces a real refresh even when the token is clock-VALID (v3.3.0 non-regression)', async () => {
  // Token is server-REJECTED (401) but clock-valid: isTokenExpired()===false.
  // The 401-replay must NOT short-circuit on "live" (skipIfLive:false) — it must
  // refresh, then replay the original request and succeed.
  const cfg = await import('../../src/lib/config.js');
  (cfg.isTokenExpired as any).mockReset().mockReturnValue(false); // clock-valid throughout
  let firstHit = true;
  server.removeAllListeners('request');
  server.on('request', (req, res) => {
    let body = ''; req.on('data', c => body += c);
    req.on('end', () => {
      res.setHeader('Content-Type', 'application/json');
      if (req.url === '/auth/refresh') {
        posts.push(JSON.parse(body || '{}'));
        res.statusCode = 200;
        res.end(JSON.stringify({ accessToken: 'a2', refreshToken: 'r2', expiresIn: 3600, user: { id: 'u', username: 'al', role: 'user', tenantId: null } }));
        return;
      }
      if (firstHit) { // first protected call -> 401 (JTI gone after restart)
        firstHit = false;
        res.statusCode = 401;
        res.end(JSON.stringify({ error: 'Unauthorized', message: 'session expired' }));
        return;
      }
      res.statusCode = 200; res.end(JSON.stringify({ ok: true })); // replay succeeds
    });
  });
  const { HttpClient } = await import('../../src/lib/client/http.js');
  const result = await new HttpClient().get<{ ok: boolean }>('/v1/anything');
  expect(result).toEqual({ ok: true });
  expect(posts).toEqual([{ refreshToken: 'r1' }]); // the 401-replay DID refresh
  expect(creds.refreshToken).toBe('r2');
});
