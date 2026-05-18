// Path: src/commands/ssh/index.ts

/**
 * SSH Certificate Authority commands
 *
 * This module provides comprehensive SSH CA management including:
 * - CA lifecycle (init, status, delete, public-key)
 * - Certificate signing and management
 * - Principal mappings (SSO groups → SSH principals)
 * - Server groups with access rules
 * - Local SSH configuration and defaults
 * - Host bookmarks for quick access
 * - Host discovery from registered agents
 * - SCP file transfer with certificate auth
 * - Convenience connect command with auto-signing
 *
 * Quick connect shortcut:
 *   znvault ssh user@host          # Direct connection
 *   znvault ssh my-bookmark        # Connect via bookmark
 */

import type { Command } from 'commander';
import { registerCACommands } from './ca.js';
import { registerCertCommands } from './cert.js';
import { registerMappingCommands } from './mapping.js';
import { registerServerGroupCommands } from './server-group.js';
import { registerConfigCommands } from './config.js';
import { registerConnectCommand, executeConnect } from './connect.js';
import { registerBookmarkCommands, resolveBookmark } from './bookmark.js';
import { registerSCPCommand } from './scp.js';
import { registerHostsCommand } from './hosts.js';
import { registerExecCommand } from './exec.js';
import type { ConnectOptions } from './types.js';
import {
  resolveContext,
  withRegisterContext,
  type RegisterOptions,
} from '../../lib/command-context.js';

// Known subcommands that should NOT be treated as destinations
const SSH_SUBCOMMANDS = new Set([
  'ca', 'cert', 'mapping', 'server-group', 'config',
  'bookmark', 'bm', 'hosts', 'scp', 'connect', 'exec',
  'help', '--help', '-h',
]);

/**
 * Check if a string looks like an SSH destination rather than a subcommand
 */
function looksLikeDestination(arg: string): boolean {
  // Known subcommand - definitely not a destination
  if (SSH_SUBCOMMANDS.has(arg)) {
    return false;
  }

  // Contains @ - it's user@host format
  if (arg.includes('@')) {
    return true;
  }

  // Is a bookmark
  if (resolveBookmark(arg)) {
    return true;
  }

  // Looks like an IP address (v4 or v6)
  if (/^[\d.:]+$/.test(arg) || arg.startsWith('[')) {
    return true;
  }

  // Contains dots - likely a hostname
  if (arg.includes('.')) {
    return true;
  }

  // Short hostname without dots - could be a bookmark or local host
  // Only treat as destination if it doesn't look like a flag
  if (!arg.startsWith('-') && /^[a-zA-Z0-9][\w-]*$/.test(arg)) {
    // Could be an unknown subcommand or a simple hostname
    // Be conservative: only treat as destination if it resolves to a bookmark
    // This prevents `znvault ssh typo` from trying to connect
    return false;
  }

  return false;
}

export function registerSSHCommands(parent: Command, opts?: RegisterOptions): void {
  const ctx = resolveContext(opts);
  const ssh = parent
    .command('ssh')
    .description('SSH CA management and quick connect (znvault ssh user@host)')
    .argument('[destination]', 'Host to connect to (user@host or bookmark name)')
    .argument('[command...]', 'Remote command to execute')
    .option('-i, --identity <file>', 'Path to SSH private key')
    .option('-p, --port <port>', 'SSH port', '22')
    .option('--principals <principals>', 'Principals for signing (comma-separated)')
    .option('--ttl <ttl>', 'Certificate TTL (e.g., 8h, 1d)')
    .option('--tenant <id>', 'Tenant ID (superadmin only)')
    .option('--force-sign', 'Force re-signing even if certificate is valid')
    .option('--dry-run', 'Show what would be done without executing SSH')
    .option('-v, --verbose', 'Show verbose output')
    .option('-t', 'Force pseudo-terminal allocation')
    .option('-T', 'Disable pseudo-terminal allocation')
    .allowUnknownOption(false)
    .action(async (destination: string | undefined, remoteCommand: string[], options: ConnectOptions) => {
      // If no destination provided, show help
      if (!destination) {
        ssh.outputHelp();
        return;
      }

      // Check if it looks like a destination
      if (looksLikeDestination(destination)) {
        await executeConnect(destination, remoteCommand, options);
      } else {
        // Not a destination - might be a typo or unknown subcommand
        // Show help with a hint
        console.error(`Unknown subcommand or destination: ${destination}`);
        console.error('');
        console.error('For quick connect, use: znvault ssh user@host');
        console.error('For subcommands, use:  znvault ssh <command> --help');
        console.error('');
        ssh.outputHelp();
        process.exit(1);
      }
    });

  // Register all sub-command groups under the active context (controls whether
  // `--tenant` options are accepted; see command-context.applyTenantContextPatch).
  withRegisterContext(ctx, () => {
    registerCACommands(ssh);
    registerCertCommands(ssh);
    registerMappingCommands(ssh);
    registerServerGroupCommands(ssh);
    registerConfigCommands(ssh);
    registerBookmarkCommands(ssh);
    registerHostsCommand(ssh);
    registerSCPCommand(ssh);
    registerConnectCommand(ssh);
    registerExecCommand(ssh);
  });
}

// Re-export types for external use
export * from './types.js';

// Re-export helpers for potential reuse
export {
  getDefaultKeyPath,
  getCertificatePath,
  isCertificateValid,
  signCertificate,
  formatTtl,
  parseTtl,
  isExpired,
  buildTenantQuery,
  parseCertificateInfo,
  formatRemainingTime,
} from './helpers.js';

// Re-export bookmark resolver
export { resolveBookmark } from './bookmark.js';
