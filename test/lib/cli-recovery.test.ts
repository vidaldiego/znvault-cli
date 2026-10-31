import {randomBytes, randomUUID} from 'node:crypto';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {store, setRuntimeProfile, getProfile, saveProfile, createProfile, deleteProfile, clearCredentials,
  invalidateAllProfileCaches, storeCredentials, mutateProfileAuthentication, authenticationFingerprint} from '../../src/lib/config.js';

function grant() {
  return {state: 'active' as const, grantId: randomUUID(), credential: randomBytes(32).toString('base64url'),
    origin: 'https://vault.example.test', installationId: randomUUID(), expiresAtSec: Math.floor(Date.now()/1000) + 2592000};
}
function profile() {
  return {url: 'https://vault.example.test', insecure: false, timeout: 1000, authGeneration: randomUUID(), cliRecovery: grant(),
    credentials: {accessToken: 'public-synthetic-access', refreshToken: 'public-synthetic-refresh', expiresAt: 1,
      userId: 'fixture-human', username: 'fixture/alice', role: 'user', tenantId: 'fixture'}};
}

beforeEach(() => {
  for (const key of ['ZNVAULT_URL', 'ZNVAULT_API_KEY', 'ZNVAULT_USERNAME', 'ZNVAULT_PASSWORD']) vi.stubEnv(key, undefined);
  store.set('profiles', {remembered: profile(), neighbor: {url: 'https://other.example.test', insecure: false, timeout: 1000}});
  setRuntimeProfile('remembered');invalidateAllProfileCaches();
});
afterEach(() => {vi.useRealTimers();vi.restoreAllMocks();vi.unstubAllEnvs();setRuntimeProfile(null);invalidateAllProfileCaches();});

describe('durable CLI recovery profile authority', () => {
  it('preserves opt-out through stale metadata writes, logout and profile copy without copying authority', () => {
    const stale = getProfile('remembered')!, before = authenticationFingerprint(stale);
    mutateProfileAuthentication('remembered', p => ({...p, cliRecoveryPreference: 'off'}));
    expect(authenticationFingerprint(getProfile('remembered'))).not.toBe(before);
    saveProfile('remembered', {...stale, timeout: 2000});
    clearCredentials();
    expect(getProfile('remembered')?.cliRecoveryPreference).toBe('off');
    createProfile('copy', {copyFrom: 'remembered'});
    expect(getProfile('copy')).toMatchObject({cliRecoveryPreference: 'off'});
    expect(getProfile('copy')?.credentials).toBeUndefined();expect(getProfile('copy')?.cliRecovery).toBeUndefined();
  });
  it('preserves the grant and generation across metadata writes and ordinary refresh', () => {
    const old = getProfile('remembered')!;
    saveProfile('remembered', {url: old.url, insecure: old.insecure, timeout: 2000});
    expect(getProfile('remembered')).toMatchObject({authGeneration: old.authGeneration, cliRecovery: old.cliRecovery});
    storeCredentials({...old.credentials!, accessToken: 'public-synthetic-rotated'});
    expect(getProfile('remembered')).toMatchObject({cliRecovery: old.cliRecovery, authGeneration: old.authGeneration});
  });
  it('does not copy the capability or authentication generation into another profile', () => {
    createProfile('copy', {copyFrom: 'remembered'});
    expect(getProfile('copy')?.cliRecovery).toBeUndefined();
    expect(getProfile('copy')?.authGeneration).not.toBe(getProfile('remembered')?.authGeneration);
  });
  it('refuses synchronous deletion of an active or pending recovery binding', () => {
    expect(() => deleteProfile('remembered')).toThrow(/retir|recovery|logout/i);
    expect(getProfile('remembered')?.cliRecovery).toBeDefined();
    const p = getProfile('remembered')!;
    store.set('profiles', {remembered: {...p, cliRecovery: {...p.cliRecovery, state: 'revocation_pending'}}});
    expect(() => deleteProfile('remembered')).toThrow(/retir|recovery|logout/i);
  });
  it('refuses to redirect a recovery capability but preserves its principal across tenant-context metadata', () => {
    const old = getProfile('remembered')!;
    expect(() => saveProfile('remembered', {...old, url: 'https://other.example.test'})).toThrow(/retir|recovery|logout/i);
    saveProfile('remembered', {...old, defaultTenant: 'other'});
    expect(getProfile('remembered')).toMatchObject({defaultTenant:'other',credentials:old.credentials,cliRecovery:old.cliRecovery});
    expect(getProfile('remembered')?.url).toBe(old.url);
  });
  it('invalidates pending authentication on a local credential clear without destroying the recovery proof', () => {
    const old = getProfile('remembered')!;
    clearCredentials();
    expect(getProfile('remembered')?.credentials).toBeUndefined();
    expect(getProfile('remembered')?.authGeneration).not.toBe(old.authGeneration);
    expect(getProfile('remembered')?.cliRecovery).toEqual(old.cliRecovery);
  });
});

function recoveryPeer() {
  const p = getProfile('remembered')!, saved = p.cliRecovery!, expiresAt = Math.floor(Date.now()/1000) + 120;
  const requestId = randomUUID(), claimant = randomBytes(32).toString('base64url');
  const tokens = {accessToken: randomBytes(32).toString('base64url'), refreshToken: randomBytes(32).toString('base64url'),
    expiresIn: 900, userSealedUnlocked: false, user: {id: 'fixture-human', username: 'fixture/alice', role: 'user', tenantId: 'fixture' as string | null}};
  const request = vi.fn(async (options: import('../../src/lib/client/types.js').RequestOptions): Promise<unknown> => {
    options.sessionGuard?.();
    if (options.path.endsWith('/protocol')) return {protocolVersion: 3, origin: saved.origin, installationId: saved.installationId, cliRecovery: {version: 1, enabled: true}};
    if (options.path.endsWith('/start')) return {requestId, claimant, expiresAt, comparisonNumber: '42', pushStatus: 'sent'};
    if (options.path.endsWith('/status')) return {state: 'approved', expiresAt};
    if (options.path.endsWith('/complete')) return tokens;
    if (options.path.endsWith('/cancel')) return {cancelled: true};
    throw new Error('Unexpected recovery path');
  });
  return {peer: {getBaseUrl: () => saved.origin, request}, tokens, saved, requestId, claimant, expiresAt};
}

describe('explicit same-iPhone recovery', () => {
  it('polls once every two seconds and never restarts the original request', async () => {
    vi.useFakeTimers();
    const f = recoveryPeer(), original = f.peer.request.getMockImplementation()!;let polls = 0;
    f.peer.request.mockImplementation(async options => {
      if (options.path.endsWith('/status') && ++polls === 1) return {state:'pending',expiresAt:f.expiresAt};
      return await original(options);
    });
    const {recoverCliLogin} = await import('../../src/lib/cli-recovery.js');
    const result = recoverCliLogin(f.peer,{onPending:vi.fn(async () => {})});
    await vi.advanceTimersByTimeAsync(0);expect(polls).toBe(1);
    await vi.advanceTimersByTimeAsync(1999);expect(polls).toBe(1);
    await vi.advanceTimersByTimeAsync(1);expect(await result).toMatchObject({success:true});expect(polls).toBe(2);
    expect(f.peer.request.mock.calls.filter(([x]) => x.path.endsWith('/start'))).toHaveLength(1);
  });
  it.each([401, 403, 410])('suggests a normal login after HTTP%s without retrying a revoked recovery', async statusCode => {
    const f = recoveryPeer(), original = f.peer.request.getMockImplementation()!;
    f.peer.request.mockImplementation(async options => {
      if (options.path.endsWith('/start')) throw Object.assign(new Error('untrusted body'), {statusCode});
      return await original(options);
    });
    const {recoverCliLogin} = await import('../../src/lib/cli-recovery.js');
    expect(await recoverCliLogin(f.peer, {onPending: vi.fn(async () => {})})).toMatchObject({success: false, error: expect.stringMatching(/normal login/)});
    expect(f.peer.request.mock.calls.filter(([x]) => x.path.endsWith('/start'))).toHaveLength(1);
  });
  it.each(['primary', 'enrollment', 'owner', 'lifetime'])('rejects an unexpected %s in a recovery completion', async fault => {
    const f = recoveryPeer();
    if (fault === 'primary') f.tokens.userSealedUnlocked = true;
    if (fault === 'enrollment') Object.assign(f.tokens, {cliRecovery: f.saved});
    if (fault === 'owner') f.tokens.user.id = 'another-human';
    if (fault === 'lifetime') f.tokens.expiresIn = 31*86400;
    const {recoverCliLogin} = await import('../../src/lib/cli-recovery.js');
    expect(await recoverCliLogin(f.peer, {onPending: vi.fn(async () => {})})).toMatchObject({success: false});
    expect(getProfile('remembered')?.credentials).toBeUndefined();
    expect(getProfile('remembered')?.cliRecovery).toEqual(f.saved);
  });
  it.each([false, true])('recovers without a browser or key transfer (superadmin=%s) and retains the original grant deadline', async root => {
    const f = recoveryPeer();
    if (root) {
      f.tokens.user.role = 'superadmin';f.tokens.user.tenantId = null;
      const p = getProfile('remembered')!;p.credentials!.role = 'superadmin';p.credentials!.tenantId = null;
      store.set('profiles', {remembered: p});invalidateAllProfileCaches();
    }
    const old = getProfile('remembered')!;
    const pending = vi.fn(async () => {});
    const {recoverCliLogin} = await import('../../src/lib/cli-recovery.js');
    const result = await recoverCliLogin(f.peer, {onPending: pending});
    expect(result).toMatchObject({success: true, user: {...f.tokens.user, mfaVerified: true}});
    expect(pending).toHaveBeenCalledWith({comparisonNumber: '42', expiresAtSec: f.expiresAt, origin: f.saved.origin});
    expect(getProfile('remembered')).toMatchObject({credentials: {accessToken: f.tokens.accessToken}, cliRecovery: old.cliRecovery});
    expect(getProfile('remembered')?.authGeneration).not.toBe(old.authGeneration);
    const starts = f.peer.request.mock.calls.filter(([x]) => x.path.endsWith('/start'));
    expect(starts).toHaveLength(1);
    expect(Object.keys(starts[0][0].body as object).sort()).toEqual(['codeChallenge', 'credential', 'grantId']);
    const complete = f.peer.request.mock.calls.find(([x]) => x.path.endsWith('/complete'))![0];
    expect(Object.keys(complete.body as object).sort()).toEqual(['claimant', 'codeVerifier', 'requestId']);
    const {createHash} = await import('node:crypto');
    expect(createHash('sha256').update((complete.body as {codeVerifier:string}).codeVerifier).digest('base64url'))
      .toBe((starts[0][0].body as {codeChallenge:string}).codeChallenge);
    expect(JSON.stringify(result)).not.toContain(f.saved.credential);expect(JSON.stringify(result)).not.toContain(f.tokens.accessToken);
    for (const [call] of f.peer.request.mock.calls) {
      expect(call.skipAuth).toBe(true);expect(call.skipAuthRefresh).toBe(true);expect(call.signal).toBeDefined();
      expect(call.path).not.toMatch(/unseal|user-sealed|device-login|cli\/token/);
    }
  });
  it.each(['pending', 'expired', 'api-key', 'environment', 'other-origin'])('refuses %s recovery before any request', async fault => {
    const f = recoveryPeer(), p = getProfile('remembered')!;
    if (fault === 'pending') p.cliRecovery!.state = 'revocation_pending';
    if (fault === 'expired') p.cliRecovery!.expiresAtSec = 1;
    if (fault === 'api-key') p.apiKey = 'public-synthetic-api-key';
    if (fault === 'other-origin') p.url = 'https://other.example.test';
    if (fault === 'environment') vi.stubEnv('ZNVAULT_USERNAME', 'fixture/alice');
    store.set('profiles', {remembered: p});invalidateAllProfileCaches();
    const {recoverCliLogin} = await import('../../src/lib/cli-recovery.js');
    expect(await recoverCliLogin(f.peer, {onPending: vi.fn(async () => {})})).toMatchObject({success: false});
    expect(f.peer.request).not.toHaveBeenCalled();
  });
  it.each(['new-login', 'delete-recreate', 'pending-retirement'])('does not restore a late completion after %s', async mutation => {
    const f = recoveryPeer(), original = f.peer.request.getMockImplementation()!;
    f.peer.request.mockImplementation(async options => {
      const result = await original(options);
      if (options.path.endsWith('/complete')) {
        const changed = profile();
        if (mutation === 'pending-retirement') {delete changed.credentials;changed.cliRecovery.state = 'revocation_pending';}
        store.set('profiles', {remembered: changed});invalidateAllProfileCaches();
      }
      return result;
    });
    const {recoverCliLogin} = await import('../../src/lib/cli-recovery.js');
    expect(await recoverCliLogin(f.peer, {onPending: vi.fn(async () => {})})).toMatchObject({success: false});
    expect(getProfile('remembered')?.credentials?.accessToken).not.toBe(f.tokens.accessToken);
  });
  it('does not store recovery tokens after an invocation TLS verification change', async () => {
    const f = recoveryPeer(), original = f.peer.request.getMockImplementation()!;
    let insecure = false;
    const peer = {...f.peer, getInsecure: () => insecure};
    f.peer.request.mockImplementation(async options => {const result = await original(options);if (options.path.endsWith('/complete')) insecure = true;return result;});
    const {recoverCliLogin} = await import('../../src/lib/cli-recovery.js');
    expect(await recoverCliLogin(peer, {onPending: vi.fn(async () => {})})).toMatchObject({success: false});
    expect(getProfile('remembered')?.credentials).toBeUndefined();
  });
  it('does not retry an uncertain complete and permits only a new explicit attempt', async () => {
    const f = recoveryPeer(), original = f.peer.request.getMockImplementation()!;
    f.peer.request.mockImplementation(async options => {
      if (options.path.endsWith('/complete')) throw new Error('private response content must never be displayed');
      return await original(options);
    });
    const {recoverCliLogin} = await import('../../src/lib/cli-recovery.js');
    const result = await recoverCliLogin(f.peer, {onPending: vi.fn(async () => {})});
    expect(result).toMatchObject({success: false});expect(JSON.stringify(result)).not.toContain('private response');
    expect(f.peer.request.mock.calls.filter(([x]) => x.path.endsWith('/complete'))).toHaveLength(1);
    expect(getProfile('remembered')?.credentials).toBeUndefined();
    expect(getProfile('remembered')?.cliRecovery).toEqual(f.saved);
  });
});

describe('retirement before replacing local profiles', () => {
  it('keeps an explicit invocation TLS pin and never restores a stored insecure mode', async () => {
    const {client} = await import('../../src/lib/client.js');const {HttpClient} = await import('../../src/lib/client/http.js');
    const p = getProfile('remembered')!;p.insecure = true;store.set('profiles',{remembered:p});invalidateAllProfileCaches();
    const pin = 'a'.repeat(64);vi.spyOn(client,'getTlsSpkiSha256').mockReturnValue(pin);
    let observed: {pin:string|null;insecure:boolean} | undefined;
    vi.spyOn(HttpClient.prototype,'request').mockImplementation(async function() {
      observed = {pin:this.getTlsSpkiSha256(),insecure:(this as unknown as {insecure:boolean}).insecure};return {revoked:true};
    });
    const {retireStoredCliRecovery} = await import('../../src/lib/cli-recovery.js');
    await retireStoredCliRecovery('remembered');
    expect(observed).toEqual({pin,insecure:false});
  });
  it('does not discard pending proof when invocation TLS pin changes while retirement is in flight', async () => {
    const {client} = await import('../../src/lib/client.js');const {HttpClient} = await import('../../src/lib/client/http.js');
    let pin = 'a'.repeat(64);vi.spyOn(client,'getTlsSpkiSha256').mockImplementation(() => pin);
    vi.spyOn(HttpClient.prototype,'request').mockImplementation(async () => {pin = 'b'.repeat(64);return {revoked:true};});
    const {retireStoredCliRecovery} = await import('../../src/lib/cli-recovery.js');
    await expect(retireStoredCliRecovery('remembered')).rejects.toThrow(/pending|changed/i);
    expect(getProfile('remembered')?.cliRecovery?.state).toBe('revocation_pending');
  });
  it.each([false, true])('retires expired-token grants at their stored origin; offline=%s', async offline => {
    const {HttpClient} = await import('../../src/lib/client/http.js');
    const before = getProfile('remembered')!, neighbor = getProfile('neighbor');
    vi.stubEnv('ZNVAULT_URL', 'https://wrong.example.test');
    const request = vi.spyOn(HttpClient.prototype, 'request').mockImplementation(async function(options) {
      expect(this.getBaseUrl()).toBe(before.cliRecovery!.origin);
      expect(options.path).toBe('/auth/cli/recovery/revoke');expect(options.skipAuth).toBe(true);expect(options.skipAuthRefresh).toBe(true);
      expect(options.body).toEqual({grantId: before.cliRecovery!.grantId, credential: before.cliRecovery!.credential});
      expect(getProfile('remembered')?.credentials).toBeUndefined();
      expect(getProfile('remembered')?.cliRecovery?.state).toBe('revocation_pending');
      if (offline) throw new Error('private unavailable response');
      return {revoked: true};
    });
    const {retireStoredCliRecovery} = await import('../../src/lib/cli-recovery.js');
    if (offline) {
      await expect(retireStoredCliRecovery('remembered')).rejects.toThrow(/pending/i);
      expect(() => deleteProfile('remembered')).toThrow();
      const remaining = getProfile('remembered')?.cliRecovery;
      expect(remaining).toEqual({state: 'revocation_pending', grantId: before.cliRecovery!.grantId, credential: before.cliRecovery!.credential,
        origin: before.cliRecovery!.origin, expiresAtSec: before.cliRecovery!.expiresAtSec});
    } else {
      await retireStoredCliRecovery('remembered');
      expect(getProfile('remembered')?.cliRecovery).toBeUndefined();
      expect(() => deleteProfile('remembered')).not.toThrow();
    }
    expect(request).toHaveBeenCalledTimes(1);expect(getProfile('neighbor')).toEqual(neighbor);
  });
});

describe('existing HTTP auth paths keep recovery authority separate', () => {
  it('honors the pre-prompt profile snapshot before sending a password login', async () => {
    const old = getProfile('remembered')!;delete old.cliRecovery;store.set('profiles',{remembered:old});invalidateAllProfileCaches();
    const expectedGeneration = old.authGeneration;
    const changed = {...old,authGeneration:randomUUID()};store.set('profiles',{remembered:changed});invalidateAllProfileCaches();
    const calls = await transport();const {HttpClient} = await import('../../src/lib/client/http.js');
    await expect(new HttpClient().login('fixture/alice','public-synthetic-input',undefined,current => {
      if (current.authGeneration !== expectedGeneration) throw new Error('Profile changed before authentication');
    })).rejects.toThrow(/changed/i);
    expect(calls).toEqual([]);
  });
  async function transport(replace?: () => void, status = 200, responseHeaders: Record<string, string> = {}) {
    const https = await import('node:https'), {EventEmitter} = await import('node:events');
    const calls: string[] = [];
    vi.spyOn(https.default, 'request').mockImplementation((options, callback) => {
      const o = options as import('node:https').RequestOptions;
      calls.push(String(o.path));
      const req = new EventEmitter() as import('node:events').EventEmitter & {write: () => void; end: () => void; destroy: () => void};
      req.write = () => {};req.destroy = () => {};
      req.end = () => {
        queueMicrotask(() => {
          replace?.();
          const res = new EventEmitter() as import('node:events').EventEmitter & {statusCode: number; headers: object};
          res.statusCode = status;res.headers = responseHeaders;
          (callback as (response: unknown) => void)(res);
          res.emit('data', JSON.stringify(status === 200 ? {accessToken: 'public-synthetic-new-access', refreshToken: 'public-synthetic-new-refresh',
            expiresIn: 900, user: {id: 'fixture-human', username: 'fixture/alice', role: 'user', tenantId: 'fixture'}} : {error: 'expired'}));
          res.emit('end');
        });
      };
      return req as unknown as ReturnType<typeof https.default.request>;
    });
    return calls;
  }
  it('does not send a push from an ordinary command whose refresh expires', async () => {
    const calls = await transport(undefined, 401);
    const {HttpClient} = await import('../../src/lib/client/http.js');
    await expect(new HttpClient().get('/v1/secrets')).rejects.toThrow(/login --recover/);
    expect(calls.length).toBeGreaterThan(0);
    expect(calls.every(path => path.endsWith('/auth/refresh'))).toBe(true);
    expect(getProfile('remembered')?.cliRecovery?.state).toBe('active');
  });
  it('preserves HTTP Retry-After without retrying or creating another request', async () => {
    const calls = await transport(undefined, 429, {'retry-after': '47'});
    const {HttpClient} = await import('../../src/lib/client/http.js');
    const {recoverCliLogin} = await import('../../src/lib/cli-recovery.js');
    const result = await recoverCliLogin(new HttpClient(), {onPending: vi.fn(async () => {})});
    expect(result).toMatchObject({success: false, error: expect.stringContaining('47 seconds')});
    expect(calls).toHaveLength(1);
  });
  it('preserves the original grant and deadline during a real ordinary refresh', async () => {
    const old = getProfile('remembered')!;await transport();
    const {HttpClient} = await import('../../src/lib/client/http.js');
    await new HttpClient().refreshToken({skipIfLive: false});
    expect(getProfile('remembered')).toMatchObject({credentials: {accessToken: 'public-synthetic-new-access'}, cliRecovery: old.cliRecovery,
      authGeneration: old.authGeneration});
  });
  it('does not let a late refresh overwrite a recovery or logout generation', async () => {
    await transport(() => {
      const newer = profile();newer.credentials.accessToken = 'newer-explicit-login';
      store.set('profiles', {remembered: newer});invalidateAllProfileCaches();
    });
    const {HttpClient} = await import('../../src/lib/client/http.js');
    await expect(new HttpClient().refreshToken({skipIfLive: false})).rejects.toThrow(/changed/i);
    expect(getProfile('remembered')?.credentials?.accessToken).toBe('newer-explicit-login');
  });
  it('requires retirement before a password or ambient automatic login can replace the bound account', async () => {
    const calls = await transport();
    const {HttpClient} = await import('../../src/lib/client/http.js');
    await expect(new HttpClient().login('fixture/other', 'public-synthetic-input')).rejects.toThrow(/retir|recovery|logout/i);
    expect(calls).toEqual([]);
  });
  it('does not let a late password login overwrite a newer authentication generation', async () => {
    const initial = getProfile('remembered')!;delete initial.cliRecovery;store.set('profiles', {remembered: initial});invalidateAllProfileCaches();
    await transport(() => {
      const newer = profile();delete newer.cliRecovery;newer.credentials.accessToken = 'newer-explicit-login';
      store.set('profiles', {remembered: newer});invalidateAllProfileCaches();
    });
    const {HttpClient} = await import('../../src/lib/client/http.js');
    await expect(new HttpClient().login('fixture/alice', 'public-synthetic-input')).rejects.toThrow(/changed/i);
    expect(getProfile('remembered')?.credentials?.accessToken).toBe('newer-explicit-login');
  });
});
