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
 */

import type { Command } from 'commander';
import { registerCACommands } from './ca.js';
import { registerCertCommands } from './cert.js';
import { registerMappingCommands } from './mapping.js';
import { registerServerGroupCommands } from './server-group.js';
import { registerConfigCommands } from './config.js';
import { registerConnectCommand } from './connect.js';
import { registerBookmarkCommands } from './bookmark.js';
import { registerSCPCommand } from './scp.js';
import { registerHostsCommand } from './hosts.js';
import { registerExecCommand } from './exec.js';

export function registerSSHCommands(program: Command): void {
  const ssh = program
    .command('ssh')
    .description('SSH Certificate Authority management');

  // Register all sub-command groups
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
