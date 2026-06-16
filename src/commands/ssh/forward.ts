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
