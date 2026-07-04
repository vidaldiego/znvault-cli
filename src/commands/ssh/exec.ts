// Path: src/commands/ssh/exec.ts

/**
 * Multi-host command execution
 */

import type { Command } from 'commander';

import * as output from '../../lib/output.js';
import { getCurrentProfile } from '../../lib/config.js';
import {
  getDefaultKeyPath,
  getCertificatePath,
  isCertificateValid,
  signCertificate,
} from './helpers.js';
import { resolveBookmark } from './bookmark.js';

interface ExecOptions {
  identity?: string;
  port?: string;
  principals?: string;
  ttl?: string;
  tenant?: string;
  forceSign?: boolean;
  parallel?: boolean;
  failFast?: boolean;
  timeout?: string;
  quiet?: boolean;
}

interface HostResult {
  host: string;
  displayName: string;
  success: boolean;
  exitCode: number;
  stdout: string;
  stderr: string;
  error?: string;
}

/**
 * Resolve a destination to host connection info
 */
function resolveDestination(
  destination: string,
  profile: { sshUser?: string }
): { host: string; user?: string; port: string; displayName: string } {
  // Check if it's a bookmark
  const bookmark = resolveBookmark(destination);
  if (bookmark) {
    return {
      host: bookmark.host,
      user: bookmark.user ?? profile.sshUser,
      port: bookmark.port?.toString() ?? '22',
      displayName: destination,
    };
  }

  // Parse user@host format
  if (destination.includes('@')) {
    const parts = destination.split('@');
    const user = parts[0];
    const host = parts.slice(1).join('@');
    return { host, user, port: '22', displayName: destination };
  }

  // Just a host
  return {
    host: destination,
    user: profile.sshUser,
    port: '22',
    displayName: destination,
  };
}

/**
 * Execute command on a single host
 */
async function executeOnHost(
  command: string,
  hostInfo: { host: string; user?: string; port: string; displayName: string },
  keyPath: string,
  certPath: string,
  options: ExecOptions
): Promise<HostResult> {
  const { execSync } = await import('child_process');

  const sshArgs: string[] = [
    '-i', keyPath,
    '-o', 'CertificateFile=' + certPath,
    '-o', 'BatchMode=yes',
    '-o', 'StrictHostKeyChecking=accept-new',
    '-o', 'ConnectTimeout=' + (options.timeout ?? '10'),
  ];

  if (hostInfo.port !== '22') {
    sshArgs.push('-p', hostInfo.port);
  }

  const destination = hostInfo.user 
    ? hostInfo.user + '@' + hostInfo.host 
    : hostInfo.host;
  
  sshArgs.push(destination, command);

  try {
    const stdout = execSync('ssh ' + sshArgs.map(a => a.includes(' ') ? '"' + a + '"' : a).join(' '), {
      encoding: 'utf8',
      timeout: parseInt(options.timeout ?? '30') * 1000,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    return {
      host: hostInfo.host,
      displayName: hostInfo.displayName,
      success: true,
      exitCode: 0,
      stdout: stdout.trim(),
      stderr: '',
    };
  } catch (err: unknown) {
    // execFileSync-style errors carry stdout/stderr as Buffer (or string), so the
    // .toString() below is load-bearing — annotate the type to match reality.
    const error = err as { status?: number; stdout?: string | Buffer; stderr?: string | Buffer; message?: string };
    return {
      host: hostInfo.host,
      displayName: hostInfo.displayName,
      success: false,
      exitCode: error.status ?? 1,
      stdout: (error.stdout ?? '').toString().trim(),
      stderr: (error.stderr ?? '').toString().trim(),
      error: error.message,
    };
  }
}

export function registerExecCommand(parent: Command): void {
  parent
    .command('exec <command> <hosts...>')
    .description('Execute command on multiple hosts')
    .option('-i, --identity <file>', 'Path to SSH private key')
    .option('-p, --port <port>', 'SSH port (can be overridden per-host via bookmarks)')
    .option('--principals <principals>', 'Principals for signing (admin override)')
    .option('--ttl <ttl>', 'Certificate TTL (e.g., 8h, 1d)')
    .option('--tenant <id>', 'Tenant ID (superadmin only)')
    .option('--force-sign', 'Force re-signing certificate')
    .option('--parallel', 'Run on all hosts in parallel (default: sequential)')
    .option('--fail-fast', 'Stop on first failure (sequential mode only)')
    .option('--timeout <seconds>', 'Connection timeout per host', '30')
    .option('-q, --quiet', 'Only show output, no status messages')
    .action(async (command: string, hosts: string[], options: ExecOptions) => {
      const fs = await import('fs');
      const pathModule = await import('path');

      const profile = getCurrentProfile();

      // Resolve all hosts first
      const resolvedHosts = hosts.map(h => resolveDestination(h, profile));

      if (!options.quiet) {
        output.section('Multi-Host Execution');
        output.info('Command: ' + command);
        output.info('Hosts: ' + resolvedHosts.map(h => h.displayName).join(', '));
        output.info('Mode: ' + (options.parallel ? 'parallel' : 'sequential'));
        console.log();
      }

      // Find SSH key
      let keyPath: string;
      if (options.identity) {
        keyPath = pathModule.resolve(options.identity.replace(/^~/, process.env.HOME ?? ''));
        if (!fs.existsSync(keyPath)) {
          output.error('SSH key not found: ' + keyPath);
          process.exit(1);
        }
      } else if (profile.sshIdentity && fs.existsSync(profile.sshIdentity)) {
        keyPath = profile.sshIdentity;
      } else {
        const defaultKey = await getDefaultKeyPath();
        if (!defaultKey) {
          output.error('No SSH key found');
          process.exit(1);
        }
        keyPath = defaultKey;
      }

      const pubKeyPath = keyPath + '.pub';
      if (!fs.existsSync(pubKeyPath)) {
        output.error('Public key not found: ' + pubKeyPath);
        process.exit(1);
      }

      // Check/sign certificate
      const certPath = await getCertificatePath(keyPath);
      const certStatus = await isCertificateValid(certPath);

      if (options.forceSign || !certStatus.valid) {
        const spinner = output.spinner('Signing certificate...').start();
        try {
          await signCertificate(pubKeyPath, certPath, options.principals, options.ttl, options.tenant);
          spinner.succeed('Certificate signed');
        } catch (err) {
          spinner.fail('Failed to sign certificate');
          output.error(err instanceof Error ? err.message : String(err));
          process.exit(1);
        }
      }

      // Execute on hosts
      const results: HostResult[] = [];
      let hasFailure = false;

      if (options.parallel) {
        // Parallel execution
        const spinner = output.spinner('Executing on ' + resolvedHosts.length + ' hosts...').start();
        
        const promises = resolvedHosts.map(hostInfo => 
          executeOnHost(command, hostInfo, keyPath, certPath, options)
        );
        
        const parallelResults = await Promise.all(promises);
        results.push(...parallelResults);
        
        const successCount = results.filter(r => r.success).length;
        spinner.stop();
        
        if (!options.quiet) {
          output.info('Completed: ' + successCount + '/' + results.length + ' succeeded');
          console.log();
        }
      } else {
        // Sequential execution
        for (const hostInfo of resolvedHosts) {
          if (!options.quiet) {
            process.stdout.write('● ' + hostInfo.displayName + '... ');
          }

          const result = await executeOnHost(command, hostInfo, keyPath, certPath, options);
          results.push(result);

          if (!options.quiet) {
            if (result.success) {
              console.log('\x1b[32m✓\x1b[0m');
            } else {
              console.log('\x1b[31m✗\x1b[0m (exit ' + result.exitCode + ')');
            }
          }

          if (!result.success) {
            hasFailure = true;
            if (options.failFast) {
              output.warn('Stopping due to --fail-fast');
              break;
            }
          }
        }
        console.log();
      }

      // Display results
      for (const result of results) {
        output.section(result.displayName + (result.success ? '' : ' (FAILED)'));
        
        if (result.stdout) {
          console.log(result.stdout);
        }
        if (result.stderr) {
          console.log('\x1b[33m' + result.stderr + '\x1b[0m');
        }
        if (!result.stdout && !result.stderr && result.error) {
          output.error(result.error);
        }
        console.log();
      }

      // Summary
      const successCount = results.filter(r => r.success).length;
      const failCount = results.filter(r => !r.success).length;

      if (failCount > 0) {
        output.warn('Summary: ' + successCount + ' succeeded, ' + failCount + ' failed');
        process.exit(1);
      } else {
        output.success('All ' + successCount + ' hosts completed successfully');
      }
    });
}
