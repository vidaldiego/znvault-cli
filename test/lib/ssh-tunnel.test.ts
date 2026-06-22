// Path: znvault-cli/test/lib/ssh-tunnel.test.ts

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { isLoopbackHost, withAgentConnection } from '../../src/lib/ssh-tunnel.js';
import { triggerAgentUpdate, triggerPluginUpdate } from '../../src/commands/agent/helpers.js';

describe('isLoopbackHost', () => {
  it('recognizes loopback hosts', () => {
    expect(isLoopbackHost('127.0.0.1')).toBe(true);
    expect(isLoopbackHost('localhost')).toBe(true);
    expect(isLoopbackHost('::1')).toBe(true);
  });

  it('treats remote hosts as non-loopback', () => {
    expect(isLoopbackHost('172.16.211.20')).toBe(false);
    expect(isLoopbackHost('agent.example.com')).toBe(false);
  });
});

describe('withAgentConnection', () => {
  it('connects directly (no tunnel) when tunnel:false', async () => {
    const seen: Array<{ host: string; port: number }> = [];
    const result = await withAgentConnection('172.16.211.20', 9100, { tunnel: false }, async (h, p) => {
      seen.push({ host: h, port: p });
      return 'ok';
    });
    expect(result).toBe('ok');
    // Direct connection: fn receives the ORIGINAL host/port, no rewrite.
    expect(seen).toEqual([{ host: '172.16.211.20', port: 9100 }]);
  });

  it('connects directly (no tunnel) for a loopback host even when tunnel:true', async () => {
    const seen: Array<{ host: string; port: number }> = [];
    await withAgentConnection('127.0.0.1', 56120, { tunnel: true }, async (h, p) => {
      seen.push({ host: h, port: p });
      return 0;
    });
    // Loopback short-circuits the tunnel: original host/port passed through.
    expect(seen).toEqual([{ host: '127.0.0.1', port: 56120 }]);
  });

  it('propagates a throw from fn (so callers can unwind to teardown)', async () => {
    // On the direct/loopback path there is no tunnel, but the contract is that
    // a throw inside fn propagates (the tunneling path relies on this to reach
    // its finally{} teardown). Verify the throw is not swallowed.
    await expect(
      withAgentConnection('127.0.0.1', 9100, { tunnel: true }, async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
  });
});

describe('agent update triggers send a non-empty JSON body', () => {
  // The agent's Fastify rejects a JSON content-type with an empty body
  // (FST_ERR_CTP_EMPTY_JSON_BODY → HTTP 400). These triggers MUST send a body.
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ success: true, previousVersion: '1.0.0', newVersion: '1.1.0', willRestart: true, message: 'ok', timestamp: '' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it('triggerAgentUpdate posts a JSON body with force', async () => {
    await triggerAgentUpdate('127.0.0.1', 9100);
    const init = fetchSpy.mock.calls[0]?.[1] as RequestInit;
    expect(init.method).toBe('POST');
    expect(init.body).toBeDefined();
    expect(init.body).not.toBe('');
    expect(JSON.parse(init.body as string)).toEqual({ force: false });
  });

  it('triggerAgentUpdate honors force=true', async () => {
    await triggerAgentUpdate('127.0.0.1', 9100, true);
    const init = fetchSpy.mock.calls[0]?.[1] as RequestInit;
    expect(JSON.parse(init.body as string)).toEqual({ force: true });
  });

  it('triggerPluginUpdate posts a non-empty JSON body', async () => {
    fetchSpy.mockResolvedValue(
      new Response(JSON.stringify({ updated: 0, results: [], willRestart: false, message: 'ok', timestamp: '' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    await triggerPluginUpdate('127.0.0.1', 9100);
    const init = fetchSpy.mock.calls[0]?.[1] as RequestInit;
    expect(init.method).toBe('POST');
    expect(init.body).toBe('{}');
  });
});
