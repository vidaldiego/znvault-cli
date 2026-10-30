import {randomUUID} from 'node:crypto';
import {afterEach, describe, expect, it, vi} from 'vitest';
import {store, getProfile, setRuntimeProfile, invalidateAllProfileCaches} from '../../src/lib/config.js';
import * as output from '../../src/lib/output.js';
const network = vi.hoisted(() => ({fetch: globalThis.fetch}));
vi.mock('open', () => ({default: async (raw: string) => {
  const url = new URL(raw), callback = new URL(url.searchParams.get('callback_uri')!);
  callback.searchParams.set('state', url.searchParams.get('state')!);callback.searchParams.set('code', 'public-synthetic-authorization-code');
  await network.fetch(callback);
}}));
afterEach(() => {vi.restoreAllMocks();vi.unstubAllGlobals();setRuntimeProfile(null);invalidateAllProfileCaches();});
describe('existing web login respects authentication generation', () => {
  it('does not overwrite a newer login after the real loopback browser callback', async () => {
    vi.spyOn(output, 'info').mockImplementation(() => {});vi.spyOn(console, 'log').mockImplementation(() => {});
    setRuntimeProfile('browser');
    const initial = {url: 'https://vault.example.test', insecure: false, timeout: 1000, authGeneration: randomUUID()};
    store.set('profiles', {browser: initial});invalidateAllProfileCaches();
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL, init?: RequestInit) => {
      if (String(input).includes('/auth/cli/token')) {
        store.set('profiles', {browser: {...initial, authGeneration: randomUUID(), credentials: {accessToken: 'newer-login', refreshToken: 'newer-refresh',
          expiresAt: Date.now()+60000, userId: 'newer-human', username: 'fixture/newer', role: 'user', tenantId: 'fixture'}}});invalidateAllProfileCaches();
        return new Response(JSON.stringify({accessToken: 'late-browser-login', refreshToken: 'late-browser-refresh', expiresIn: 900,
          user: {id: 'fixture-human', username: 'fixture/alice', role: 'user', tenantId: 'fixture'}}), {status: 200});
      }
      return await network.fetch(input, init);
    }));
    const {webLogin} = await import('../../src/lib/web-login.js');
    expect(await webLogin()).toMatchObject({success: false});
    expect(getProfile('browser')?.credentials?.accessToken).toBe('newer-login');
  });
});
