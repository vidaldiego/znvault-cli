// Path: src/commands/ssh/connect.ts

/**
 * SSH connect convenience command
 */

import type { Command } from 'commander';
import ora from 'ora';
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
 * Execute SSH connection with certificate authentication
 * Extracted for reuse by both `ssh connect` and `ssh <destination>` shortcuts
 */
export async function executeConnect(
  destination: string,
  remoteCommand: string[],
  options: ConnectOptions
): Promise<void> {
  const fs = await import('fs');
  const path = await import('path');
  const { spawn } = await import('child_process');

  // Get profile config for defaults
  const profile = getCurrentProfile();

  // Resolve destination: could be a bookmark, user@host, or just host
  let user: string | undefined;
  let host: string;
  let port: string = options.port ?? '22';
  let identityOverride: string | undefined = options.identity;
  let principalsOverride: string | undefined = options.principals;

  // Check if destination is a bookmark
  const bookmark = resolveBookmark(destination);
  if (bookmark) {
    host = bookmark.host;
    user = bookmark.user;
    if (bookmark.port) {
      port = bookmark.port.toString();
    }
    if (bookmark.identity) {
      identityOverride = bookmark.identity;
    }
    if (bookmark.principals && !options.principals) {
      principalsOverride = bookmark.principals.join(',');
    }
    if (options.verbose) {
      output.info(`Using bookmark '${destination}' → ${bookmark.host}`);
    }
  } else if (destination.includes('@')) {
    const parts = destination.split('@');
    user = parts[0];
    host = parts.slice(1).join('@'); // Handle IPv6 or multiple @
  } else {
    host = destination;
    // Use default user from config if available
    if (profile.sshUser) {
      user = profile.sshUser;
    }
  }

  // Command line options override bookmark settings
  if (options.port && options.port !== '22') {
    port = options.port;
  }

  const verbose = (msg: string) => {
    if (options.verbose) {
      output.info(msg);
    }
  };

  try {
    // Step 1: Find SSH key
    let keyPath: string;
    if (identityOverride) {
      keyPath = path.resolve(identityOverride.replace(/^~/, process.env.HOME ?? ''));
      if (!fs.existsSync(keyPath)) {
        output.error(`SSH key not found: ${keyPath}`);
        process.exit(1);
      }
      verbose(`Using specified key: ${keyPath}`);
    } else if (profile.sshIdentity && fs.existsSync(profile.sshIdentity)) {
      // Use configured identity from profile
      keyPath = profile.sshIdentity;
      verbose(`Using configured key: ${keyPath}`);
    } else {
      const defaultKey = await getDefaultKeyPath();
      if (!defaultKey) {
        output.error('No SSH key found in ~/.ssh/');
        output.info('Generate one with: ssh-keygen -t ed25519');
        output.info('Or specify a key with: znvault ssh -i /path/to/key user@host');
        process.exit(1);
      }
      keyPath = defaultKey;
      verbose(`Using default key: ${keyPath}`);
    }

    const pubKeyPath = `${keyPath}.pub`;
    if (!fs.existsSync(pubKeyPath)) {
      output.error(`Public key not found: ${pubKeyPath}`);
      process.exit(1);
    }

    // Step 2: Check certificate validity
    const certPath = await getCertificatePath(keyPath);
    verbose(`Certificate path: ${certPath}`);

    const certStatus = await isCertificateValid(certPath);
    const needsSign = options.forceSign || !certStatus.valid;

    if (options.verbose && !certStatus.valid) {
      output.warn(`Certificate needs signing: ${certStatus.reason}`);
    } else if (options.verbose && certStatus.valid) {
      output.success('Certificate is valid');
    }

    // Step 3: Sign if needed
    if (needsSign) {
      const spinner = ora('Signing certificate...').start();
      try {
        await signCertificate(pubKeyPath, certPath, principalsOverride, options.ttl, options.tenant);
        spinner.succeed('Certificate signed');

        // Show certificate info
        if (options.verbose) {
          const { execSync } = await import('child_process');
          try {
            const certInfo = execSync(`ssh-keygen -L -f "${certPath}"`, { encoding: 'utf8' });
            const principalsMatch = certInfo.match(/Principals:\s*([\s\S]*?)(?=\s+Critical Options:)/);
            const validMatch = certInfo.match(/Valid:\s+from\s+(\S+)\s+to\s+(\S+)/);

            if (principalsMatch) {
              const principals = principalsMatch[1].trim().split('\n').map(p => p.trim()).filter(Boolean);
              output.info(`Principals: ${principals.join(', ')}`);
            }
            if (validMatch) {
              output.info(`Valid until: ${validMatch[2]}`);
            }
          } catch {
            // Ignore cert inspection errors
          }
        }
      } catch (err) {
        spinner.fail('Failed to sign certificate');
        output.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    } else if (!options.verbose) {
      // In non-verbose mode, just mention we're using existing cert
      output.info('Using existing valid certificate');
    }

    // Step 4: Build SSH command
    const sshArgs: string[] = [];

    // Add identity file (this tells SSH to use our key + cert)
    sshArgs.push('-i', keyPath);

    // Add port if not default
    if (port && port !== '22') {
      sshArgs.push('-p', port);
    }

    // Add TTY allocation flags
    if (options.t) {
      sshArgs.push('-t');
    } else if (options.T) {
      sshArgs.push('-T');
    }

    // Explicitly tell SSH to use the certificate
    sshArgs.push('-o', `CertificateFile=${certPath}`);

    // Add destination
    if (user) {
      sshArgs.push(`${user}@${host}`);
    } else {
      sshArgs.push(host);
    }

    // Add remote command if specified
    if (remoteCommand && remoteCommand.length > 0) {
      sshArgs.push(...remoteCommand);
    }

    // Step 5: Execute SSH
    if (options.dryRun) {
      output.section('Dry Run');
      output.keyValue({
        'Key': keyPath,
        'Certificate': certPath,
        'Host': host,
        'User': user ?? '(default)',
        'Port': port,
        'Principals': principalsOverride ?? '(from mapping)',
        'Command': remoteCommand.length > 0 ? remoteCommand.join(' ') : '(interactive shell)',
      });
      console.log();
      output.info(`Would execute: ssh ${sshArgs.join(' ')}`);
      return;
    }

    verbose(`Executing: ssh ${sshArgs.join(' ')}`);

    // Only print empty line for interactive sessions
    if (remoteCommand.length === 0) {
      console.log();
    }

    // Spawn SSH with stdio inherited (interactive session)
    const sshProcess = spawn('ssh', sshArgs, {
      stdio: 'inherit',
      env: process.env,
    });

    sshProcess.on('close', (code) => {
      process.exit(code ?? 0);
    });

    sshProcess.on('error', (err) => {
      output.error(`Failed to start SSH: ${err.message}`);
      process.exit(1);
    });
  } catch (err) {
    output.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
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
