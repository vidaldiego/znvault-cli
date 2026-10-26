import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import http from 'node:http';
import {createHash} from 'node:crypto';
import {mkdtempSync, readFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import type {AddressInfo} from 'node:net';
import type {StoredCredentials} from '../../src/types/index.js';

// Exercise the real profile serialization and real HTTP client. Only the
// browser launcher is replaced; callback and PKCE exchange use loopback HTTP.
vi.unmock('conf');
const {launchBrowser} = vi.hoisted(() => ({launchBrowser: vi.fn()}));
vi.mock('open', () => ({default: launchBrowser}));

interface Receipt {
  path: string;
  authorization?: string;
  body: Record<string, unknown>;
}

const AUTH_TIME = Math.floor(Date.now() / 1000) - 600;

function token(claims: Record<string, unknown>): string {
  return `${Buffer.from('{"alg":"HS256","typ":"JWT"}').toString('base64url')}.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.fixture-signature`;
}

function access(id: string, expiresIn: number, family = 'cli-family'): string {
  return token({sub: 'human', tenantId: 'fixture', username: 'fixture/alice', jti: id,
    refreshFamilyId: family, passwordAuthenticated: false, userSealedAuthMethod: 'passkey-prf',
    userSealedSessionKey: 'synthetic-capability', userSealedAuthTime: AUTH_TIME,
    exp: Math.floor(Date.now() / 1000) + expiresIn});
}

function refresh(id: string): string {
  return token({sub: 'human', type: 'refresh', jti: id});
}

describe('User-Sealed linked-passkey CLI session compatibility', () => {
  let server: http.Server;
  let configDir: string;
  let baseUrl: string;
  let browserUrl: URL | undefined;
  let receipts: Receipt[];
  let denyNextDecrypt: boolean;
  let currentAccess: string;
  let renewedAccess: string;
  let originalPrimary: StoredCredentials;

  beforeEach(async () => {
    configDir = mkdtempSync(join(tmpdir(), 'znvault-passkey-session-'));
    vi.stubEnv('ZNVAULT_CONFIG_DIR', configDir);
    vi.stubEnv('CI', '1');
    vi.stubEnv('ZNVAULT_NO_PLUGINS', '1');
    vi.stubEnv('ZNVAULT_NO_UPDATE_CHECK', '1');
    for (const name of ['ZNVAULT_URL', 'ZNVAULT_API_KEY', 'ZNVAULT_USERNAME', 'ZNVAULT_PASSWORD', 'ZNVAULT_PROFILE', 'ZNVAULT_INSECURE']) vi.stubEnv(name, undefined);
    receipts = [];
    browserUrl = undefined;
    denyNextDecrypt = false;
    currentAccess = access('web-login', 3600);
    renewedAccess = access('refreshed', 3600);
    server = http.createServer((request, response) => {
      let raw = '';
      request.on('data', (part: Buffer) => { raw += part.toString(); });
      request.on('end', () => {
        const body = raw ? JSON.parse(raw) as Record<string, unknown> : {};
        const path = request.url ?? '';
        receipts.push({path, authorization: request.headers.authorization, body});
        response.setHeader('Content-Type', 'application/json');
        if (path === '/auth/cli/token') {
          const validPkce = typeof body.codeVerifier === 'string' &&
            createHash('sha256').update(body.codeVerifier).digest('base64url') === browserUrl?.searchParams.get('code_challenge');
          if (!validPkce || body.code !== 'synthetic-code' || body.state !== browserUrl?.searchParams.get('state')) {
            response.writeHead(400).end('{"message":"Invalid fixture PKCE proof"}');
            return;
          }
          response.end(JSON.stringify({accessToken: currentAccess, refreshToken: refresh('refresh-1'), expiresIn: 3600,
            user: {id: 'human', username: 'fixture/alice', displayName: 'Alice', email: null, role: 'user', tenantId: 'fixture', mfaVerified: true}}));
        } else if (path === '/auth/refresh') {
          if (request.headers.authorization !== `Bearer ${currentAccess}` || body.refreshToken !== refresh('refresh-1')) {
            response.writeHead(401).end('{"message":"Wrong fixture refresh proof"}');
            return;
          }
          currentAccess = renewedAccess;
          response.end(JSON.stringify({accessToken: renewedAccess, refreshToken: refresh('refresh-2'), expiresIn: 3600, userSealedUnlocked: true,
            user: {id: 'human', username: 'fixture/alice', role: 'user', tenantId: 'fixture'}}));
        } else if (path === '/v1/secrets/synthetic/decrypt') {
          if (denyNextDecrypt) {
            denyNextDecrypt = false;
            response.writeHead(401).end('{"message":"Session requires refresh"}');
          } else if (request.headers.authorization !== `Bearer ${currentAccess}`) {
            response.writeHead(401).end('{"message":"Wrong fixture access token"}');
          } else {
            response.end('{"data":{"value":"synthetic-plaintext"}}');
          }
        } else {
          response.writeHead(404).end('{"message":"Unknown fixture route"}');
        }
      });
    });
    await new Promise<void>(resolve => { server.listen(0, '127.0.0.1', resolve); });
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    launchBrowser.mockReset().mockImplementation(async (url: string) => {
      browserUrl = new URL(url);
      const callback = new URL(browserUrl.searchParams.get('callback_uri') ?? '');
      callback.searchParams.set('state', browserUrl.searchParams.get('state') ?? '');
      callback.searchParams.set('code', 'synthetic-code');
      await new Promise<void>(resolve => { setImmediate(resolve); });
      // web-login deliberately destroys callback sockets after resolving its
      // local promise, so a socket-close response is acceptable to this launcher.
      await fetch(callback).catch(() => undefined);
    });
    const config = await import('../../src/lib/config.js');
    const {_resetStoreInstance} = await import('../../src/lib/config/store.js');
    _resetStoreInstance();
    config.invalidateAllProfileCaches();
    expect(config.getConfigPath().startsWith(configDir)).toBe(true);
    config.saveProfile('primary', {url: baseUrl, insecure: false, timeout: 3000});
    config.switchProfile('primary');
    originalPrimary = {accessToken: access('independent-primary', 3600, 'primary-family'), refreshToken: refresh('primary-refresh'),
      expiresAt: Date.now() + 3_600_000, userId: 'human', username: 'fixture/alice', role: 'user', tenantId: 'fixture'};
    config.storeCredentials(originalPrimary);
    config.saveProfile('selected', {url: baseUrl, insecure: false, timeout: 3000});
    config.setRuntimeProfile('selected');
  });

  afterEach(async () => {
    const config = await import('../../src/lib/config.js');
    const {_resetStoreInstance} = await import('../../src/lib/config/store.js');
    config.setRuntimeProfile(null);
    config.invalidateAllProfileCaches();
    _resetStoreInstance();
    server.closeAllConnections();
    await new Promise<void>(resolve => { server.close(() => { resolve(); }); });
    rmSync(configDir, {recursive: true, force: true});
    vi.unstubAllEnvs();
  });

  it('stores a passwordAuthenticated=false PRF JWT unchanged through web PKCE in only the selected profile', async () => {
    const {webLogin} = await import('../../src/lib/web-login.js');
    const config = await import('../../src/lib/config.js');
    expect(await webLogin(baseUrl)).toMatchObject({success: true, user: {id: 'human'}});
    expect(config.getCredentials()?.accessToken).toBe(currentAccess);
    expect(config.getCredentials()?.refreshToken).toBe(refresh('refresh-1'));
    const disk = JSON.parse(readFileSync(config.getConfigPath(), 'utf8')) as {profiles: Record<string, {credentials: StoredCredentials}>};
    expect(disk.profiles.selected.credentials.accessToken).toBe(currentAccess);
    expect(disk.profiles.primary.credentials).toEqual(originalPrimary);
    expect(receipts.map(receipt => receipt.path)).toEqual(['/auth/cli/token']);
    expect(receipts[0]?.authorization).toBeUndefined();
  });

  it.each(['expired-access', 'server-401'] as const)('forwards PRF provenance opaquely through %s refresh and decrypt without changing the other profile', async mode => {
    const {webLogin} = await import('../../src/lib/web-login.js');
    const {HttpClient} = await import('../../src/lib/client/http.js');
    const config = await import('../../src/lib/config.js');
    expect((await webLogin(baseUrl)).success).toBe(true);
    if (mode === 'expired-access') {
      currentAccess = access('expired-proof', -60);
      const credentials = config.getCredentials();
      if (!credentials) throw new Error('Fixture login did not store credentials');
      config.storeCredentials({...credentials, accessToken: currentAccess, expiresAt: Date.now() - 1});
    } else {
      denyNextDecrypt = true;
    }
    const presentedAccess = currentAccess;
    const result = await new HttpClient().post('/v1/secrets/synthetic/decrypt', {});

    expect(result).toEqual({data: {value: 'synthetic-plaintext'}});
    expect(receipts.filter(receipt => receipt.path === '/auth/refresh')).toEqual([{
      path: '/auth/refresh', authorization: `Bearer ${presentedAccess}`, body: {refreshToken: refresh('refresh-1')},
    }]);
    expect(config.getCredentials()).toMatchObject({accessToken: renewedAccess, refreshToken: refresh('refresh-2')});
    expect(config.getCredentials()?.pendingRefresh).toBeUndefined();
    expect(receipts.at(-1)?.authorization).toBe(`Bearer ${renewedAccess}`);
    config.setRuntimeProfile(null);
    expect(config.getCredentials()).toEqual(originalPrimary);
  });
});
