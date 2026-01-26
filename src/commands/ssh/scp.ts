// Path: src/commands/ssh/scp.ts

/**
 * SCP file transfer with certificate authentication
 */

import type { Command } from 'commander';
import ora from 'ora';
import * as output from '../../lib/output.js';
import { getCurrentProfile } from '../../lib/config.js';
import {
  getDefaultKeyPath,
  getCertificatePath,
  isCertificateValid,
  signCertificate,
} from './helpers.js';
import { resolveBookmark } from './bookmark.js';

interface SCPOptions {
  identity?: string;
  port?: string;
  principals?: string;
  ttl?: string;
  tenant?: string;
  forceSign?: boolean;
  recursive?: boolean;
  preserve?: boolean;
  verbose?: boolean;
  dryRun?: boolean;
}

/**
 * Parse SCP path which can be:
 * - local path: /path/to/file or ./file
 * - remote path: host:/path or user@host:/path or bookmark:/path
 */
function parseSCPPath(pathStr: string): {
  isRemote: boolean;
  user?: string;
  host?: string;
  path: string;
  bookmarkName?: string;
} {
  // Check for remote path (contains :)
  const colonIndex = pathStr.indexOf(':');
  if (colonIndex === -1 || (colonIndex === 1 && /^[a-zA-Z]$/.test(pathStr[0]))) {
    // No colon, or Windows drive letter (C:\...)
    return { isRemote: false, path: pathStr };
  }

  const hostPart = pathStr.substring(0, colonIndex);
  const remotePath = pathStr.substring(colonIndex + 1) || '.';

  // Check for user@host
  if (hostPart.includes('@')) {
    const atIndex = hostPart.indexOf('@');
    return {
      isRemote: true,
      user: hostPart.substring(0, atIndex),
      host: hostPart.substring(atIndex + 1),
      path: remotePath,
    };
  }

  // Could be a bookmark or just a host
  return {
    isRemote: true,
    host: hostPart,
    path: remotePath,
    bookmarkName: hostPart, // Will check if it's a bookmark later
  };
}

export function registerSCPCommand(parent: Command): void {
  parent
    .command('scp <source> <destination>')
    .description('Copy files using SCP with certificate authentication')
    .option('-i, --identity <file>', 'Path to SSH private key')
    .option('-P, --port <port>', 'SSH port', '22')
    .option('--principals <principals>', 'Principals for signing (admin override)')
    .option('--ttl <ttl>', 'Certificate TTL (e.g., 8h, 1d)')
    .option('--tenant <id>', 'Tenant ID (superadmin only)')
    .option('--force-sign', 'Force re-signing even if certificate is valid')
    .option('-r, --recursive', 'Recursively copy directories')
    .option('-p, --preserve', 'Preserve modification times and modes')
    .option('-v, --verbose', 'Show verbose output')
    .option('--dry-run', 'Show what would be done without executing')
    .action(async (source: string, destination: string, options: SCPOptions) => {
      const fs = await import('fs');
      const pathModule = await import('path');
      const { spawn } = await import('child_process');

      const profile = getCurrentProfile();

      // Parse source and destination
      const srcParsed = parseSCPPath(source);
      const dstParsed = parseSCPPath(destination);

      // Validate: one must be local, one must be remote
      if (!srcParsed.isRemote && !dstParsed.isRemote) {
        output.error('At least one path must be remote (host:path)');
        process.exit(1);
      }
      if (srcParsed.isRemote && dstParsed.isRemote) {
        output.error('Cannot copy between two remote hosts directly');
        output.info('Copy to local first, then to the other host');
        process.exit(1);
      }

      // Get the remote part
      const remotePart = srcParsed.isRemote ? srcParsed : dstParsed;
      let host = remotePart.host!;
      let user = remotePart.user;
      let port = options.port ?? '22';
      let identityOverride = options.identity;
      let principalsOverride = options.principals;

      // Check if host is a bookmark
      if (remotePart.bookmarkName) {
        const bookmark = resolveBookmark(remotePart.bookmarkName);
        if (bookmark) {
          host = bookmark.host;
          user = bookmark.user ?? user;
          if (bookmark.port) port = bookmark.port.toString();
          if (bookmark.identity) identityOverride = bookmark.identity;
          if (bookmark.principals && !options.principals) {
            principalsOverride = bookmark.principals.join(',');
          }
          if (options.verbose) {
            output.info(`Using bookmark '${remotePart.bookmarkName}' → ${bookmark.host}`);
          }
        }
      }

      // Fall back to profile defaults
      if (!user && profile.sshUser) {
        user = profile.sshUser;
      }

      const verbose = (msg: string) => {
        if (options.verbose) output.info(msg);
      };

      try {
        // Step 1: Find SSH key
        let keyPath: string;
        if (identityOverride) {
          keyPath = pathModule.resolve(identityOverride.replace(/^~/, process.env.HOME ?? ''));
          if (!fs.existsSync(keyPath)) {
            output.error(`SSH key not found: ${keyPath}`);
            process.exit(1);
          }
          verbose(`Using specified key: ${keyPath}`);
        } else if (profile.sshIdentity && fs.existsSync(profile.sshIdentity)) {
          keyPath = profile.sshIdentity;
          verbose(`Using configured key: ${keyPath}`);
        } else {
          const defaultKey = await getDefaultKeyPath();
          if (!defaultKey) {
            output.error('No SSH key found in ~/.ssh/');
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
        const certStatus = await isCertificateValid(certPath);
        const needsSign = options.forceSign || !certStatus.valid;

        if (options.verbose && !certStatus.valid) {
          output.warn(`Certificate needs signing: ${certStatus.reason}`);
        }

        // Step 3: Sign if needed
        if (needsSign) {
          const spinner = ora('Signing certificate...').start();
          try {
            await signCertificate(pubKeyPath, certPath, principalsOverride, options.ttl, options.tenant);
            spinner.succeed('Certificate signed');
          } catch (err) {
            spinner.fail('Failed to sign certificate');
            output.error(err instanceof Error ? err.message : String(err));
            process.exit(1);
          }
        } else {
          verbose('Using existing valid certificate');
        }

        // Step 4: Build SCP command
        const scpArgs: string[] = [];

        // Add identity
        scpArgs.push('-i', keyPath);

        // Add port (SCP uses -P not -p)
        if (port !== '22') {
          scpArgs.push('-P', port);
        }

        // Add certificate option
        scpArgs.push('-o', `CertificateFile=${certPath}`);

        // Add options
        if (options.recursive) scpArgs.push('-r');
        if (options.preserve) scpArgs.push('-p');
        if (options.verbose) scpArgs.push('-v');

        // Build remote path string
        const buildRemotePath = (parsed: ReturnType<typeof parseSCPPath>) => {
          if (!parsed.isRemote) return parsed.path;
          const userPart = user ? `${user}@` : '';
          return `${userPart}${host}:${parsed.path}`;
        };

        // Add source and destination
        scpArgs.push(srcParsed.isRemote ? buildRemotePath(srcParsed) : srcParsed.path);
        scpArgs.push(dstParsed.isRemote ? buildRemotePath(dstParsed) : dstParsed.path);

        // Execute or dry-run
        if (options.dryRun) {
          output.section('Dry Run');
          output.keyValue({
            'Source': srcParsed.isRemote ? buildRemotePath(srcParsed) : srcParsed.path,
            'Destination': dstParsed.isRemote ? buildRemotePath(dstParsed) : dstParsed.path,
            'Key': keyPath,
            'Certificate': certPath,
            'Port': port,
          });
          console.log();
          output.info(`Would execute: scp ${scpArgs.join(' ')}`);
          return;
        }

        verbose(`Executing: scp ${scpArgs.join(' ')}`);

        const scpProcess = spawn('scp', scpArgs, {
          stdio: 'inherit',
          env: process.env,
        });

        scpProcess.on('close', (code) => {
          if (code === 0) {
            output.success('Transfer complete');
          }
          process.exit(code ?? 0);
        });

        scpProcess.on('error', (err) => {
          output.error(`Failed to start SCP: ${err.message}`);
          process.exit(1);
        });
      } catch (err) {
        output.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    });
}
