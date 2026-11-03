import {execFileSync} from 'node:child_process';
import {EventEmitter} from 'node:events';
import {mkdtempSync, readFileSync, rmSync} from 'node:fs';
import http from 'node:http';
import {createServer, type Server, type AddressInfo, type Socket} from 'node:net';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createServer as createTlsServer, type Server as TlsServer} from 'node:tls';
import {afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi} from 'vitest';
import type {FullConfig, StoredCredentials} from '../../src/types/index.js';
import type {ClientConfig} from '../../src/lib/client/types.js';

const state = vi.hoisted(() => ({
  config: {url: 'http://127.0.0.1', insecure: false, timeout: 1000} as FullConfig,
  credentials: undefined as StoredCredentials | undefined,
  stores: 0,
  markers: 0,
  releases: 0,
}));
vi.mock('../../src/lib/config.js', () => ({
  getConfig: () => state.config,
  getCredentials: () => state.credentials,
  hasApiKey: () => false,
  getApiKey: () => undefined,
  hasEnvCredentials: () => false,
  isTokenExpired: () => (state.credentials?.expiresAt ?? Infinity) < Date.now(),
  getActiveProfileName: () => 'isolated-fixture',
  authenticationFingerprint: () => 'synthetic-stable-generation',
  invalidateProfileCache: () => {},
  decodeRefreshJti: () => 'synthetic-jti',
  decidePendingRefresh: () => ({action: 'none'}),
  writePendingRefreshMarker: (_jti: string, guard?: () => void) => {
    guard?.();state.markers++;
    if (state.credentials) state.credentials.pendingRefresh = {presentedJti: 'synthetic-jti', startedAt: 1};
  },
  storeCredentials: (credentials: StoredCredentials, beforeWrite?: () => void) => {
    beforeWrite?.();state.stores++;state.credentials = credentials;
  },
}));
vi.mock('../../src/lib/client/refresh-lock.js', () => ({
  computeLockKey: () => 'synthetic-lock',
  acquireRefreshLock: () => Promise.resolve({
    lockKey: 'synthetic-lock',
    release: () => {state.releases++;return Promise.resolve();},
  }),
}));
vi.mock('../../src/lib/output.js', () => ({warn: () => {}}));

import {configureAutomaticRecovery, HttpClient, RefreshHardReauthError} from '../../src/lib/client/http.js';

interface WireResponse {
  status: string;
  body?: string;
  location?: string;
  holdOpen?: boolean;
}
const dto = JSON.stringify({certificate: 'synthetic-certificate'});
const refreshDto = JSON.stringify({accessToken: 'synthetic-access-next', refreshToken: 'synthetic-refresh-next', expiresIn: 3600});
const canary = 'c1-private-canary';
const pkiPath = '/v1/pki/certificates/fixture';
let server: Server;
let tlsServer: TlsServer;
let baseUrl: string;
let tlsUrl: string;
let certDir: string;
let tls: {key: Buffer; cert: Buffer};
let respond: (path: string, index: number) => WireResponse;
let paths: string[];
const sockets = new Set<Socket>();

function track(socket: Socket): void {
  sockets.add(socket);
  socket.on('error', () => {});
  socket.on('close', () => sockets.delete(socket));
}
function serve(socket: Socket): void {
  track(socket);
  let headers = '';
  const onData = (chunk: Buffer): void => {
    headers += chunk.toString();
    if (!headers.includes('\r\n\r\n')) return;
    socket.removeListener('data', onData);
    const path = headers.split('\r\n', 1)[0].split(' ')[1];
    paths.push(path);
    const response = respond(path, paths.length);
    const body = response.body ?? dto;
    const wire = `HTTP/1.1 ${response.status} Fixture\r\nContent-Type: application/json\r\nContent-Length: ${response.holdOpen ? 1000000 : Buffer.byteLength(body)}\r\nConnection: close\r\n${response.location ? `Location: ${response.location}\r\n` : ''}\r\n`;
    if (response.holdOpen) socket.write(wire);
    else socket.end(wire + body);
  };
  socket.on('data', onData);
}
async function listen(listener: Server | TlsServer, protocol: string): Promise<string> {
  await new Promise<void>(resolve => listener.listen(0, '127.0.0.1', resolve));
  return `${protocol}://127.0.0.1:${(listener.address() as AddressInfo).port}`;
}
function strict(url = baseUrl): HttpClient {
  return new HttpClient({baseUrl: url, insecure: url.startsWith('https:'), responsePolicy: 'strict-2xx'});
}
function credentials(expired = false): void {
  state.credentials = {
    accessToken: 'synthetic-access', refreshToken: 'synthetic-refresh', expiresAt: expired ? 1 : Date.now() + 3600000,
    userId: 'synthetic-user', username: 'fixture', role: 'user', tenantId: 'synthetic-tenant',
  };
}
async function capture(operation: Promise<unknown>): Promise<unknown> {
  return operation.then(() => undefined, (error: unknown) => error);
}
function assertClosedError(error: unknown, status?: number): void {
  expect(error instanceof Error).toBe(true);
  const fields = error as Error & {code?: unknown; statusCode?: unknown};
  // Compare booleans so a regression never prints remote text or an error object.
  expect(fields.name === 'HttpResponseStatusError').toBe(true);
  expect(fields.message === 'HTTP response rejected').toBe(true);
  expect(fields.code === 'HTTP_STATUS_REJECTED').toBe(true);
  expect(fields.statusCode).toBe(status);
  expect(Object.hasOwn(fields, 'statusCode')).toBe(status !== undefined);
  expect(Object.getOwnPropertyNames(fields).every(key => ['stack', 'message', 'name', 'code', 'statusCode'].includes(key))).toBe(true);
  const serialized = JSON.stringify(fields, Object.getOwnPropertyNames(fields));
  expect(serialized.includes(canary)).toBe(false);
}
async function rejected(operation: Promise<unknown>, status?: number): Promise<void> {
  assertClosedError(await capture(operation), status);
}

beforeAll(() => {
  certDir = mkdtempSync(join(tmpdir(), 'znvault-c1-tls-'));
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1',
    '-subj', '/CN=localhost', '-keyout', join(certDir, 'key.pem'), '-out', join(certDir, 'cert.pem')], {stdio: 'ignore'});
  tls = {key: readFileSync(join(certDir, 'key.pem')), cert: readFileSync(join(certDir, 'cert.pem'))};
});
afterAll(() => {rmSync(certDir, {recursive: true, force: true});});
beforeEach(async () => {
  paths = [];
  respond = () => ({status: '200'});
  state.config = {url: 'http://127.0.0.1', insecure: false, timeout: 1000};
  state.credentials = undefined;state.stores = 0;state.markers = 0;state.releases = 0;
  configureAutomaticRecovery(null);
  server = createServer(serve);
  tlsServer = createTlsServer(tls, serve);
  tlsServer.on('connection', track);
  baseUrl = await listen(server, 'http');tlsUrl = await listen(tlsServer, 'https');
  state.config.url = baseUrl;
});
afterEach(async () => {
  configureAutomaticRecovery(null);
  vi.restoreAllMocks();
  for (const socket of sockets) socket.destroy();
  await Promise.all([server, tlsServer].map(listener => new Promise<void>(resolve => listener.close(() => resolve()))));
});

describe('strict HTTP response policy', () => {
  it.each(['000', '099'])('rejects real raw %s even with a valid JSON DTO', async status => {
    respond = () => ({status});
    await rejected(strict().get(pkiPath));
    expect(paths).toEqual([pkiPath]);
  });
  it.each(['000', '099'])('rejects real HTTPS raw %s with a valid DTO', async status => {
    respond = () => ({status});
    await rejected(strict(tlsUrl).get(pkiPath));
  });
  it.each(['100', '103', '199'])('does not turn final informational %s into success', async status => {
    respond = () => ({status, body: ''});
    const error = await capture(strict().get(pkiPath));
    expect(error instanceof Error).toBe(true);
    expect(paths).toEqual([pkiPath]);
    // Node's parser may fail before a final-response callback; C2 normalizes it.
    expect(state.stores).toBe(0);
  });
  it.each([200, 201, 204, 299])('preserves successful HTTP %s semantics', async status => {
    respond = () => ({status: String(status), body: status === 204 ? '' : dto});
    const response = await strict().get(pkiPath);
    expect(response).toEqual(status === 204 ? undefined : {certificate: 'synthetic-certificate'});
  });
  it('preserves successful raw-string fallback', async () => {
    respond = () => ({status: '200', body: '"synthetic text'});
    expect(await strict().get(pkiPath)).toBe('"synthetic text');
  });
  it.each([301, 302, 303, 307, 308].flatMap(status =>
    ['dto', 'html', 'malformed'].map(body => ({status, body}))))('rejects $status with $body without following or reflecting it', async ({status, body}) => {
    const bodies: Record<string, string> = {dto, html: `<html>${canary}</html>`, malformed: `{${canary}`};
    respond = () => ({status: String(status), body: bodies[body], location: `${tlsUrl}/${canary}`});
    await rejected(strict(tlsUrl).get(pkiPath), status);
    expect(paths).toEqual([pkiPath]);
  });
  it.each([400, 401, 403, 409, 429, 500, 503, 599])('rejects HTTP %s without remote error fields', async status => {
    respond = () => ({status: String(status), body: JSON.stringify({message: canary, code: canary, details: canary, steps: [canary]}), location: `/${canary}`});
    await rejected(strict().get(pkiPath), status);
  });
  it.each([301, 401, 409, 500])('closes an unfinished HTTP %s body immediately', async status => {
    respond = () => ({status: String(status), holdOpen: true, location: `/${canary}`});
    await rejected(strict(tlsUrl).get(pkiPath), status);
    await vi.waitFor(() => {expect(sockets.size).toBe(0);});
  });
  it('keeps legacy default and explicit legacy independent of a simultaneous strict client', async () => {
    respond = () => ({status: '099'});
    const [defaultResult, explicitResult, strictError] = await Promise.all([
      new HttpClient({baseUrl}).get(pkiPath), new HttpClient({baseUrl, responsePolicy: 'legacy'}).get(pkiPath), capture(strict().get(pkiPath)),
    ]);
    expect(defaultResult).toEqual({certificate: 'synthetic-certificate'});
    expect(explicitResult).toEqual(defaultResult);
    assertClosedError(strictError);
  });
  it('preserves the exact legacy tenant 307 while strict rejects it', async () => {
    respond = path => path === '/v1/tenants/fixture'
      ? {status: '307', location: '/v1/superadmin/tenants/fixture'} : {status: '200'};
    expect(await new HttpClient({baseUrl}).get('/v1/tenants/fixture')).toEqual({certificate: 'synthetic-certificate'});
    expect(paths).toEqual(['/v1/tenants/fixture', '/v1/superadmin/tenants/fixture']);
    paths = [];
    await rejected(strict().get('/v1/tenants/fixture'), 307);
    expect(paths).toEqual(['/v1/tenants/fixture']);
  });
  it('keeps strict across facade children and configure without contaminating the singleton', async () => {
    const {VaultClient, client: singleton} = await import('../../src/lib/client/index.js');
    respond = () => ({status: '099'});
    const facade = new VaultClient({baseUrl, responsePolicy: 'strict-2xx'});
    await rejected(facade.health());
    facade.configure(tlsUrl, true);
    await rejected(facade.health());
    expect(await singleton.health()).toEqual({certificate: 'synthetic-certificate'});
  });
  it('captures the policy at construction rather than retaining mutable caller config', async () => {
    const config: Partial<ClientConfig> = {baseUrl, responsePolicy: 'strict-2xx'};
    const client = new HttpClient(config);
    config.responsePolicy = 'legacy';client.configure(baseUrl, false);
    respond = () => ({status: '099'});
    await rejected(client.get(pkiPath));
  });
  it.each(['unknown', '', null, false, 0])('fails closed for an unknown explicit constructor policy %#', policy => {
    const error = (() => {
      try {new HttpClient({baseUrl, responsePolicy: policy} as unknown as Partial<ClientConfig>);return undefined;}
      catch (caught: unknown) {return caught;}
    })();
    expect(error instanceof Error).toBe(true);
    expect(paths).toHaveLength(0);
  });
  it.each([undefined, NaN, 199.5, 200.5, -1, 99, 600])('omits invalid or non-HTTP status from a constructor transport seam %#', async status => {
    const response = Object.assign(new EventEmitter(), {
      statusCode: status,
      destroy(): void {queueMicrotask(() => response.emit('error', new Error('Synthetic late close')));},
    });
    Object.defineProperty(response, 'headers', {get(): never {throw new Error('Response headers must remain unread');}});
    const request = Object.assign(new EventEmitter(), {
      end(): void {queueMicrotask(() => callback(response as unknown as http.IncomingMessage));},
      write(): void {},
    });
    let callback: (res: http.IncomingMessage) => void;
    vi.spyOn(http, 'request').mockImplementation((_options, suppliedCallback) => {
      callback = suppliedCallback as (res: http.IncomingMessage) => void;
      return request as unknown as http.ClientRequest;
    });
    await rejected(strict().get(pkiPath));
    expect(response.listenerCount('data')).toBe(0);
  });
});

describe('strict refresh, replay and existing session guards', () => {
  it('refreshes proactively and stores only the 2xx result before the application request', async () => {
    credentials(true);
    respond = path => ({status: '200', body: path === '/auth/refresh' ? refreshDto : dto});
    expect(await strict().get(pkiPath)).toEqual({certificate: 'synthetic-certificate'});
    expect(paths).toEqual(['/auth/refresh', pkiPath]);
    expect(state.stores).toBe(1);expect(state.markers).toBe(1);expect(state.releases).toBe(1);
    expect(state.credentials?.pendingRefresh).toBeUndefined();
  });
  it('refreshes once after 401 and replays a safe GET once', async () => {
    credentials();
    respond = (path, index) => path === '/auth/refresh'
      ? {status: '200', body: refreshDto} : {status: index === 1 ? '401' : '201', body: dto};
    expect(await strict().get(pkiPath)).toEqual({certificate: 'synthetic-certificate'});
    expect(paths).toEqual([pkiPath, '/auth/refresh', pkiPath]);expect(state.stores).toBe(1);
  });
  it.each(['000', '099', '301', '302', '303', '307', '308'])('never stores tokens from proactive refresh raw %s plus valid DTO', async status => {
    credentials(true);respond = () => ({status, body: refreshDto, location: '/v1/superadmin/tenants'});
    await rejected(strict().get(pkiPath), Number(status) >= 100 ? Number(status) : undefined);
    expect(paths).toEqual(['/auth/refresh']);expect(state.stores).toBe(0);expect(state.releases).toBe(1);
    expect(state.credentials?.pendingRefresh !== undefined).toBe(true);
  });
  it.each(['000', '099', '301', '302', '303', '307', '308'])('never stores tokens from reactive refresh raw %s plus valid DTO', async status => {
    credentials();respond = path => ({status: path === '/auth/refresh' ? status : '401', body: refreshDto, location: '/v1/superadmin/tenants'});
    await rejected(strict().get(pkiPath), Number(status) >= 100 ? Number(status) : undefined);
    expect(paths).toEqual([pkiPath, '/auth/refresh']);expect(state.stores).toBe(0);
  });
  it('rejects a replay redirect without another refresh or request', async () => {
    credentials();respond = (path, index) => path === '/auth/refresh'
      ? {status: '200', body: refreshDto} : {status: index === 1 ? '401' : '307', location: '/v1/superadmin/tenants', body: dto};
    await rejected(strict().get(pkiPath), 307);
    expect(paths).toEqual([pkiPath, '/auth/refresh', pkiPath]);expect(state.stores).toBe(1);
  });
  it('stops after one refresh when the replay also returns 401', async () => {
    credentials();respond = path => path === '/auth/refresh' ? {status: '200', body: refreshDto} : {status: '401'};
    await rejected(strict().get(pkiPath), 401);
    expect(paths).toEqual([pkiPath, '/auth/refresh', pkiPath]);expect(state.stores).toBe(1);
  });
  it('preserves terminal refresh conflict classification even with a malformed body', async () => {
    credentials(true);respond = () => ({status: '409', body: `{${canary}`});
    const error = await capture(strict().get(pkiPath));
    expect(error instanceof RefreshHardReauthError).toBe(true);
    const fields = error as Error & {statusCode?: unknown};
    expect(fields.name === 'RefreshHardReauthError').toBe(true);
    expect(fields.statusCode).toBe(409);
    expect(paths).toEqual(['/auth/refresh']);expect(state.stores).toBe(0);
    expect(JSON.stringify(fields).includes(canary)).toBe(false);
  });
  it('retries refresh conflict only once with a different peer token', async () => {
    credentials(true);
    respond = (_path, index) => {
      if (state.credentials) state.credentials = {...state.credentials, refreshToken: 'synthetic-peer-refresh', pendingRefresh: undefined};
      return {status: '409', body: index === 1 ? `{${canary}` : '<html>fixture</html>'};
    };
    const error = await capture(strict().get(pkiPath));
    expect(error instanceof RefreshHardReauthError).toBe(true);
    expect((error as {statusCode?: unknown}).statusCode).toBe(409);
    expect(paths).toEqual(['/auth/refresh', '/auth/refresh']);expect(state.stores).toBe(0);
  });
  it('does not wrap a strict refresh rejection with a cause under active recovery configuration', async () => {
    credentials(true);state.config.cliRecovery = {state: 'active', grantId: 'fixture-grant', credential: 'synthetic-recovery', origin: baseUrl, expiresAtSec: 1};
    respond = () => ({status: '503', body: JSON.stringify({message: canary})});
    await rejected(strict().request({method: 'GET', path: pkiPath, sessionGuard: () => {}}), 503);
    expect(paths).toEqual(['/auth/refresh']);expect(state.stores).toBe(0);
  });
  it.each(['guard', 'skipAuthRefresh'])('does not refresh or recover a reactive 401 with %s', async mode => {
    credentials();state.config.cliRecovery = {state: 'active', grantId: 'fixture-grant', credential: 'synthetic-recovery', origin: baseUrl, expiresAtSec: 1};
    let presentations = 0;
    configureAutomaticRecovery({present: () => {presentations++;return Promise.reject(new Error('Unexpected recovery'));}});
    respond = () => ({status: '401'});
    await rejected(strict().request({method: 'GET', path: pkiPath, ...(mode === 'guard' ? {sessionGuard: () => {}} : {skipAuthRefresh: true}), recoveryReplaySafe: true}), 401);
    expect(paths).toEqual([pkiPath]);expect(state.stores).toBe(0);expect(presentations).toBe(0);
  });
  it('does not reissue an unsafe POST after a successful reactive refresh', async () => {
    credentials();respond = path => path === '/auth/refresh' ? {status: '200', body: refreshDto} : {status: '401'};
    const error = await capture(strict().request({method: 'POST', path: pkiPath, body: {fixture: true}}));
    expect((error as {statusCode?: unknown}).statusCode).toBe(401);
    expect(paths).toEqual([pkiPath, '/auth/refresh']);expect(state.stores).toBe(1);
  });
  it('retains explicit recoveryReplaySafe replay permission for a POST', async () => {
    credentials();respond = (path, index) => path === '/auth/refresh'
      ? {status: '200', body: refreshDto} : {status: index === 1 ? '401' : '200'};
    expect(await strict().request({method: 'POST', path: pkiPath, recoveryReplaySafe: true})).toEqual({certificate: 'synthetic-certificate'});
    expect(paths).toEqual([pkiPath, '/auth/refresh', pkiPath]);
  });
  it('still allows proactive refresh with skipAuthRefresh and a checked candidate guard', async () => {
    credentials(true);let candidates = 0;
    respond = path => ({status: '200', body: path === '/auth/refresh' ? refreshDto : dto});
    await strict().request({method: 'GET', path: pkiPath, skipAuthRefresh: true, sessionGuard: candidate => {if (candidate !== undefined) candidates++;}});
    expect(paths).toEqual(['/auth/refresh', pkiPath]);expect(state.stores).toBe(1);expect(candidates).toBe(1);
  });
  it('honors candidate guard rejection before token persistence', async () => {
    credentials(true);respond = () => ({status: '200', body: refreshDto});
    const error = await capture(strict().request({method: 'GET', path: pkiPath, sessionGuard: candidate => {
      if (candidate !== undefined) throw new Error('Synthetic candidate rejected');
    }}));
    expect(error instanceof Error).toBe(true);
    expect(paths).toEqual(['/auth/refresh']);expect(state.stores).toBe(0);expect(state.releases).toBe(1);
  });
});
