// Path: src/commands/plugin/index.ts

/**
 * Plugin Management Commands
 *
 * Commands for installing, uninstalling, and managing CLI plugins.
 */

import type { Command } from 'commander';
import { registerInstallCommand } from './install.js';
import { registerUninstallCommand } from './uninstall.js';
import { registerListCommand } from './list.js';
import { registerUpdateCommand } from './update.js';
import { registerEnableDisableCommands } from './enable-disable.js';
import { registerInfoCommand } from './info.js';

export function registerPluginCommands(program: Command): void {
  const plugin = program
    .command('plugin')
    .description('Manage CLI plugins');

  // Register all sub-commands
  registerInstallCommand(plugin);
  registerUninstallCommand(plugin);
  registerListCommand(plugin);
  registerUpdateCommand(plugin);
  registerEnableDisableCommands(plugin);
  registerInfoCommand(plugin);
}

// Re-export types for external use
export * from './types.js';

// Re-export helpers for potential reuse
export {
  getPluginsDir,
  ensurePluginsDir,
  resolvePluginName,
  getShortName,
  isValidPackageName,
  packageExists,
  getPackageVersion,
  getInstalledVersion,
  runNpm,
  validatePlugin,
  findPlugin,
} from './helpers.js';
