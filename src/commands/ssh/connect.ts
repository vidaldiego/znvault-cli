// Path: src/commands/ssh/connect.ts

/**
 * SSH connect convenience command
 */

import type { Command } from 'commander';

import * as output from '../../lib/output.js';
import { getCurrentProfile } from '../../lib/config.js';
import type { ConnectOptions } from './types.js';
import {
  getDefaultKeyPath,
  getCertificatePath,
  isCertificateValid,
  signCertificate,
} from './helpers.js';
import { resolveBookmark } from './bookmark.js';

/**
 * Result of resolving + signing an SSH-CA connection. Contains everything
 * needed to build any ssh invocation (interactive, forward, exec).
 */
export interface SignedSshBase {
  keyPath: string;
  certPath: string;
  user?: string;
  host: string;
  port: string;
  /** ['-i', key, ('-p', port)?, '-o', `CertificateFile=cert`] — ready to prefix any ssh args */
  baseSshArgs: string[];
}

/**
 * Translate child-process close state into the CLI exit status.
 *
 * Node reports a null exit code when the child was terminated by a signal.
 * Treat both that state and any explicit signal as failure: an interrupted SSH
 * session must never be accepted as a successful remote operation.
 */
export function resolveSshExitCode(
  code: number | null,
  signal: NodeJS.Signals | null
): number {
  if (code === null || signal !== null) return 1;
  return code;
}

/**
 * Resolve the SSH key, ensure a valid vault-CA certificate (auto-signing if
 * needed), and return the destination parts + base ssh args. No spawning,
 * no process.exit, no stdio side effects — safe to call from any command.
 *
 * Mirrors the key-resolution + sign logic previously inline in executeConnect,
 * so `ssh connect` and `ssh forward` share one code path.
 */
export async function ensureSignedSshBase(
  destination: string,
  options: ConnectOptions
): Promise<SignedSshBase> {
  const fs = await import('fs');
  const path = await import('path');
  const profile = getCurrentProfile();

  let user: string | undefined;
  let host: string;
  let port: string = options.port ?? '22';
  let identityOverride: string | undefined = options.identity;
  let principalsOverride: string | undefined = options.principals;

  // An explicit user@host destination is authoritative. In particular, do not
  // let a same-named, mutable bookmark replace its host, user, or explicit -i
  // identity before the vault signs the public key.
  if (destination.includes('@')) {
    const parts = destination.split('@');
    user = parts[0];
    host = parts.slice(1).join('@');
  } else {
    const bookmark = resolveBookmark(destination);
    if (bookmark) {
      host = bookmark.host;
      user = bookmark.user;
      if (bookmark.port) port = bookmark.port.toString();
      if (bookmark.identity) identityOverride = bookmark.identity;
      if (bookmark.principals && !options.principals) {
        principalsOverride = bookmark.principals.join(',');
      }
    } else {
      host = destination;
      if (profile.sshUser) user = profile.sshUser;
    }
  }

  if (options.port && options.port !== '22') port = options.port;

  // Resolve key
  let keyPath: string;
  if (identityOverride) {
    keyPath = path.resolve(identityOverride.replace(/^~/, process.env.HOME ?? ''));
    if (!fs.existsSync(keyPath)) throw new Error(`SSH key not found: ${keyPath}`);
  } else if (profile.sshIdentity && fs.existsSync(profile.sshIdentity)) {
    keyPath = profile.sshIdentity;
  } else {
    const defaultKey = await getDefaultKeyPath();
    if (!defaultKey) {
      throw new Error('No SSH key found in ~/.ssh/ — generate one with: ssh-keygen -t ed25519');
    }
    keyPath = defaultKey;
  }

  const pubKeyPath = `${keyPath}.pub`;
  if (!fs.existsSync(pubKeyPath)) throw new Error(`Public key not found: ${pubKeyPath}`);

  // Ensure cert
  const certPath = await getCertificatePath(keyPath);
  const certStatus = await isCertificateValid(certPath);
  if (options.forceSign || !certStatus.valid) {
    await signCertificate(pubKeyPath, certPath, principalsOverride, options.ttl, options.tenant);
  }

  // Build base ssh args (identity + cert + optional port)
  const baseSshArgs: string[] = ['-i', keyPath];
  if (port && port !== '22') baseSshArgs.push('-p', port);
  baseSshArgs.push('-o', `CertificateFile=${certPath}`);

  return { keyPath, certPath, user, host, port, baseSshArgs };
}

/**
 * Execute SSH connection with certificate authentication
 * Extracted for reuse by both `ssh connect` and `ssh <destination>` shortcuts
 */
export async function executeConnect(
  destination: string,
  remoteCommand: string[],
  options: ConnectOptions
): Promise<void> {
  const { spawn } = await import('child_process');
  const verbose = (msg: string) => { if (options.verbose) output.info(msg); };

  let base: SignedSshBase;
  try {
    if (options.verbose) output.info('Resolving SSH certificate...');
    base = await ensureSignedSshBase(destination, options);
    if (options.verbose) output.success('Certificate ready');
  } catch (err) {
    output.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
    return;
  }

  // Build the interactive ssh args from the shared base
  const sshArgs: string[] = [...base.baseSshArgs];
  if (options.t) sshArgs.push('-t');
  else if (options.T) sshArgs.push('-T');
  sshArgs.push(base.user ? `${base.user}@${base.host}` : base.host);
  if (remoteCommand && remoteCommand.length > 0) sshArgs.push(...remoteCommand);

  if (options.dryRun) {
    output.section('Dry Run');
    output.keyValue({
      'Key': base.keyPath,
      'Certificate': base.certPath,
      'Host': base.host,
      'User': base.user ?? '(default)',
      'Port': base.port,
      'Command': remoteCommand.length > 0 ? remoteCommand.join(' ') : '(interactive shell)',
    });
    console.log();
    output.info(`Would execute: ssh ${sshArgs.join(' ')}`);
    return;
  }

  verbose(`Executing: ssh ${sshArgs.join(' ')}`);
  if (remoteCommand.length === 0) console.log();

  const sshProcess = spawn('ssh', sshArgs, { stdio: 'inherit', env: process.env });
  sshProcess.on('close', (code, signal) => process.exit(resolveSshExitCode(code, signal)));
  sshProcess.on('error', (err) => {
    output.error(`Failed to start SSH: ${err.message}`);
    process.exit(1);
  });
}

export function registerConnectCommand(parent: Command): void {
  parent
    .command('connect <destination> [command...]')
    .description('SSH to a host using certificate authentication (auto-signs if needed)')
    .option('-i, --identity <file>', 'Path to SSH private key (default: ~/.ssh/id_ed25519)')
    .option('-p, --port <port>', 'SSH port', '22')
    .option('--principals <principals>', 'Principals for signing (admin override, comma-separated)')
    .option('--ttl <ttl>', 'Certificate TTL (e.g., 8h, 1d)')
    .option('--tenant <id>', 'Tenant ID (superadmin only)')
    .option('--force-sign', 'Force re-signing even if certificate is valid')
    .option('--dry-run', 'Show what would be done without executing SSH')
    .option('-v, --verbose', 'Show verbose output')
    .option('-t', 'Force pseudo-terminal allocation (for interactive commands)')
    .option('-T', 'Disable pseudo-terminal allocation')
    .action(async (destination: string, remoteCommand: string[], options: ConnectOptions) => {
      await executeConnect(destination, remoteCommand, options);
    });
}
