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
  error: state.error, json: state.json, success: state.success, info: vi.fn(),
  spinner: () => ({start() {return this;}, stop() {return this;}, fail() {return this;}}),
}));
const seed = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
const totp = {type: 'totp', secret: seed, algorithm: 'SHA1', digits: 6, period: 30};
const id = '12345678-1234-1234-1234-123456789abc';
const meta = {id, alias: 'lab/account', tenant: 'lab', type: 'credential', subType: 'password', version: 99, protectionMode: 'STANDARD', tags: ['keep'], createdAt: '2026-01-01', updatedAt: '2026-01-01'};
let current: Record<string, unknown>;
let program: Command;

beforeEach(async () => {
  vi.clearAllMocks();
  current = {...meta, version: 7, data: {username: 'alice', password: '${ref:db/account#password}', extra: {keep: true}, totp}};
  state.get.mockResolvedValue(meta);
  state.post.mockImplementation((path: string) => Promise.resolve(path.includes('/decrypt') ? current : {...meta, version: 8}));
  state.put.mockResolvedValue({...meta, version: 8});
  state.stdin.mockResolvedValue('{"password":"new"}');
  state.prompt.mockReset();
  program = new Command().exitOverride();
  const {registerSecretCommands} = await import('../../src/commands/secret/index.js');
  registerSecretCommands(program);
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(process, 'exit').mockImplementation((() => {throw new Error('exit');}) as never);
});
afterEach(() => {vi.restoreAllMocks();});

async function run(command: string, ...args: string[]) {
  await program.parseAsync(['node', 'test', 'secret', command, id, ...args]);
}

describe('existing editors preserve attached TOTP', () => {
  it('updates credential fields without dropping TOTP, custom fields or raw references', async () => {
    state.prompt.mockResolvedValueOnce({updateData: true}).mockResolvedValueOnce({username: 'bob', password: ''});
    await run('update');
    expect(state.put).toHaveBeenCalledWith(`/v1/secrets/${id}/value`, {
      expectedVersion: 7,
      data: {username: 'bob', password: '${ref:db/account#password}', extra: {keep: true}, totp},
    });
  });

  it('rotates only the credential password and sends the decrypt version', async () => {
    state.prompt.mockResolvedValueOnce({password: 'new'});
    await run('rotate');
    expect(state.post).toHaveBeenCalledWith(`/v1/secrets/${id}/rotate/value`, {
      expectedVersion: 7, data: {username: 'alice', password: 'new', extra: {keep: true}, totp},
    });
  });

  it.each(['update', 'rotate'])('%s merges stdin edits into complete raw data', async (command) => {
    await run(command, '--data-stdin');
    const mutate = command === 'update' ? state.put : state.post;
    expect(mutate).toHaveBeenCalledWith(`/v1/secrets/${id}${command === 'rotate' ? '/rotate/value' : '/value'}`, {
      expectedVersion: 7, data: {username: 'alice', password: 'new', extra: {keep: true}, totp},
    });
    expect(state.post).toHaveBeenCalledWith(`/v1/secrets/${id}/decrypt?resolve=false`, {});
  });

  it.each(['update', 'rotate'])('%s never sends a canonical TOTP to a tempfile editor', async (command) => {
    current = {...current, type: 'setting', subType: 'json', data: {apiKey: 'old', custom: true, totp}};
    if (command === 'update') state.prompt.mockResolvedValueOnce({updateData: true});
    state.prompt.mockResolvedValueOnce({dataJson: '{"apiKey":"new"}'});
    await run(command);
    expect(JSON.stringify(state.prompt.mock.calls)).not.toContain(seed);
    expect(JSON.stringify(state.prompt.mock.calls)).not.toContain('"totp"');
    const calls = command === 'update' ? state.put.mock.calls : state.post.mock.calls.filter(([path]) => !path.includes('/decrypt'));
    expect(calls.at(-1)?.[1]).toEqual({expectedVersion: 7, data: {apiKey: 'new', custom: true, totp}});
  });

  it.each(['update', 'rotate'])('%s uses only a masked authenticator prompt for standalone TOTP', async (command) => {
    current = {...current, subType: 'totp', data: {totp}};
    if (command === 'update') state.prompt.mockResolvedValueOnce({updateData: true});
    state.prompt.mockResolvedValueOnce({seedOrUri: seed});
    await run(command);
    const questions = state.prompt.mock.calls.flatMap(([items]) => items);
    expect(questions).toContainEqual(expect.objectContaining({name: 'seedOrUri', type: 'password', mask: '*'}));
    expect(questions).not.toContainEqual(expect.objectContaining({name: 'username'}));
    expect(questions).not.toContainEqual(expect.objectContaining({name: 'password'}));
    expect(JSON.stringify(state.prompt.mock.calls)).not.toContain(seed);
  });

  it.each(['update', 'rotate'])('%s does not retry a version conflict', async (command) => {
    state.put.mockRejectedValue(Object.assign(new Error(seed), {statusCode: 409, errorCode: 'SECRET_VERSION_CONFLICT'}));
    state.post.mockImplementation((path: string) => path.includes('/decrypt') ? Promise.resolve(current) : Promise.reject(Object.assign(new Error(seed), {statusCode: 409, errorCode: 'SECRET_VERSION_CONFLICT'})));
    await expect(run(command, '--data-stdin')).rejects.toThrow('exit');
    expect(state.post.mock.calls.filter(([path]) => path.includes('/decrypt'))).toHaveLength(1);
    const writes = command === 'update' ? state.put.mock.calls : state.post.mock.calls.filter(([path]) => !path.includes('/decrypt'));
    expect(writes).toHaveLength(1);
    expect(state.error).toHaveBeenCalledWith(expect.stringContaining('SECRET_VERSION_CONFLICT'));
    expect(JSON.stringify(state.error.mock.calls)).not.toContain(seed);
  });

  it.each(['update', 'rotate'])('%s emits fixed JSON errors instead of JSON.parse excerpts', async (command) => {
    state.stdin.mockResolvedValue(`{"password":"${seed}" invalid}`);
    await expect(run(command, '--data-stdin')).rejects.toThrow('exit');
    expect(JSON.stringify(state.error.mock.calls)).not.toContain(seed);
    expect(state.put).not.toHaveBeenCalled();
  });

  it('rejects canonical TOTP configuration in --data argv', async () => {
    await expect(run('update', '--data', JSON.stringify({totp}))).rejects.toThrow('exit');
    expect(state.put).not.toHaveBeenCalled();
  });

  it('keeps canonical TOTP out of patch dry-run diffs', async () => {
    current = {...current, type: 'setting', subType: 'json'};
    await run('patch', '--set', 'username=bob', '--dry-run', '--json');
    expect(JSON.stringify(state.json.mock.calls)).not.toContain(seed);
    expect(state.put).not.toHaveBeenCalled();
  });

  it('patch retains TOTP and uses the raw decrypt version', async () => {
    current = {...current, type: 'setting', subType: 'json'};
    await run('patch', '--set', 'username=bob');
    expect(state.put).toHaveBeenCalledWith(`/v1/secrets/${id}/value`, {
      expectedVersion: 7, data: {username: 'bob', password: '${ref:db/account#password}', extra: {keep: true}, totp},
    });
  });

  it.each(['.totp.secret', '..totp.secret', ' totp.secret'])('blocks disguised TOTP patch path %s without echoing its value', async (path) => {
    await expect(run('patch', '--set', `${path}=${seed}`, '--dry-run', '--json')).rejects.toThrow('exit');
    expect(state.json).not.toHaveBeenCalled();
    expect(JSON.stringify(state.error.mock.calls)).not.toContain(seed);
  });

  it('allows explicit removal of a legacy custom totp field', async () => {
    current = {...current, type: 'setting', subType: 'json', data: {totp: 'legacy', keep: true}};
    await run('patch', '--unset', 'totp');
    expect(state.put).toHaveBeenCalledWith(`/v1/secrets/${id}/value`, {data: {keep: true}, expectedVersion: 7});
  });

  it('rejects patch mutations of the TOTP field before producing a diff', async () => {
    await expect(run('patch', '--unset', 'totp.secret', '--dry-run', '--json')).rejects.toThrow('exit');
    expect(state.json).not.toHaveBeenCalled();
    expect(state.put).not.toHaveBeenCalled();
  });
});
