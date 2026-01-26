// Path: src/commands/plugin/enable-disable.ts

/**
 * Plugin enable/disable commands
 */

import type { Command } from 'commander';
import chalk from 'chalk';
import * as output from '../../lib/output.js';
import { getPlugins, setPluginEnabled } from '../../lib/config.js';
import type { PluginEnableDisableOptions } from './types.js';
import { getShortName, findPlugin } from './helpers.js';

export function registerEnableDisableCommands(parent: Command): void {
  // Enable command
  parent
    .command('enable <name>')
    .description('Enable a disabled plugin')
    .option('--json', 'Output as JSON')
    .action((name: string, options: PluginEnableDisableOptions) => {
      const plugins = getPlugins();
      const found = findPlugin(plugins, name);

      if (!found) {
        output.error(`Plugin not found: ${name}`);
        console.log('Use "znvault plugin list" to see installed plugins.');
        process.exit(1);
      }

      if (found.enabled !== false) {
        if (options.json) {
          output.json({ success: true, name: getShortName(found.package ?? name), alreadyEnabled: true });
          return;
        }
        console.log(`Plugin ${chalk.cyan(getShortName(found.package ?? name))} is already enabled.`);
        return;
      }

      setPluginEnabled(found.package ?? found.path ?? '', true);
      if (options.json) {
        output.json({ success: true, name: getShortName(found.package ?? name) });
        return;
      }
      output.success(`Enabled plugin: ${getShortName(found.package ?? name)}`);
    });

  // Disable command
  parent
    .command('disable <name>')
    .description('Disable a plugin without uninstalling')
    .option('--json', 'Output as JSON')
    .action((name: string, options: PluginEnableDisableOptions) => {
      const plugins = getPlugins();
      const found = findPlugin(plugins, name);

      if (!found) {
        output.error(`Plugin not found: ${name}`);
        console.log('Use "znvault plugin list" to see installed plugins.');
        process.exit(1);
      }

      if (found.enabled === false) {
        if (options.json) {
          output.json({ success: true, name: getShortName(found.package ?? name), alreadyDisabled: true });
          return;
        }
        console.log(`Plugin ${chalk.cyan(getShortName(found.package ?? name))} is already disabled.`);
        return;
      }

      setPluginEnabled(found.package ?? found.path ?? '', false);
      if (options.json) {
        output.json({ success: true, name: getShortName(found.package ?? name) });
        return;
      }
      output.success(`Disabled plugin: ${getShortName(found.package ?? name)}`);
    });
}
