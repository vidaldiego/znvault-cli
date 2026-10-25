import {spawn} from 'node:child_process';
import {createServer, type Server} from 'node:http';
import {mkdtemp, readFile, readdir, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterEach, beforeEach, describe, expect, it} from 'vitest';

// Exercise the distributable entry point with real stdin, HTTP and filesystem
// boundaries. The only API is an isolated in-memory synthetic fixture server.
const seed = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
const id = '12345678-1234-1234-1234-123456789abc';
const totp = {type: 'totp', secret: seed, algorithm: 'SHA1', digits: 6, period: 30};
const meta = {id, alias: 'lab/authenticator', tenant: 'lab', type: 'credential', subType: 'password', version: 99, protectionMode: 'STANDARD', createdAt: '2026-01-01', updatedAt: '2026-01-01'};
let data: Record<string, unknown>;
let directory: string;
let server: Server;
let url: string;
let status: number;
let requests: {method: string; url: string; data: Record<string, unknown>; apiKey?: string}[];

async function files(directoryPath: string): Promise<string[]> {
  const entries = await readdir(directoryPath, {withFileTypes: true});
  const contents = await Promise.all(entries.map(entry => entry.isDirectory() ? files(join(directoryPath, entry.name)) : readFile(join(directoryPath, entry.name), 'utf8').then(value => [value])));
  return contents.flat();
}

async function cli(args: string[], stdin = '', authentication: 'api-key' | 'user' = 'api-key'): Promise<{code: number | null; stdout: string; stderr: string}> {
  const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.startsWith('ZNVAULT_') && name !== 'DATABASE_URL'));
  if (authentication === 'user') {
    await writeFile(join(directory, 'config.json'), JSON.stringify({activeProfile: 'default', plugins: [], profiles: {default: {
      url, insecure: false, timeout: 30000, credentials: {accessToken: 'synthetic-test-access-token', refreshToken: 'synthetic-test-refresh-token', expiresAt: Date.now() + 3600000, userId: 'synthetic-user', username: 'alice', role: 'user', tenantId: 'lab'},
    }}}), {mode: 0o600});
  }
  const child = spawn(process.execPath, ['dist/index.js', '--no-plugins', '--url', url, ...args], {
    cwd: process.cwd(),
    env: {...env, CI: '1', ZNVAULT_CONFIG_DIR: directory, ZNVAULT_NO_PLUGINS: '1', ZNVAULT_NO_UPDATE_CHECK: '1', ...(authentication === 'api-key' ? {ZNVAULT_API_KEY: 'synthetic-test-api-key'} : {})},
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', chunk => {stdout += String(chunk);});
  child.stderr.on('data', chunk => {stderr += String(chunk);});
  child.stdin.on('error', () => {});
  child.stdin.end(stdin);
  const code = await new Promise<number | null>((resolve, reject) => {child.once('close', resolve); child.once('error', reject);});
  return {code, stdout, stderr};
}

beforeEach(async () => {
  data = {username: 'alice', password: '${ref:db/account#password}', keep: {nested: true}, totp};
  requests = [];
  status = 200;
  directory = await mkdtemp(join(tmpdir(), 'znvault-totp-process-'));
  server = createServer(async (request, response) => {
    let body = '';
    for await (const chunk of request) body += String(chunk);
    const input = body ? JSON.parse(body) as Record<string, unknown> : {};
    requests.push({method: request.method ?? '', url: request.url ?? '', data: input, apiKey: request.headers['x-api-key'] as string | undefined});
    response.setHeader('Content-Type', 'application/json');
    if (request.url?.includes('/decrypt')) {
      response.end(JSON.stringify({...meta, version: 7, data}));
    } else if (request.url?.includes('/meta') || request.url?.includes('/alias/')) {
      response.end(JSON.stringify(meta));
    } else if (status !== 200) {
      response.statusCode = status;
      response.end(JSON.stringify({error: status === 409 ? 'SECRET_VERSION_CONFLICT' : 'not_found', code: status === 409 ? 'SECRET_VERSION_CONFLICT' : 'not_found', message: `untrusted server error containing ${seed} and otpauth://totp/Acme:alice?secret=${seed}`}));
    } else {
      data = input.data as Record<string, unknown>;
      response.end(JSON.stringify({...meta, version: 8}));
    }
  });
  await new Promise<void>(resolve => {server.listen(0, '127.0.0.1', resolve);});
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('Fixture server unavailable');
  url = `http://127.0.0.1:${address.port}`;
});

afterEach(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve, reject) => {server.close(error => error ? reject(error) : resolve());});
  await rm(directory, {recursive: true, force: true});
});

describe('built TOTP CLI process boundaries', () => {
  it('imports via stdin without seeds in argv, output or local config files', async () => {
    const args = ['secret', 'totp', 'import', 'lab/authenticator', '--seed-stdin', '--json'];
    const result = await cli(args, `otpauth://totp/Acme:alice?secret=${seed}&issuer=Acme`);
    expect(result.code).toBe(0);
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({method: 'POST', url: '/v1/secrets', apiKey: 'synthetic-test-api-key', data: {type: 'credential', subType: 'totp', data: {totp: {...totp, issuer: 'Acme', accountName: 'alice'}}}});
    expect([...args, result.stdout, result.stderr, ...await files(directory)].join('\n')).not.toContain(seed);
    expect(JSON.parse(result.stdout)).toEqual({id, alias: 'lab/authenticator', version: 8});
  });

  it.each(['standard', 'user-session'])('generic %s create never echoes seed or URI from an HTTP error', async (protection) => {
    status = 422;
    const grants = protection === 'user-session' ? ['--grant-user', 'synthetic-user'] : [];
    const result = await cli(['secret', 'create', 'lab/authenticator', '--sub-type', 'totp', '--data-stdin', '--protection', protection, ...grants, '--json'], JSON.stringify({totp}), 'user');
    expect(result.code).toBe(1);
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({method: 'POST', url: '/v1/secrets', data: {type: 'credential', subType: 'totp', data: {totp}}});
    expect(result.stdout + result.stderr + (await files(directory)).join('')).not.toContain(seed);
    expect(result.stdout + result.stderr).not.toContain('otpauth://');
    expect(result.stderr).toContain('Secret operation failed.');
  });

  it('generic create emits a fixed error for malformed stdin JSON containing seed material', async () => {
    const result = await cli(['secret', 'create', 'lab/authenticator', '--sub-type', 'totp', '--data-stdin', '--json'], `{"totp":{"secret":"${seed}","uri":"otpauth://totp/alice?secret=${seed}"}, invalid}`, 'user');
    expect(result.code).toBe(1);
    expect(requests).toHaveLength(0);
    expect(result.stdout + result.stderr).not.toContain(seed);
    expect(result.stdout + result.stderr).not.toContain('otpauth://');
    expect(result.stderr).toContain('Invalid JSON received by --data-stdin');
  });

  it('prints a bare code and restricted JSON through normal API-key authentication', async () => {
    const plain = await cli(['secret', 'totp', 'code', id]);
    expect(plain.code).toBe(0);
    expect(plain.stdout).toMatch(/^\d{6}\n$/);
    const result = await cli(['secret', 'totp', 'code', id, '--json']);
    expect(result.code).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({code: expect.stringMatching(/^\d{6}$/), validUntil: expect.any(Number), period: 30});
    expect(requests.every(request => request.apiKey === 'synthetic-test-api-key' && request.url === `/v1/secrets/${id}/decrypt`)).toBe(true);
    expect([plain.stdout, plain.stderr, result.stdout, result.stderr, ...await files(directory)].join('\n')).not.toContain(seed);
  });

  it.each([404, 409])('does not fall back to a legacy write or retry when conditional writes return %i', async (failureStatus) => {
    status = failureStatus;
    const result = await cli(['secret', 'totp', 'import', id, '--attach', '--seed-stdin'], seed);
    expect(result.code).toBe(1);
    expect(requests.map(request => [request.method, request.url])).toEqual([
      ['POST', `/v1/secrets/${id}/decrypt?resolve=false`], ['PUT', `/v1/secrets/${id}/value`],
    ]);
    expect(requests[1].data.expectedVersion).toBe(7);
    expect(requests[1].data.data).toEqual({username: 'alice', password: '${ref:db/account#password}', keep: {nested: true}, totp});
    expect(result.stdout + result.stderr + (await files(directory)).join('')).not.toContain(seed);
  });

  it.each(['update', 'rotate', 'patch'])('never uses a legacy write for %s on an old server', async (command) => {
    status = 404;
    const args = command === 'patch' ? ['--set', 'username=bob'] : ['--data-stdin'];
    const result = await cli(['secret', command, id, ...args], '{"password":"new"}');
    expect(result.code).toBe(1);
    const writes = requests.filter(request => !request.url.includes('/decrypt') && request.method !== 'GET');
    expect(writes).toHaveLength(1);
    expect(writes[0].url).toBe(`/v1/secrets/${id}${command === 'rotate' ? '/rotate/value' : '/value'}`);
    expect(writes[0].data.expectedVersion).toBe(7);
    expect((writes[0].data.data as Record<string, unknown>).totp).toEqual(totp);
    expect(result.stdout + result.stderr).not.toContain(seed);
  });

  it('rejects oversized stdin without making any request', async () => {
    const result = await cli(['secret', 'totp', 'import', 'lab/invalid', '--seed-stdin'], 'A'.repeat(4097));
    expect(result.code).toBe(1);
    expect(result.stderr).toContain('Invalid TOTP configuration.');
    expect(requests).toHaveLength(0);
  });

  it('does not echo a rejected inline seed option into parser diagnostics', async () => {
    const result = await cli(['secret', 'totp', 'import', 'lab/invalid', `--seed=${seed}`]);
    expect(result.code).toBe(1);
    expect(result.stdout + result.stderr).not.toContain(seed);
    expect(requests).toHaveLength(0);
  });
});
