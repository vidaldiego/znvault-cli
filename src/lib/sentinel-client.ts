// Path: src/lib/sentinel-client.ts
//
// Minimal mTLS JSON client for the Archon Sentinel appliance, so an escrow
// ceremony can source the bootstrap key from the hardware root instead of from
// a cleartext file on a production node.
//
// PORT NOTICE. This is a SECOND implementation of a protocol the server already
// speaks in zn-vault/src/vault-crypto/root-key/sentinel-adapter.ts. This package
// ships to npm on its own and cannot import from the server, so the protocol
// necessarily exists twice — normally the way a contract dies quietly, with both
// suites green and the two sides agreeing on nothing.
//
// The defence is the one used for `kcv1:`: neither side is checked against the
// other. Both are pinned to frozen literals — paths, field names, encoding —
// in test/lib/sentinel-client.test.ts here and in the adapter's own suite there.
// Rename a field on either side and both go red.
//
// The wire, copied verbatim from the server adapter's header:
//
//   POST /v1/root/unwrap  {"envelope":"<b64>"}  -> 200 {"plaintext":"<b64>"}
//   POST /v1/root/probe   {"envelope":"<b64>"}  -> 200 {"kcv":"kcv1:..."}
//
// DELIBERATELY NOT IMPLEMENTED: `wrap`. Its request body carries the bootstrap
// key, and provisioning a new root is a server-side operation with its own
// audit trail (`znvault superadmin rootkey wrap`). A ceremony host has no
// business minting envelopes, so the capability is simply absent rather than
// present-and-guarded.

import { request } from 'node:https';
import { readFileSync } from 'node:fs';

/** Frozen wire paths. Pinned as literals in the test suite. */
const OP_PATHS = {
  unwrap: '/v1/root/unwrap',
  probe: '/v1/root/probe',
} as const;

/**
 * The purpose this client asks for, sent EXPLICITLY.
 *
 * Protocol v1.1 binds a purpose into the envelope's cryptography so a KMIP KEK
 * envelope can never be opened as if it were the vault's bootstrap key. The
 * field is optional and defaults to this same value — but the daemon's own
 * comment calls that default a "staged rollout" affordance, there so the
 * pre-purpose vault keeps booting during the migration.
 *
 * New code written today has no business depending on a compatibility default
 * that exists to be removed. Sending it also makes the ask readable on the
 * wire, which matters when the wire is being watched during a key ceremony.
 */
const BSK_PURPOSE = 'zn-vault-bsk-v1';

const BSK_LEN = 32;
const MAX_RESPONSE_BYTES = 64 * 1024;

export interface SentinelClientConfig {
  /** Base URL of the appliance. https:// only. */
  url: string;
  /** CA bundle that must issue the appliance's certificate. */
  caPath: string;
  /** Client certificate presented to the appliance. */
  certPath: string;
  /** Its private key. */
  keyPath: string;
  timeoutMs?: number;
}

export interface SentinelClient {
  /** Open an envelope. Returns a fresh 32-byte buffer the caller must wipe. */
  unwrap(envelope: Buffer): Promise<Buffer>;
  /** Liveness plus a KCV claim. No plaintext crosses the wire. */
  probe(envelope: Buffer): Promise<string>;
}

/**
 * Build the client. Reads the certificate material eagerly so a missing or
 * unreadable file fails now — at the top of a ceremony, with everything still
 * locked — rather than at the moment the key is expected to arrive.
 *
 * @throws on a non-https URL or unreadable certificate material.
 */
export function createSentinelClient(config: SentinelClientConfig): SentinelClient {
  const target = new URL(config.url);
  if (target.protocol !== 'https:') {
    // The unwrap response carries the bootstrap key. There is no version of
    // this that may travel in clear, and a typo in a runbook must not be what
    // decides it.
    throw new Error(
      `The Sentinel URL must be https://, got ${JSON.stringify(config.url)}. ` +
      'The unwrap response carries the bootstrap key.',
    );
  }

  const tls = {
    ca: readFileSync(config.caPath),
    cert: readFileSync(config.certPath),
    key: readFileSync(config.keyPath),
  };
  const basePath = target.pathname.replace(/\/+$/, '');
  const timeoutMs = config.timeoutMs ?? 5000;

  async function call(op: keyof typeof OP_PATHS, payload: unknown): Promise<Record<string, unknown>> {
    const body = Buffer.from(JSON.stringify(payload), 'utf-8');

    return await new Promise<Record<string, unknown>>((resolve, reject) => {
      const req = request(
        {
          method: 'POST',
          protocol: target.protocol,
          hostname: target.hostname,
          port: target.port,
          path: `${basePath}${OP_PATHS[op]}`,
          headers: { 'content-type': 'application/json', 'content-length': body.length },
          ca: tls.ca,
          cert: tls.cert,
          key: tls.key,
          // Left at its default (true) on purpose. The CA above is the pin:
          // without it Node would validate against the public root store and
          // accept a certificate this deployment never issued — the wrong
          // check, not a weaker one.
          timeout: timeoutMs,
        },
        (res) => {
          const chunks: Buffer[] = [];
          let total = 0;
          res.on('data', (chunk: Buffer) => {
            total += chunk.length;
            if (total > MAX_RESPONSE_BYTES) {
              req.destroy(new Error(`Sentinel ${op} response exceeded ${String(MAX_RESPONSE_BYTES)} bytes`));
              return;
            }
            chunks.push(chunk);
          });
          res.on('end', () => {
            const status = res.statusCode ?? 0;
            const raw = Buffer.concat(chunks).toString('utf-8');
            if (status < 200 || status >= 300) {
              reject(new Error(`Sentinel ${op} failed: HTTP ${String(status)}`));
              return;
            }
            let parsed: unknown;
            try {
              parsed = JSON.parse(raw);
            } catch {
              reject(new Error(`Sentinel ${op} returned HTTP ${String(status)} with a malformed JSON body`));
              return;
            }
            if (typeof parsed !== 'object' || parsed === null) {
              reject(new Error(`Sentinel ${op} returned a JSON value that is not an object`));
              return;
            }
            resolve(parsed as Record<string, unknown>);
          });
        },
      );
      req.on('timeout', () => {
        req.destroy(new Error(`Sentinel ${op} timed out after ${String(timeoutMs)}ms`));
      });
      req.on('error', reject);
      req.end(body);
    });
  }

  return {
    async unwrap(envelope: Buffer): Promise<Buffer> {
      const response = await call('unwrap', {
        envelope: envelope.toString('base64'),
        purpose: BSK_PURPOSE,
      });
      const plaintext = response.plaintext;
      if (typeof plaintext !== 'string') {
        throw new Error(
          'Sentinel unwrap returned 200 without a string "plaintext" field. ' +
          'Something answered that is not the appliance protocol — a proxy, a ' +
          'captive portal, or a mismatched appliance version.',
        );
      }
      const key = Buffer.from(plaintext, 'base64');
      if (key.length !== BSK_LEN) {
        key.fill(0);
        throw new Error(
          `Sentinel unwrap returned ${String(key.length)} bytes; a bootstrap key is ` +
          `exactly ${String(BSK_LEN)} bytes.`,
        );
      }
      return key;
    },

    async probe(envelope: Buffer): Promise<string> {
      const response = await call('probe', {
        envelope: envelope.toString('base64'),
        purpose: BSK_PURPOSE,
      });
      const kcv = response.kcv;
      if (typeof kcv !== 'string') {
        throw new Error('Sentinel probe returned 200 without a string "kcv" field.');
      }
      return kcv;
    },
  };
}
