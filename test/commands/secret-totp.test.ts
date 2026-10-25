import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {Command} from 'commander';

const state = vi.hoisted(() => ({
  get: vi.fn(), post: vi.fn(), put: vi.fn(), stdin: vi.fn(), prompt: vi.fn(),
  error: vi.fn(), json: vi.fn(), success: vi.fn(),
}));
vi.mock('../../src/lib/client.js', () => ({client: {get: state.get, post: state.post, put: state.put}}));
vi.mock('../../src/lib/stdin.js', () => ({readStdinUtf8: state.stdin}));
vi.mock('inquirer', () => ({default: {prompt: state.prompt}}));
vi.mock('../../src/lib/output.js', () => ({
  error: state.error, json: state.json, success: state.success,
  spinner: () => ({start() {return this;}, stop() {return this;}, fail() {return this;}}),
}));

const seed = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
const totp = {type: 'totp', secret: seed, algorithm: 'SHA1', digits: 6, period: 30};
const id = '12345678-1234-1234-1234-123456789abc';
const metadata = {id, alias: 'lab/account', tenant: 'lab', type: 'credential', subType: 'password', version: 99, protectionMode: 'USER_SESSION_ONLY', tags: ['keep'], createdAt: '2026-01-01', updatedAt: '2026-01-01'};
let decrypted: Record<string, unknown>;
let program: Command;
let log: ReturnType<typeof vi.spyOn>;

async function run(args: string[]) {
  await program.parseAsync(['node', 'test', 'secret', 'totp', ...args]);
}

beforeEach(async () => {
  vi.clearAllMocks();
  decrypted = {...metadata, version: 7, data: {username: 'alice', password: '${ref:db/account#password}', extra: {keep: true}}};
  state.get.mockResolvedValue(metadata);
  state.post.mockImplementation((path: string) => Promise.resolve(path.includes('/decrypt') ? decrypted : {...metadata, version: 8}));
  state.put.mockResolvedValue({...metadata, version: 8});
  state.stdin.mockResolvedValue(seed);
  state.prompt.mockResolvedValue({seedOrUri: seed});
  program = new Command().exitOverride();
  program.configureOutput({writeErr: () => {}});
  const {registerSecretCommands} = await import('../../src/commands/secret/index.js');
  registerSecretCommands(program);
  log = vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(process, 'exit').mockImplementation((() => {throw new Error('exit');}) as never);
});
afterEach(() => {vi.restoreAllMocks();});

describe('native secret totp commands', () => {
  it('imports standalone credentials from bounded stdin with native User-Sealed grants', async () => {
    await run(['import', 'lab/authenticator', '--seed-stdin', '--protection', 'user-session', '--grant-user', 'human-1', 'human-2', '--json']);
    expect(state.stdin).toHaveBeenCalledWith(4096);
    expect(state.post).toHaveBeenCalledWith('/v1/secrets', {
      alias: 'lab/authenticator', type: 'credential', subType: 'totp', data: {totp},
      protectionMode: 'USER_SESSION_ONLY', grantUserIds: ['human-1', 'human-2'],
    });
    expect(JSON.stringify([state.json.mock.calls, log.mock.calls])).not.toContain(seed);
  });

  it('uses a masked prompt without sending existing seeds to an editor', async () => {
    await run(['import', 'lab/authenticator']);
    expect(state.prompt).toHaveBeenCalledWith([expect.objectContaining({type: 'password', name: 'seedOrUri', mask: '*'})]);
    expect(JSON.stringify(state.prompt.mock.calls)).not.toContain(seed);
  });

  it('attaches only to the raw source payload using the decrypt version and preserving all fields', async () => {
    await run(['import', id, '--attach', '--seed-stdin']);
    expect(state.post).toHaveBeenCalledWith(`/v1/secrets/${id}/decrypt?resolve=false`, {});
    expect(state.put).toHaveBeenCalledWith(`/v1/secrets/${id}/value`, {
      data: {username: 'alice', password: '${ref:db/account#password}', extra: {keep: true}, totp}, expectedVersion: 7,
    });
    expect(state.post.mock.calls.filter(([path]) => path === '/v1/secrets')).toHaveLength(0);
  });

  it.each([403, 404])('does not create after denied or unknown attach lookup (%i)', async (statusCode) => {
    state.get.mockRejectedValue(Object.assign(new Error(`server included ${seed}`), {statusCode}));
    await expect(run(['import', 'unknown', '--attach', '--seed-stdin'])).rejects.toThrow('exit');
    expect(state.post).not.toHaveBeenCalled();
    expect(state.put).not.toHaveBeenCalled();
    expect(JSON.stringify(state.error.mock.calls)).not.toContain(seed);
  });

  it('fails closed on servers without conditional-write support', async () => {
    state.put.mockRejectedValue(Object.assign(new Error('not found'), {statusCode: 404}));
    await expect(run(['import', id, '--attach', '--seed-stdin'])).rejects.toThrow('exit');
    expect(state.put.mock.calls).toEqual([[`/v1/secrets/${id}/value`, expect.objectContaining({expectedVersion: 7})]]);
    expect(state.post.mock.calls.filter(([path]) => !path.includes('/decrypt'))).toHaveLength(0);
  });

  it('does not retry a stale attachment or leak a server error payload', async () => {
    state.put.mockRejectedValue(Object.assign(new Error(seed), {statusCode: 409, errorCode: 'SECRET_VERSION_CONFLICT'}));
    await expect(run(['import', id, '--attach', '--seed-stdin'])).rejects.toThrow('exit');
    expect(state.put).toHaveBeenCalledTimes(1);
    expect(state.error).toHaveBeenCalledWith(expect.stringContaining('SECRET_VERSION_CONFLICT'));
    expect(JSON.stringify(state.error.mock.calls)).not.toContain(seed);
  });

  it.each(['legacy', {secret: seed}, null])('preserves legacy .totp collisions rather than overwriting them', async (legacy) => {
    decrypted.data = {password: 'keep', totp: legacy};
    await expect(run(['import', id, '--attach', '--seed-stdin'])).rejects.toThrow('exit');
    expect(state.put).not.toHaveBeenCalled();
  });

  it.each([{subType: 'link'}, {replication: {role: 'replica', readonly: true}}])('refuses attachment to an immutable or pointer secret', async (fields) => {
    decrypted = {...decrypted, ...fields};
    await expect(run(['import', id, '--attach', '--seed-stdin'])).rejects.toThrow('exit');
    expect(state.put).not.toHaveBeenCalled();
  });

  it('does not alter protection or grants when attaching', async () => {
    await expect(run(['import', id, '--attach', '--seed-stdin', '--protection', 'standard'])).rejects.toThrow('exit');
    expect(state.put).not.toHaveBeenCalled();
  });

  it('bounds stdin and uses a fixed error for malformed imports', async () => {
    state.stdin.mockRejectedValue(new Error(`invalid: ${seed}`));
    await expect(run(['import', 'lab/totp', '--seed-stdin'])).rejects.toThrow('exit');
    expect(state.error).toHaveBeenCalledWith('Invalid TOTP configuration.');
    expect(state.post).not.toHaveBeenCalled();
  });

  it('prints only a six-digit code after normal authorised decrypt', async () => {
    decrypted.data = {totp};
    vi.spyOn(Date, 'now').mockReturnValue(59000);
    await run(['code', id]);
    expect(state.post).toHaveBeenCalledWith(`/v1/secrets/${id}/decrypt`, {});
    expect(log.mock.calls).toEqual([['287082']]);
    expect(state.json).not.toHaveBeenCalled();
  });

  it('prints only code and Unix-ms validity metadata in JSON', async () => {
    decrypted.data = {totp};
    vi.spyOn(Date, 'now').mockReturnValue(59000);
    await run(['code', id, '--json']);
    expect(state.json).toHaveBeenCalledWith({code: '287082', validUntil: 60000, period: 30});
    expect(log).not.toHaveBeenCalled();
    expect(JSON.stringify(state.json.mock.calls)).not.toContain(seed);
  });

  it('does not generate a code after native decrypt denial', async () => {
    state.post.mockRejectedValue(Object.assign(new Error(seed), {statusCode: 403}));
    await expect(run(['code', id])).rejects.toThrow('exit');
    expect(log).not.toHaveBeenCalled();
    expect(state.json).not.toHaveBeenCalled();
    expect(JSON.stringify(state.error.mock.calls)).not.toContain(seed);
  });

  it('removes only a canonical attachment with the same raw-decrypt CAS', async () => {
    decrypted.data = {password: '${ref:db/account#password}', custom: true, totp};
    await run(['remove', id]);
    expect(state.post).toHaveBeenCalledWith(`/v1/secrets/${id}/decrypt?resolve=false`, {});
    expect(state.put).toHaveBeenCalledWith(`/v1/secrets/${id}/value`, {
      data: {password: '${ref:db/account#password}', custom: true}, expectedVersion: 7,
    });
  });

  it('requires explicit secret delete for standalone authenticators', async () => {
    decrypted = {...decrypted, subType: 'totp', data: {totp}};
    await expect(run(['remove', id])).rejects.toThrow('exit');
    expect(state.put).not.toHaveBeenCalled();
    expect(state.error).toHaveBeenCalledWith(expect.stringContaining('secret delete'));
  });

  it('does not remove legacy fields', async () => {
    decrypted.data = {totp: {legacy: 'keep'}, password: 'keep'};
    await expect(run(['remove', id])).rejects.toThrow('exit');
    expect(state.put).not.toHaveBeenCalled();
  });
});
