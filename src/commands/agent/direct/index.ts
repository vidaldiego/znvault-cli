// Path: src/commands/agent/direct/index.ts

/**
 * Direct agent communication commands registration
 *
 * These commands communicate directly with agents via HTTP, not through the vault.
 */

import type { Command } from 'commander';
import { registerPingCommand } from './ping.js';
import { registerPluginsCommand } from './plugins.js';
import { registerUpdatePluginsCommand } from './update-plugins.js';
import { registerVersionCommand } from './version.js';
import { registerUpdateCommand } from './update.js';
import { registerUpdateAllCommand } from './update-all.js';

export function registerDirectCommands(parentCmd: Command): void {
  registerPingCommand(parentCmd);
  registerPluginsCommand(parentCmd);
  registerUpdatePluginsCommand(parentCmd);
  registerVersionCommand(parentCmd);
  registerUpdateCommand(parentCmd);
  registerUpdateAllCommand(parentCmd);
}
