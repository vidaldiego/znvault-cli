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
      if (addr !== null && typeof addr === 'object') {
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

/** Options accepted by `znvault ssh forward`. Extends ConnectOptions with forward-specific fields. */
export interface ForwardOptions extends ConnectOptions {
  /** -L spec: "[bindHost:]lport:rhost:rport". lport 0 = OS-assigned. */
  L?: string;
  /** Print one JSON line with the chosen local port and keep running. */
  printPort?: boolean;
}

/**
 * Parse a `-L` forward spec. Accepts 4-part (bindHost:lport:rhost:rport) or
 * 3-part (lport:rhost:rport, bindHost defaults to 127.0.0.1).
 */
export function parseForwardOption(spec: string): ForwardSpec {
  const parts = spec.split(':');
  if (parts.length === 4) {
    return {
      bindHost: parts[0],
      localPort: Number(parts[1]),
      remoteHost: parts[2],
      remotePort: Number(parts[3]),
    };
  }
  if (parts.length === 3) {
    return {
      bindHost: '127.0.0.1',
      localPort: Number(parts[0]),
      remoteHost: parts[1],
      remotePort: Number(parts[2]),
    };
  }
  throw new Error(`Invalid forward spec "${spec}". Use "[bindHost:]localPort:remoteHost:remotePort".`);
}

const DEFAULT_FORWARD_REMOTE_PORT = 9100;
const FORWARD_CONNECT_TIMEOUT_SECONDS = 10;

/**
 * Run the forward: sign the cert, pick a port if lport==0, spawn `ssh -N -L`,
 * and (in --print-port mode) emit one JSON line to stdout then hold the tunnel.
 */
export async function runForward(
  destination: string,
  options: ForwardOptions
): Promise<void> {
  const { spawn } = await import('child_process');

  const spec = options.L
    ? parseForwardOption(options.L)
    : { bindHost: '127.0.0.1', localPort: 0, remoteHost: '127.0.0.1', remotePort: DEFAULT_FORWARD_REMOTE_PORT };

  // Resolve a concrete local port (O1): pick a free one when 0 was requested.
  if (spec.localPort === 0) {
    spec.localPort = await pickFreePort();
  }

  let base: SignedSshBase;
  try {
    base = await ensureSignedSshBase(destination, options);
  } catch (err) {
    output.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
    return;
  }

  const sshArgs = buildForwardArgs(base, spec, FORWARD_CONNECT_TIMEOUT_SECONDS);

  if (options.dryRun) {
    output.section('Dry Run');
    output.keyValue({
      'Key': base.keyPath,
      'Certificate': base.certPath,
      'Forward': `${spec.bindHost}:${spec.localPort} → ${base.host}:${spec.remotePort}`,
      'User': base.user ?? '(default)',
    });
    console.log();
    output.info(`Would execute: ssh ${sshArgs.join(' ')}`);
    return;
  }

  // All human/log output goes to STDERR so stdout stays a clean machine channel.
  const sshProcess = spawn('ssh', sshArgs, {
    stdio: ['ignore', 'ignore', 'inherit'],
    env: process.env,
  });

  // Set from the child's event callbacks; `as boolean` stops TS narrowing it to the literal `false`.
  let exited = false as boolean;
  sshProcess.on('error', (err) => {
    exited = true;
    process.stderr.write(`Failed to start SSH: ${err.message}\n`);
    process.exit(1);
  });
  sshProcess.on('close', (code) => {
    exited = true;
    process.exit(code ?? 0);
  });

  // Teardown on our own termination so we never orphan the ssh -N child.
  const cleanup = (): void => { if (!exited && sshProcess.pid) sshProcess.kill('SIGTERM'); };
  process.on('SIGINT', () => { cleanup(); process.exit(0); });
  process.on('SIGTERM', () => { cleanup(); process.exit(0); });

  if (options.printPort) {
    // ssh -N has no "ready" signal on stdout; give it a moment to establish,
    // then emit the contract line. forwardUp = ssh started + port bound by us.
    await new Promise((r) => setTimeout(r, 300));
    if (!exited) {
      process.stdout.write(
        JSON.stringify({ localPort: spec.localPort, pid: sshProcess.pid, forwardUp: true }) + '\n'
      );
    }
  } else {
    process.stderr.write(
      `Forwarding 127.0.0.1:${spec.localPort} → ${base.host}:${spec.remotePort} (Ctrl-C to stop)\n`
    );
  }
}

export function registerForwardCommand(parent: Command): void {
  parent
    .command('forward <destination>')
    .description('Open an SSH local port-forward authenticated by the vault SSH CA')
    .option('-L <spec>', 'Forward spec: [bindHost:]localPort:remoteHost:remotePort (localPort 0 = auto)')
    .option('--print-port', 'Print {"localPort","pid","forwardUp"} JSON then hold the tunnel (machine mode)')
    .option('-i, --identity <file>', 'Path to SSH private key')
    .option('-p, --port <port>', 'SSH port', '22')
    .option('--principals <principals>', 'Principals for signing (comma-separated)')
    .option('--ttl <ttl>', 'Certificate TTL (e.g., 8h, 1d)')
    .option('--tenant <id>', 'Tenant ID (superadmin only)')
    .option('--force-sign', 'Force re-signing even if certificate is valid')
    .option('--dry-run', 'Show what would be done without executing SSH')
    .option('-v, --verbose', 'Show verbose output')
    .action(async (destination: string, options: ForwardOptions) => {
      await runForward(destination, options);
    });
}
