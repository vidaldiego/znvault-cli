// Path: src/commands/agent/index.ts

/**
 * Agent commands - main entry point
 *
 * This module provides the command registration function that combines
 * all agent subcommands into a single command group.
 *
 * Command structure:
 *
 * agent
 * ├── list (alias for remote list)
 * ├── connections (alias for remote connections)
 * ├── status <id> (alias for remote status)
 * ├── alerts <id> (alias for remote alerts)
 * ├── delete <id> (alias for remote delete)
 * ├── reprovision
 * │   ├── create <id>
 * │   ├── status <id>
 * │   └── cancel <id>
 * ├── token
 * │   ├── create <key>
 * │   ├── list <key>
 * │   └── revoke <id> -k <key>
 * ├── ping [host:port]
 * ├── plugins [host:port]
 * ├── update-plugins [host:port]
 * ├── version [host:port]
 * ├── update [host:port]
 * ├── update-all
 * └── remote (backwards compat group)
 *     ├── list
 *     ├── connections
 *     ├── status <id>
 *     ├── alerts <id>
 *     ├── delete <id>
 *     ├── reprovision
 *     │   ├── create <id>
 *     │   ├── status <id>
 *     │   └── cancel <id>
 *     ├── reprovision-status <id> (deprecated alias)
 *     └── cancel-reprovision <id> (deprecated alias)
 */

import type { Command } from 'commander';
import { registerDirectCommands } from './direct/index.js';
import { registerTokenCommands } from './token/index.js';
import { registerRemoteCommands, registerFlattenedRemoteCommands } from './remote/index.js';
import { registerReprovisionCommands } from './remote/reprovision/index.js';
import {
  resolveContext,
  withRegisterContext,
  type RegisterOptions,
} from '../../lib/command-context.js';

export function registerAgentCommands(parent: Command, opts?: RegisterOptions): void {
  const ctx = resolveContext(opts);
  const agent = parent
    .command('agent')
    .description('Manage remote agents and registration tokens');

  withRegisterContext(ctx, () => {
    // ===== Flattened Remote Commands =====
    // These are the primary commands (e.g., `agent list` instead of `agent remote list`)
    registerFlattenedRemoteCommands(agent);

    // ===== Reprovision Commands (nested under agent) =====
    // e.g., `agent reprovision create <id>`
    registerReprovisionCommands(agent);

    // ===== Token Commands =====
    // e.g., `agent token create <key>`
    registerTokenCommands(agent);

    // ===== Direct HTTP Commands =====
    // e.g., `agent ping`, `agent update-all`
    registerDirectCommands(agent);

    // ===== Remote Commands (for backwards compatibility) =====
    // e.g., `agent remote list` still works
    // Note: `agent remote reprovision` is now a subcommand group with create/status/cancel
    // Old usage: `agent remote reprovision <id>` → New usage: `agent remote reprovision create <id>`
    registerRemoteCommands(agent);
  });
}

// Re-export types for external use
export * from './types.js';
