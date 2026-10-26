import {execFileSync} from 'node:child_process';
import {mkdtempSync, readFileSync, rmSync} from 'node:fs';
import {createServer, type Server} from 'node:https';
import type {AddressInfo} from 'node:net';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi} from 'vitest';
import type {RequestOptions} from '../../src/lib/client/types.js';

const auth = vi.hoisted(() => ({apiKey: false}));
vi.mock('../../src/lib/config.js', () => ({
  getConfig: () => ({url: 'https://localhost', insecure: true, timeout: 3000}),
  getCredentials: () => ({accessToken: 'synthetic-token', username: 'test', role: 'superadmin'}),
  getApiKey: () => auth.apiKey ? 'synthetic-api-key' : undefined,
  hasApiKey: () => auth.apiKey,
  isTokenExpired: () => false,
  hasEnvCredentials: () => false,
}));

import {HttpClient} from '../../src/lib/client/http.js';

interface Received {
  path: string | undefined;
  method: string | undefined;
  authorization: string | undefined;
  apiKey: string | string[] | undefined;
  contentType: string | undefined;
  idempotency: string | string[] | undefined;
  body: string;
}
let certDir: string;
let tls: {key: Buffer; cert: Buffer};
let server: Server;
let otherServer: Server;
let baseUrl: string;
let otherUrl: string;
let received: Received[];
let foreignCalls: number;
let redirectStatus: number;
let location: string | undefined;
let redirectAgain: boolean;
let directResponse: boolean;

async function listen(server: Server): Promise<string> {
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  return `https://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

beforeAll(() => {
  certDir = mkdtempSync(join(tmpdir(), 'znvault-cli-redirect-tls-'));
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1',
    '-subj', '/CN=localhost', '-keyout', join(certDir, 'key.pem'), '-out', join(certDir, 'cert.pem')], {stdio: 'ignore'});
  tls = {key: readFileSync(join(certDir, 'key.pem')), cert: readFileSync(join(certDir, 'cert.pem'))};
});
afterAll(() => {rmSync(certDir, {recursive: true, force: true});});
beforeEach(async () => {
  auth.apiKey = false;
  received = []; foreignCalls = 0; redirectStatus = 307;
  location = undefined; redirectAgain = false; directResponse = false;
  server = createServer(tls, (request, response) => {
    let body = '';
    request.on('data', (chunk: Buffer) => {body += chunk.toString();});
    request.on('end', () => {
      const item: Received = {
        path: request.url, method: request.method, authorization: request.headers.authorization,
        apiKey: request.headers['x-api-key'], contentType: request.headers['content-type'],
        idempotency: request.headers['idempotency-key'], body,
      };
      received.push(item);
      if (!directResponse && (redirectAgain || !request.url?.startsWith('/v1/superadmin/tenants'))) {
        response.writeHead(redirectStatus, location === undefined ? {} : {Location: location});
        response.end();
      } else {
        response.writeHead(200, {'Content-Type': 'application/json'});
        response.end(JSON.stringify({ok: true, item}));
      }
    });
  });
  otherServer = createServer(tls, (request, response) => {
    foreignCalls++; request.resume(); response.end('{}');
  });
  baseUrl = await listen(server); otherUrl = await listen(otherServer);
});
afterEach(async () => {
  await Promise.all([server, otherServer].map(s => new Promise<void>(resolve => {
    s.closeAllConnections(); s.close(() => resolve());
  })));
});

describe('real HTTPS tenant-management compatibility redirect', () => {
  it.each(['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const)('preserves %s, suffix, query, body and bearer authentication', async method => {
    location = '/v1/superadmin/tenants/tenant-b?withUsage=true&search=a%26b';
    const body = method === 'GET' || method === 'DELETE' ? undefined : {name: 'Changed', nested: {enabled: true}};
    const client = new HttpClient({baseUrl, insecure: true});
    const response = await client.request<{ok: boolean}>({
      method, path: '/v1/tenants/tenant-b', query: {withUsage: true, search: 'a&b'}, body,
      headers: {'Idempotency-Key': 'synthetic-request-id'},
    });
    expect(response.ok).toBe(true);
    expect(received).toHaveLength(2);
    expect(received[0]).toEqual({
      path: '/v1/tenants/tenant-b?withUsage=true&search=a%26b', method,
      authorization: 'Bearer synthetic-token', apiKey: undefined,
      contentType: body === undefined ? undefined : 'application/json', idempotency: 'synthetic-request-id',
      body: body === undefined ? '' : JSON.stringify(body),
    });
    expect(received[1]).toEqual({...received[0], path: location});
    expect(foreignCalls).toBe(0);
  });

  it('preserves API-key authentication and the collection path', async () => {
    auth.apiKey = true;
    location = `${baseUrl}/v1/superadmin/tenants`;
    const response = await new HttpClient({baseUrl, insecure: true}).get<{ok: boolean}>('/v1/tenants');
    expect(response.ok).toBe(true);
    expect(received.map(r => r.apiKey)).toEqual(['synthetic-api-key', 'synthetic-api-key']);
    expect(received.map(r => r.authorization)).toEqual([undefined, undefined]);
  });

  it('keeps ordinary same-tenant calls on the regular route when no redirect is returned', async () => {
    directResponse = true;
    const response = await new HttpClient({baseUrl, insecure: true}).get<{ok: boolean}>('/v1/tenants/tenant-a');
    expect(response.ok).toBe(true);
    expect(received.map(r => r.path)).toEqual(['/v1/tenants/tenant-a']);
  });

  it.each([
    ['external origin', () => `${otherUrl}/v1/superadmin/tenants/tenant-b`],
    ['protocol downgrade', () => baseUrl.replace('https:', 'http:') + '/v1/superadmin/tenants/tenant-b'],
    ['different tenant', () => '/v1/superadmin/tenants/tenant-c'],
    ['different suffix', () => '/v1/superadmin/tenants/tenant-b/usage'],
    ['changed query', () => '/v1/superadmin/tenants/tenant-b?tenantId=tenant-c'],
    ['other namespace', () => '/v1/superadmin/users'],
    ['missing location', () => undefined],
  ] as const)('rejects %s rather than silently reporting success', async (_name, target) => {
    location = target();
    await expect(new HttpClient({baseUrl, insecure: true}).get('/v1/tenants/tenant-b')).rejects.toThrow(/redirect/i);
    expect(received).toHaveLength(1);
    expect(foreignCalls).toBe(0);
  });

  it('rejects a second redirect without a third request', async () => {
    location = '/v1/superadmin/tenants/tenant-b'; redirectAgain = true;
    await expect(new HttpClient({baseUrl, insecure: true}).get('/v1/tenants/tenant-b')).rejects.toThrow(/redirect/i);
    expect(received).toHaveLength(2);
  });

  it('does not follow redirects from unrelated routes', async () => {
    location = '/v1/superadmin/tenants/tenant-b';
    await expect(new HttpClient({baseUrl, insecure: true}).get('/v1/secrets')).rejects.toThrow(/redirect/i);
    expect(received).toHaveLength(1);
  });

  it.each([301, 302, 303, 308])('rejects unsupported HTTP %s redirects', async status => {
    redirectStatus = status; location = '/v1/superadmin/tenants/tenant-b';
    await expect(new HttpClient({baseUrl, insecure: true}).get('/v1/tenants/tenant-b')).rejects.toThrow(/redirect/i);
    expect(received).toHaveLength(1);
  });
});
