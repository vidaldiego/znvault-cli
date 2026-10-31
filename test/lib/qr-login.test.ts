import {createHash, generateKeyPairSync, randomBytes, randomUUID} from 'node:crypto';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import type {RequestOptions} from '../../src/lib/client/types.js';
import {qrLogin} from '../../src/lib/qr-login.js';

const state = vi.hoisted(() => ({
  active: 'offsite', runtime: null as string | null,
  profile: {} as Record<string, unknown>, writes: 0,
  beforeWrite: undefined as (() => void) | undefined,
}));
vi.mock('../../src/lib/config.js', async () => ({
  authenticationFingerprint: (await vi.importActual<typeof import('../../src/lib/config/profile.js')>('../../src/lib/config/profile.js')).authenticationFingerprint,
  beginProfileAuthentication: (_name: string, check: (profile: Record<string, unknown>) => void) => {
    check(structuredClone(state.profile));
    if (state.profile.cliRecovery) throw new Error('Retire recovery first');
    delete state.profile.credentials;state.profile.authGeneration = randomUUID();
    return structuredClone(state.profile);
  },
  cancelProfileAuthentication: (_name: string, generation: string) => {
    if (state.profile.authGeneration === generation) state.profile.authGeneration = randomUUID();
  },
  getActiveProfileName: () => state.runtime ?? state.active,
  getProfile: () => structuredClone(state.profile),
  setRuntimeProfile: (value: string | null) => {state.runtime = value;},
  invalidateProfileCache: vi.fn(),
  mutateProfileAuthentication: (_name: string, mutate: (profile: Record<string, unknown>) => Record<string, unknown>) => {
    state.beforeWrite?.();
    state.profile = mutate(structuredClone(state.profile)); state.writes++;
    return structuredClone(state.profile);
  },
}));
vi.mock('../../src/lib/config/store.js', () => ({getRuntimeProfile: () => state.runtime}));

const digest = (value: Uint8Array) => createHash('sha256').update(value).digest('hex');
function fixture(origin = 'https://vault-sec.example.test', superadmin = false) {
  const installationId = randomUUID(), challengeId = randomUUID(), requestId = randomUUID();
  const claimant = randomBytes(32).toString('base64url');
  const expiresAt = Math.floor(Date.now() / 1000) + 120;
  const user = {id: randomUUID(), username: 'fixture-human', role: superadmin ? 'superadmin' : 'admin', tenantId: superadmin ? null : 'fixture'};
  const primary = generateKeyPairSync('x25519').privateKey.export({type: 'pkcs8', format: 'der'});
  const tokens = {accessToken: randomBytes(32).toString('base64url'), refreshToken: randomBytes(32).toString('base64url'), expiresIn: 900, userSealedUnlocked: !superadmin, user};
  let point: Buffer;
  const request = vi.fn(async (options: RequestOptions): Promise<unknown> => {
    options.sessionGuard?.();
    if (options.path.endsWith('/protocol')) return {protocolVersion: 3, origin, installationId, deviceLogin: {version: 1, enabled: true}, cliRecovery: {version: 1, enabled: true}};
    if (options.path.endsWith('/start')) {
      point = Buffer.from((options.body as {browserPublicKey: string}).browserPublicKey, 'base64url');
      return {origin, installationId, requestId: challengeId, claimant, expiresAt};
    }
    if (options.path.endsWith('/status')) {
      if (superadmin) return {state: 'approved', expiresAt, transfer: ''};
      const {sealDeviceKey} = await import('../../src/lib/device-login/device-key-envelope.js');
      const context = {purpose: 'device-login-transfer' as const, origin, installationId, tenantId: 'fixture', userId: user.id,
        deviceId: randomUUID(), bindingId: randomUUID(), authEpoch: 1, keyVersion: 1, challengeId, requestId,
        initiatorHash: digest(Buffer.from(claimant)), browserKeyHash: digest(point)};
      const envelope = await sealDeviceKey(primary, {kty: 'EC', crv: 'P-256', x: point.subarray(1, 33).toString('base64url'), y: point.subarray(33).toString('base64url')}, context);
      return {state: 'approved', expiresAt, transferContext: context, transfer: Buffer.from(JSON.stringify(envelope)).toString('base64url')};
    }
    if (options.path.endsWith('/complete')) return tokens;
    if (options.path.endsWith('/cancel')) return {cancelled: true};
    throw new Error('Unexpected path');
  });
  const peer = {getBaseUrl: () => origin, request};
  state.profile = {url: origin, insecure: false, timeout: 1000, credentials: {accessToken: 'old-session', refreshToken: 'old-refresh'}};
  return {peer, origin, installationId, challengeId, claimant, expiresAt, user, tokens, primary,
    calls: (action: string) => request.mock.calls.filter(([value]) => value.path.endsWith('/' + action))};
}
describe('terminal QR device login', () => {
  beforeEach(() => {state.active = 'offsite'; state.runtime = null; state.writes = 0; state.beforeWrite = undefined;});
  afterEach(() => {vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllEnvs();});

  it.each([false, true])('automatically enrolls a fresh QR login without the remember flag (global=%s)', async superadmin => {
    const f = fixture(undefined, superadmin), pending = vi.fn();
    Object.assign(f.tokens, {cliRecovery: {grantId: randomUUID(), credential: randomBytes(32).toString('base64url'),
      origin: f.origin, installationId: f.installationId, expiresAtSec: Math.floor(Date.now()/1000) + 2592000}});
    expect(await qrLogin(f.peer, {rememberIphone: 'auto', onPending: pending})).toMatchObject({success: true, user: f.user});
    expect(f.calls('start')[0][0].body).toMatchObject({rememberIphone: true});
    expect(pending.mock.calls[0][0].rememberIphone).toBe(true);
    expect(state.profile.cliRecovery).toMatchObject({state: 'active', origin: f.origin});
  });

  it.each(['absent', 'disabled'])('auto login on %s recovery server does not claim enrollment', async capability => {
    const f = fixture(), original = f.peer.request.getMockImplementation()!, pending = vi.fn();
    f.peer.request.mockImplementation(async options => {
      const value = await original(options);
      if (!options.path.endsWith('/protocol')) return value;
      const result = value as Record<string, unknown>;
      if (capability === 'absent') delete result.cliRecovery;else result.cliRecovery = {version: 1, enabled: false};
      return result;
    });
    expect(await qrLogin(f.peer, {rememberIphone: 'auto', onPending: pending})).toMatchObject({success: true});
    expect(f.calls('start')[0][0].body).not.toHaveProperty('rememberIphone');
    expect(pending.mock.calls[0][0].rememberIphone).toBe(false);
    expect(state.profile.cliRecovery).toBeUndefined();
  });

  it.each([null, {}, {version: 2, enabled: true}, {version: 1, enabled: 'false'}])('does not downgrade malformed auto capability %j', async capability => {
    const f = fixture(), original = f.peer.request.getMockImplementation()!;
    f.peer.request.mockImplementation(async options => {
      const value = await original(options);
      return options.path.endsWith('/protocol') ? {...value as object, cliRecovery: capability} : value;
    });
    expect(await qrLogin(f.peer, {rememberIphone: 'auto', onPending: vi.fn()})).toMatchObject({success: false});
    expect(f.calls('start')).toHaveLength(0);
  });

  it('rejects an auto policy captured before another process opted out at the presenter handoff', async () => {
    const f = fixture();state.profile.cliRecoveryPreference = 'off';
    expect(await qrLogin(f.peer, {rememberIphone: 'auto', expectedPreference: null, onPending: vi.fn()})).toMatchObject({success: false});
    expect(f.calls('start')).toHaveLength(0);expect(state.writes).toBe(0);
  });
  it('invalidates an in-flight login when another process changes the remember preference', async () => {
    const f = fixture();state.profile.cliRecoveryPreference = 'auto';
    expect(await qrLogin(f.peer, {onPending: () => {state.profile.cliRecoveryPreference = 'off';}})).toMatchObject({success: false});
    expect(f.calls('complete')).toHaveLength(0);expect(state.writes).toBe(0);
  });

  it('requests signed recovery consent and stores enrollment atomically with the QR tokens', async () => {
    const f = fixture();
    const enrollment = {grantId: randomUUID(), credential: randomBytes(32).toString('base64url'), origin: f.origin,
      installationId: f.installationId, expiresAtSec: Math.floor(Date.now()/1000) + 2592000};
    Object.assign(f.tokens, {cliRecovery: enrollment});
    expect(await qrLogin(f.peer, {rememberIphone: true, onPending: vi.fn()})).toMatchObject({success: true});
    expect(f.calls('start')[0][0].body).toMatchObject({rememberIphone: true});
    expect(state.writes).toBe(1);
    expect(state.profile).toMatchObject({credentials: {accessToken: f.tokens.accessToken}, cliRecovery: {...enrollment, state: 'active'}});
  });

  it.each(['missing', 'unsolicited', 'credential', 'origin', 'installation', 'deadline', 'id'])('rejects %s recovery enrollment without installing a partial session', async fault => {
    const f = fixture();
    const enrollment: Record<string, unknown> = {grantId: randomUUID(), credential: randomBytes(32).toString('base64url'), origin: f.origin,
      installationId: f.installationId, expiresAtSec: Math.floor(Date.now()/1000) + 2592000};
    if (fault === 'credential') enrollment.credential = 'not-a-capability';
    if (fault === 'origin') enrollment.origin = 'https://elsewhere.example.test';
    if (fault === 'installation') enrollment.installationId = randomUUID();
    if (fault === 'deadline') enrollment.expiresAtSec = Math.floor(Date.now()/1000) + 31*86400;
    if (fault === 'id') enrollment.grantId = 'wrong-id';
    if (fault !== 'missing') Object.assign(f.tokens, {cliRecovery: enrollment});
    expect(await qrLogin(f.peer, {rememberIphone: fault !== 'unsolicited', onPending: vi.fn()})).toMatchObject({success: false});
    expect(state.writes).toBe(0);
    expect(state.profile.credentials).not.toEqual(expect.objectContaining({accessToken: f.tokens.accessToken}));
  });

  it('cannot install a late QR result after a profile was deleted and recreated with a new generation', async () => {
    const f = fixture();state.profile.authGeneration = randomUUID();
    const original = f.peer.request.getMockImplementation()!;
    f.peer.request.mockImplementation(async options => {
      const result = await original(options);
      if (options.path.endsWith('/complete')) state.profile.authGeneration = randomUUID();
      return result;
    });
    expect(await qrLogin(f.peer, {onPending: vi.fn()})).toMatchObject({success: false});
    expect(state.writes).toBe(0);
  });

  it.each(['https://vault.example.test', 'https://vault-sec.example.test'])('opens a fresh session on %s without browser credentials or approval grants', async origin => {
    const f = fixture(origin), pending = vi.fn();
    const result = await qrLogin(f.peer, {onPending: pending});
    expect(result).toMatchObject({success: true, user: {...f.user, mfaVerified: true}});
    const locator = new URL(pending.mock.calls[0][0].locator);
    expect(locator.protocol + '//' + locator.hostname).toBe('znvault-authenticator://login');
    expect([...locator.searchParams.keys()]).toEqual(['v', 'origin', 'installationId', 'challengeId']);
    expect(locator.searchParams.get('origin')).toBe(origin);
    expect(locator.searchParams.get('challengeId')).toBe(f.challengeId);
    expect(locator.toString()).not.toContain(f.claimant);
    const complete = f.calls('complete')[0][0];
    expect(Buffer.from((complete.body as {keyBytes: string}).keyBytes, 'base64url')).toEqual(f.primary);
    expect(Object.keys(complete.body as object)).toEqual(['requestId', 'claimant', 'keyBytes']);
    expect(state.writes).toBe(1);
    expect(state.profile.credentials).toMatchObject({accessToken: f.tokens.accessToken, username: f.user.username});
    for (const [call] of f.peer.request.mock.calls) {
      expect(call.skipAuth).toBe(true); expect(call.skipAuthRefresh).toBe(true);
      expect(call.headers?.['User-Agent']).toMatch(/^znvault-cli\//);
      expect(call.path).not.toMatch(/unseal|approval|authorize|token$/);
    }
    expect(state.runtime).toBeNull();
  });
  it('accepts the existing superadmin branch without a fictitious key transfer', async () => {
    const f = fixture(undefined, true);
    expect(await qrLogin(f.peer, {onPending: vi.fn()})).toMatchObject({success: true, user: {tenantId: null}});
    expect(f.calls('complete')[0][0].body).toEqual({requestId: f.challengeId, claimant: f.claimant});
  });
  it('rejects a nonempty superadmin transfer without context', async () => {
    const f = fixture(undefined, true), original = f.peer.request.getMockImplementation()!;
    f.peer.request.mockImplementation(async options => {
      const result = await original(options);
      return options.path.endsWith('/status') ? {state: 'approved', expiresAt: f.expiresAt, transfer: 'unexpected-data'} : result;
    });
    expect(await qrLogin(f.peer, {onPending: vi.fn()})).toMatchObject({success: false});
    expect(f.calls('complete')).toHaveLength(0); expect(state.writes).toBe(0);
  });
  it.each(['apiKey', 'environment'])('rejects conflicting %s authentication before starting', async source => {
    const f = fixture();
    if (source === 'apiKey') state.profile.apiKey = 'fixture-api-key';
    else vi.stubEnv('ZNVAULT_API_KEY', 'fixture-api-key');
    expect(await qrLogin(f.peer, {onPending: vi.fn()})).toMatchObject({success: false});
    expect(f.peer.request).not.toHaveBeenCalled();
  });
  it.each(['http://vault.example.test', 'https://user@vault.example.test', 'https://vault.example.test/path', 'https://vault.example.test/?redirect=x'])('rejects unsafe configured origin %s before network access', async origin => {
    const f = fixture(origin);
    expect(await qrLogin(f.peer, {onPending: vi.fn()})).toMatchObject({success: false});
    expect(f.peer.request).not.toHaveBeenCalled();
  });
  it.each(['origin', 'installationId', 'disabled'])('rejects changed protocol %s before start', async field => {
    const f = fixture(), original = f.peer.request.getMockImplementation()!;
    f.peer.request.mockImplementation(async options => {
      const result = await original(options) as Record<string, unknown>;
      if (!options.path.endsWith('/protocol')) return result;
      return {...result, ...(field === 'origin' ? {origin: 'https://other.example.test'} : field === 'installationId' ? {installationId: 'invalid'} : {deviceLogin: {version: 1, enabled: false}})};
    });
    expect(await qrLogin(f.peer, {onPending: vi.fn()})).toMatchObject({success: false});
    expect(f.calls('start')).toHaveLength(0);
  });
  it.each(['origin', 'installationId', 'challengeId', 'initiatorHash', 'browserKeyHash', 'purpose'])('rejects a transfer bound to a different %s', async field => {
    const f = fixture(), original = f.peer.request.getMockImplementation()!;
    f.peer.request.mockImplementation(async options => {
      const result = await original(options) as {transferContext?: Record<string, unknown>};
      if (options.path.endsWith('/status') && result.transferContext) {
        result.transferContext[field] = field === 'origin' ? 'https://other.example.test' : field.endsWith('Hash') ? '0'.repeat(64) : randomUUID();
      }
      return result;
    });
    expect(await qrLogin(f.peer, {onPending: vi.fn()})).toMatchObject({success: false});
    expect(f.calls('complete')).toHaveLength(0); expect(state.writes).toBe(0);
  });
  it('rejects a tampered envelope without completing or printing its contents', async () => {
    const f = fixture(), original = f.peer.request.getMockImplementation()!;
    f.peer.request.mockImplementation(async options => {
      const result = await original(options) as Record<string, unknown>;
      if (options.path.endsWith('/status')) result.transfer = Buffer.from('private-malformed-transfer').toString('base64url');
      return result;
    });
    const result = await qrLogin(f.peer, {onPending: vi.fn()});
    expect(result).toMatchObject({success: false}); expect(JSON.stringify(result)).not.toContain('private-malformed');
    expect(f.calls('complete')).toHaveLength(0);
  });
  it.each(['before-complete', 'inside-write'])('preserves another process login changed %s', async moment => {
    const f = fixture(), replacement = {accessToken: 'newer-session', refreshToken: 'newer-refresh'};
    if (moment === 'inside-write') state.beforeWrite = () => {state.profile.credentials = replacement;};
    else {
      const original = f.peer.request.getMockImplementation()!;
      f.peer.request.mockImplementation(async options => {
        const result = await original(options);
        if (options.path.endsWith('/status')) state.profile.credentials = replacement;
        return result;
      });
    }
    expect(await qrLogin(f.peer, {onPending: vi.fn()})).toMatchObject({success: false});
    expect(state.profile.credentials).toEqual(replacement); expect(state.writes).toBe(0);
    expect(f.calls('complete')).toHaveLength(moment === 'inside-write' ? 1 : 0);
  });
  it('keeps the captured named profile when the persisted active profile changes', async () => {
    const f = fixture();
    expect(await qrLogin(f.peer, {onPending: () => {state.active = 'principal';}})).toMatchObject({success: true});
    expect(state.writes).toBe(1); expect(state.runtime).toBeNull();
  });
  it('never retries complete after an uncertain response or restores the cleared old login', async () => {
    const f = fixture(), original = f.peer.request.getMockImplementation()!;
    f.peer.request.mockImplementation(async options => {
      if (options.path.endsWith('/complete')) throw new Error('private response ' + f.claimant);
      return await original(options);
    });
    const result = await qrLogin(f.peer, {onPending: vi.fn()});
    expect(result).toMatchObject({success: false}); expect(JSON.stringify(result)).not.toContain(f.claimant);
    expect(f.calls('complete')).toHaveLength(1); expect(f.calls('start')).toHaveLength(1);
    expect(state.profile.credentials).toBeUndefined(); expect(state.writes).toBe(0);
  });
  it.each(['id', 'tenantId'])('rejects a completion identity inconsistent with transfer %s', async field => {
    const f = fixture(), original = f.peer.request.getMockImplementation()!;
    f.peer.request.mockImplementation(async options => {
      const result = await original(options);
      return options.path.endsWith('/complete') ? {...f.tokens, user: {...f.user, [field]: 'another-owner'}} : result;
    });
    expect(await qrLogin(f.peer, {onPending: vi.fn()})).toMatchObject({success: false});
    expect(state.writes).toBe(0);
  });
  it('reports storage failure without claiming a persisted session', async () => {
    const f = fixture();
    state.beforeWrite = () => {throw new Error('fixture disk unavailable');};
    expect(await qrLogin(f.peer, {onPending: vi.fn()})).toMatchObject({success: false});
    expect(state.profile.credentials).toBeUndefined(); expect(state.writes).toBe(0);
  });
  it('cancels from the pending presentation without polling or storing', async () => {
    const f = fixture(), controller = new AbortController();
    expect(await qrLogin(f.peer, {onPending: () => {controller.abort();}, signal: controller.signal})).toMatchObject({success: false});
    expect(f.calls('status')).toHaveLength(0); expect(f.calls('cancel')).toHaveLength(1); expect(state.writes).toBe(0);
  });
  it.each(['denied', 'expired', 'cancelled', 'unknown-state'])('ends a %s attempt without storing credentials', async value => {
    const f = fixture(), original = f.peer.request.getMockImplementation()!;
    f.peer.request.mockImplementation(async options => options.path.endsWith('/status') ? {state: value, expiresAt: f.expiresAt} : await original(options));
    expect(await qrLogin(f.peer, {onPending: vi.fn()})).toMatchObject({success: false});
    expect(f.calls('complete')).toHaveLength(0); expect(state.writes).toBe(0);
  });
  it('aborts a late completion without a write', async () => {
    const f = fixture(), controller = new AbortController(), original = f.peer.request.getMockImplementation()!;
    f.peer.request.mockImplementation(async options => {
      const result = await original(options);
      if (options.path.endsWith('/complete')) controller.abort();
      return result;
    });
    expect(await qrLogin(f.peer, {onPending: vi.fn(), signal: controller.signal})).toMatchObject({success: false});
    expect(state.writes).toBe(0);
  });
  it('does not start when already cancelled', async () => {
    const f = fixture(), controller = new AbortController(); controller.abort();
    expect(await qrLogin(f.peer, {onPending: vi.fn(), signal: controller.signal})).toMatchObject({success: false});
    expect(f.peer.request).not.toHaveBeenCalled();
  });
  it('does not send the old claimant after a concurrent TLS/profile change', async () => {
    const f = fixture(), original = f.peer.request.getMockImplementation()!;
    f.peer.request.mockImplementation(async options => {
      const result = await original(options);
      if (options.path.endsWith('/status')) state.profile.insecure = true;
      return result;
    });
    expect(await qrLogin(f.peer, {onPending: vi.fn()})).toMatchObject({success: false});
    expect(f.calls('cancel')).toHaveLength(0);
    expect(state.writes).toBe(0);
  });
  it('polls serially and stops at the original deadline without extending it', async () => {
    const f = fixture(), original = f.peer.request.getMockImplementation()!, startedAt = Date.now();
    let polls = 0;
    f.peer.request.mockImplementation(async options => {
      if (!options.path.endsWith('/status')) return await original(options);
      if (++polls === 2) vi.spyOn(Date, 'now').mockReturnValue(startedAt + 125000);
      return {state: 'pending', expiresAt: f.expiresAt};
    });
    expect(await qrLogin(f.peer, {onPending: vi.fn()})).toMatchObject({success: false});
    expect(f.calls('status')).toHaveLength(2);
    expect(f.calls('start')).toHaveLength(1); expect(f.calls('complete')).toHaveLength(0); expect(state.writes).toBe(0);
  });
});
