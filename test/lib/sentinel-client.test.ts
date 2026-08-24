// Path: test/lib/sentinel-client.test.ts
//
// A SECOND implementation of the Sentinel wire protocol, and the reason that is
// not the mistake it looks like.
//
// The server has one in `zn-vault/src/vault-crypto/root-key/sentinel-adapter.ts`.
// This package ships to npm on its own and cannot import it. So the protocol
// necessarily exists twice — which is normally how a contract dies quietly,
// both suites green while the two sides agree on nothing.
//
// The defence is the same one used for `kcv1:`: NEITHER side is checked against
// the other. Both are pinned to the FROZEN LITERALS below — the paths, the
// request field names, the response field names, the encoding — copied from the
// server adapter's own header comment:
//
//   POST /v1/root/unwrap  {"envelope":"<b64>"}  -> 200 {"plaintext":"<b64>"}
//   POST /v1/root/probe   {"envelope":"<b64>"}  -> 200 {"kcv":"kcv1:..."}
//
// Plus the `purpose` field of protocol v1.1 (archon-sentinel 8e257dd), which
// this client sends EXPLICITLY. The daemon treats a missing purpose as the BSK
// purpose, but its own source calls that a "staged rollout" affordance — there
// so the pre-purpose vault keeps booting during the migration, and therefore
// there to be removed. New code does not lean on it.
//
// Rename a field on either side and this suite goes red, rather than a ceremony
// discovering it with the datAshur unlocked and a witness waiting.
//
// Every test runs against a REAL local HTTPS server with REAL mutual TLS, using
// a throwaway CA minted in-process. A mocked transport would prove the JSON and
// nothing about the thing most likely to be wrong on a ceremony host, which is
// the certificate plumbing.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:https';
import { AddressInfo } from 'node:net';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

import { createSentinelClient } from '../../src/lib/sentinel-client.js';

/** Exactly what the server adapter documents. Do not "tidy" these. */
const FROZEN = {
  unwrapPath: '/v1/root/unwrap',
  probePath: '/v1/root/probe',
  requestField: 'envelope',
  purposeField: 'purpose',
  bskPurpose: 'zn-vault-bsk-v1',
  unwrapResponseField: 'plaintext',
  probeResponseField: 'kcv',
} as const;

const KEY = Buffer.alloc(32, 0x7e);
const ENVELOPE = Buffer.from([0xde, 0xad, 0xbe, 0xef]);

let dir: string;
let server: Server;
let port: number;
let paths: { ca: string; cert: string; key: string };
/** What the last request carried, so the wire shape can be asserted. */
let lastRequest: { path: string; body: unknown; authorized: boolean } | null = null;
/** What the next response should be. */
let respond: (body: unknown, status?: number) => void;
let nextBody: unknown = {};
let nextStatus = 200;

/** Mint a throwaway CA plus a server and a client cert, all with openssl. */
function mintPki(into: string): { ca: string; cert: string; key: string } {
  const run = (args: string[]): void => {
    execFileSync('openssl', args, { cwd: into, stdio: 'pipe' });
  };
  run(['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1',
       '-keyout', 'ca.key', '-out', 'ca.pem', '-subj', '/CN=test-sentinel-ca']);
  for (const [name, cn] of [['server', 'localhost'], ['client', 'ceremony.znvault']]) {
    run(['req', '-newkey', 'rsa:2048', '-nodes', '-keyout', `${name}.key`,
         '-out', `${name}.csr`, '-subj', `/CN=${cn}`]);
    writeFileSync(join(into, `${name}.ext`),
      name === 'server' ? 'subjectAltName=DNS:localhost,IP:127.0.0.1\n' : 'extendedKeyUsage=clientAuth\n');
    run(['x509', '-req', '-in', `${name}.csr`, '-CA', 'ca.pem', '-CAkey', 'ca.key',
         '-CAcreateserial', '-out', `${name}.pem`, '-days', '1',
         '-extfile', `${name}.ext`]);
  }
  return { ca: join(into, 'ca.pem'), cert: join(into, 'client.pem'), key: join(into, 'client.key') };
}

describe('Sentinel mTLS client', () => {
  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'znvault-sentinel-'));
    paths = mintPki(dir);

    server = createServer(
      {
        cert: require('node:fs').readFileSync(join(dir, 'server.pem')),
        key: require('node:fs').readFileSync(join(dir, 'server.key')),
        ca: require('node:fs').readFileSync(join(dir, 'ca.pem')),
        requestCert: true,
        rejectUnauthorized: true,
      },
      (req, res) => {
        const chunks: Buffer[] = [];
        req.on('data', (c: Buffer) => chunks.push(c));
        req.on('end', () => {
          lastRequest = {
            path: req.url ?? '',
            body: JSON.parse(Buffer.concat(chunks).toString('utf8')),
            authorized: (req.socket as { authorized?: boolean }).authorized === true,
          };
          res.writeHead(nextStatus, { 'content-type': 'application/json' });
          res.end(JSON.stringify(nextBody));
        });
      },
    );
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    port = (server.address() as AddressInfo).port;
    respond = (body, status = 200) => { nextBody = body; nextStatus = status; };
  }, 60000);

  afterAll(async () => {
    await new Promise<void>((r) => server.close(() => r()));
    rmSync(dir, { recursive: true, force: true });
  });

  function client(overrides: Partial<Parameters<typeof createSentinelClient>[0]> = {}) {
    return createSentinelClient({
      url: `https://localhost:${String(port)}`,
      caPath: paths.ca,
      certPath: paths.cert,
      keyPath: paths.key,
      timeoutMs: 5000,
      ...overrides,
    });
  }

  it('speaks the frozen wire shape for unwrap', async () => {
    respond({ [FROZEN.unwrapResponseField]: KEY.toString('base64') });

    const key = await client().unwrap(ENVELOPE);

    expect(lastRequest?.path).toBe(FROZEN.unwrapPath);
    expect(lastRequest?.body).toEqual({
      [FROZEN.requestField]: ENVELOPE.toString('base64'),
      // Sent explicitly, never left to the daemon's staged-rollout default.
      [FROZEN.purposeField]: FROZEN.bskPurpose,
    });
    expect(key.equals(KEY)).toBe(true);
  }, 30000);

  it('speaks the frozen wire shape for probe', async () => {
    respond({ [FROZEN.probeResponseField]: 'kcv1:0aefffaf36e10342c827e949f8276fd8' });

    const kcv = await client().probe(ENVELOPE);

    expect(lastRequest?.path).toBe(FROZEN.probePath);
    expect((lastRequest?.body as Record<string, unknown>).purpose).toBe(FROZEN.bskPurpose);
    expect(kcv).toBe('kcv1:0aefffaf36e10342c827e949f8276fd8');
  }, 30000);

  it('actually presents its client certificate', async () => {
    // The property most likely to be wrong on a ceremony host, and the one a
    // mocked transport cannot show. The listener is rejectUnauthorized, so a
    // client that sent nothing would not get this far — but assert it
    // explicitly rather than infer it from the absence of an error.
    respond({ [FROZEN.unwrapResponseField]: KEY.toString('base64') });

    await client().unwrap(ENVELOPE);

    expect(lastRequest?.authorized).toBe(true);
  }, 30000);

  it('refuses an appliance whose certificate does not chain to the pinned CA', async () => {
    // Without the pin, Node would validate against the public root store and
    // accept a certificate this deployment never issued. That is the wrong
    // check, not a weaker one.
    const otherDir = mkdtempSync(join(tmpdir(), 'znvault-othercа-'));
    try {
      const other = mintPki(otherDir);
      respond({ [FROZEN.unwrapResponseField]: KEY.toString('base64') });

      await expect(client({ caPath: other.ca }).unwrap(ENVELOPE)).rejects.toThrow();
    } finally {
      rmSync(otherDir, { recursive: true, force: true });
    }
  }, 60000);

  it('rejects a non-2xx instead of parsing whatever came back', async () => {
    respond({ error: 'sealed' }, 503);

    await expect(client().unwrap(ENVELOPE)).rejects.toThrow(/503/);
  }, 30000);

  it('rejects a 200 whose body is the wrong shape', async () => {
    // A proxy, a captive portal, a half-migrated appliance. Anything that is
    // not the field the protocol names is not an answer.
    respond({ notPlaintext: KEY.toString('base64') });

    await expect(client().unwrap(ENVELOPE)).rejects.toThrow(/plaintext/);
  }, 30000);

  it('rejects a plaintext field that is not valid base64 of 32 bytes', async () => {
    respond({ [FROZEN.unwrapResponseField]: 'not-base64-at-all!!' });

    await expect(client().unwrap(ENVELOPE)).rejects.toThrow();
  }, 30000);

  it('refuses a plain-HTTP URL outright', async () => {
    // The request body on wrap carries the bootstrap key, and the unwrap
    // response carries it back. There is no version of this that may travel in
    // clear, and a typo in a ceremony runbook must not be the thing that
    // decides it.
    expect(() =>
      createSentinelClient({
        url: `http://localhost:${String(port)}`,
        caPath: paths.ca,
        certPath: paths.cert,
        keyPath: paths.key,
        timeoutMs: 5000,
      }),
    ).toThrow(/https/i);
  });
});
