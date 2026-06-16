// Path: src/commands/ssh/forward.ts

/**
 * SSH local port-forward with vault-CA certificate authentication.
 *
 * `znvault ssh forward -L 127.0.0.1:<lport>:<rhost>:<rport> <destination>`
 * opens `ssh -N -L ...` using an auto-signed vault SSH certificate. The
 * `--print-port` machine mode binds an OS-chosen local port and prints a
 * single JSON line so callers (e.g. the payara deploy plugin) can consume it.
 */

import type { Command } from 'commander';
import * as net from 'node:net';

import * as output from '../../lib/output.js';
import type { ConnectOptions } from './types.js';
import { ensureSignedSshBase } from './connect.js';
import type { SignedSshBase } from './connect.js';

/**
 * Ask the OS for a free TCP port by binding :0 then releasing it.
 * Small TOCTOU window between release and ssh re-binding it — acceptable
 * for a deploy tool (the race would only surface as an ssh bind error, which
 * is reported and the host marked unreachable).
 */
export function pickFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.once('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address();
      if (addr && typeof addr === 'object') {
        const port = addr.port;
        srv.close(() => { resolve(port); });
      } else {
        srv.close(() => { reject(new Error('Failed to obtain a free port')); });
      }
    });
  });
}

/** A local-forward specification: bind 127.0.0.1:lport → rhost:rport over the ssh channel. */
export interface ForwardSpec {
  bindHost: string;
  localPort: number;
  remoteHost: string;
  remotePort: number;
}

/**
 * Build the `ssh -N -L ...` argv from a signed base and a forward spec.
 * Uses BatchMode + ConnectTimeout to match the codebase idiom (haproxy.ts).
 */
export function buildForwardArgs(
  base: SignedSshBase,
  spec: ForwardSpec,
  connectTimeoutSeconds: number
): string[] {
  const args = [...base.baseSshArgs];
  args.push('-o', 'BatchMode=yes');
  args.push('-o', `ConnectTimeout=${connectTimeoutSeconds}`);
  args.push('-N');
  args.push('-L', `${spec.bindHost}:${spec.localPort}:${spec.remoteHost}:${spec.remotePort}`);
  args.push(base.user ? `${base.user}@${base.host}` : base.host);
  return args;
}
