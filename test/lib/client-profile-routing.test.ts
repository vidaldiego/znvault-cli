// Path: test/lib/client-profile-routing.test.ts

/**
 * Regression tests for F1: the `--profile` runtime override must route HTTP
 * requests to that profile's URL.
 *
 * Bug: the VaultClient resolved its baseUrl from the ACTIVE profile at
 * construction time, BEFORE the `--profile` preAction hook set the runtime
 * override. As a result, `znvault --profile local <cmd>` sent the request to
 * the active (e.g. production) profile's URL while reading the local profile's
 * credentials — cross-wiring auth and target server.
 *
 * The fix: resolve baseUrl per-request from getConfig() (which honors the
 * runtime override), with explicit --url winning. These tests construct a
 * fresh VaultClient AFTER selecting the active profile but BEFORE applying the
 * override — exactly the ordering that exposed the bug.
 *
 * Isolation note: do NOT call vi.resetModules() here. The global conf mock in
 * test/setup.ts is registered at module-eval time; resetModules drops it and a
 * freshly-imported store would use the REAL conf and write to the user's config
 * on disk. We instead reset the in-memory store instance via the provided
 * _resetStoreInstance() helper and build a new client each test.
 */

import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import http from 'node:http';
import { type AddressInfo } from 'node:net';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

async function startMarkerServer(marker: string): Promise<{ server: http.Server; url: string }> {
  const server = http.createServer((req, res) => {
    // Drain the request body (we don't need its contents for these tests).
    req.resume();
    req.on('end', () => {
      res.setHeader('Content-Type', 'application/json');
      if (req.url === '/v1/health') {
        res.end(
          JSON.stringify({
            status: 'ok',
            version: marker, // marker identifies WHICH server answered
            uptime: 1,
            timestamp: new Date().toISOString(),
          })
        );
      } else if (req.url === '/v1/admin/cluster') {
        res.end(JSON.stringify({
          enabled: true,
          thisNode: { nodeId: marker, isLeader: true, isHealthy: true },
          cluster: { totalNodes: 1, healthyNodes: 1, leaderId: marker, nodes: [] },
        }));
      } else if (req.url === '/v1/admin/lockdown/status') {
        res.end(JSON.stringify({
          scope: 'SYSTEM', status: 'NORMAL', escalationCount: 0, reason: marker,
        }));
      } else if (req.url === '/auth/login' && req.method === 'POST') {
        // Echo the marker in user.role so the caller can tell which server
        // served login — this is the path the bug affects (login runs on the
        // main client whose baseUrl froze at construction).
        res.end(
          JSON.stringify({
            accessToken: 'tok',
            refreshToken: 'rtok',
            expiresIn: 3600,
            user: { id: 'u1', username: 'admin', role: marker, tenantId: null },
          })
        );
      } else {
        res.statusCode = 404;
        res.end(JSON.stringify({ error: 'Not Found' }));
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => { resolve(); }));
  const { port } = server.address() as AddressInfo;
  return { server, url: `http://127.0.0.1:${port}` };
}

describe('F1: --profile runtime override routes requests to that profile', () => {
  let active: { server: http.Server; url: string };
  let other: { server: http.Server; url: string };
  let tmpConfigDir: string;
  let prevConfigDir: string | undefined;

  beforeEach(async () => {
    active = await startMarkerServer('ACTIVE-PROFILE-SERVER');
    other = await startMarkerServer('OTHER-PROFILE-SERVER');
    delete process.env.ZNVAULT_URL;

    // Isolate config to a throwaway dir so this test NEVER touches the user's
    // real config. The store honors ZNVAULT_CONFIG_DIR (store.ts:27). The
    // global conf mock is not reliably applied to this file's dynamic imports,
    // so we isolate at the filesystem level instead.
    prevConfigDir = process.env.ZNVAULT_CONFIG_DIR;
    tmpConfigDir = fs.mkdtempSync(path.join(os.tmpdir(), 'znvault-f1-'));
    process.env.ZNVAULT_CONFIG_DIR = tmpConfigDir;

    // Reset the store instance so it re-reads ZNVAULT_CONFIG_DIR (also clears
    // any runtime override).
    const { _resetStoreInstance } = await import('../../src/lib/config/store.js');
    _resetStoreInstance();
  });

  afterEach(async () => {
    const { setRuntimeProfile, _resetStoreInstance } = await import('../../src/lib/config/store.js');
    setRuntimeProfile(null);
    _resetStoreInstance();

    // Restore env + clean up the throwaway config dir.
    if (prevConfigDir === undefined) delete process.env.ZNVAULT_CONFIG_DIR;
    else process.env.ZNVAULT_CONFIG_DIR = prevConfigDir;
    fs.rmSync(tmpConfigDir, { recursive: true, force: true });

    await new Promise<void>((r) => active.server.close(() => { r(); }));
    await new Promise<void>((r) => other.server.close(() => { r(); }));
    delete process.env.ZNVAULT_URL;
  });

  it('login() sends to the overridden profile URL, not the active profile URL', async () => {
    const { saveProfile, switchProfile } = await import('../../src/lib/config/profile.js');
    const { setRuntimeProfile } = await import('../../src/lib/config/store.js');
    const { VaultClient } = await import('../../src/lib/client.js');

    saveProfile('prod', { url: active.url, insecure: false, timeout: 30000 });
    saveProfile('local', { url: other.url, insecure: false, timeout: 30000 });
    switchProfile('prod'); // active = prod

    // Build the client while active=prod and BEFORE the override — this is the
    // ordering that froze baseUrl to the active profile in the original bug.
    const client = new VaultClient();

    // Apply the --profile override, as the preAction hook does.
    setRuntimeProfile('local');

    const resp = await client.login('admin', 'password');
    expect(resp.user.role).toBe('OTHER-PROFILE-SERVER');
  });

  it('explicit --url (configure) still wins over the profile override', async () => {
    const { saveProfile, switchProfile } = await import('../../src/lib/config/profile.js');
    const { setRuntimeProfile } = await import('../../src/lib/config/store.js');
    const { VaultClient } = await import('../../src/lib/client.js');

    // Both profiles point at the ACTIVE server; --url should redirect to OTHER.
    saveProfile('prod', { url: active.url, insecure: false, timeout: 30000 });
    saveProfile('local', { url: active.url, insecure: false, timeout: 30000 });
    switchProfile('prod');

    const client = new VaultClient();
    setRuntimeProfile('local');
    client.configure(other.url); // explicit --url

    const resp = await client.login('admin', 'password');
    expect(resp.user.role).toBe('OTHER-PROFILE-SERVER');
  });

  it('propagates explicit --url to lazy domain clients used by status', async () => {
    const { saveProfile, switchProfile } = await import('../../src/lib/config/profile.js');
    const { VaultClient } = await import('../../src/lib/client.js');

    saveProfile('prod', { url: active.url, insecure: false, timeout: 30000 });
    switchProfile('prod');

    const client = new VaultClient();
    client.configure(other.url);

    const health = await client.health();
    const cluster = await client.clusterStatus();
    const lockdown = await client.getLockdownStatus();
    expect(health.version).toBe('OTHER-PROFILE-SERVER');
    expect(cluster.thisNode.nodeId).toBe('OTHER-PROFILE-SERVER');
    expect(lockdown.reason).toBe('OTHER-PROFILE-SERVER');
  });

  it('with no override, uses the active profile URL', async () => {
    const { saveProfile, switchProfile } = await import('../../src/lib/config/profile.js');
    const { VaultClient } = await import('../../src/lib/client.js');

    saveProfile('prod', { url: active.url, insecure: false, timeout: 30000 });
    saveProfile('local', { url: other.url, insecure: false, timeout: 30000 });
    switchProfile('prod');

    const client = new VaultClient();
    const resp = await client.login('admin', 'password');
    expect(resp.user.role).toBe('ACTIVE-PROFILE-SERVER');
  });
});
