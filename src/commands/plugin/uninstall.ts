// Path: src/commands/plugin/uninstall.ts

/**
 * Plugin uninstall command
 */

import type { Command } from 'commander';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

import chalk from 'chalk';
import * as output from '../../lib/output.js';
import { getPlugins, removePlugin } from '../../lib/config.js';
import type { PluginUninstallOptions } from './types.js';
import { getShortName, getPluginsDir, runNpm, findPlugin } from './helpers.js';

export function registerUninstallCommand(parent: Command): void {
  parent
    .command('uninstall <name>')
    .alias('remove')
    .description('Uninstall a CLI plugin')
    .option('--json', 'Output as JSON')
    .action(async (name: string, options: PluginUninstallOptions) => {
      const spinner = output.spinner('Uninstalling plugin...').start();

      try {
        // Check if configured
        const plugins = getPlugins();
        const found = findPlugin(plugins, name);

        if (!found) {
          spinner.fail(`Plugin not found: ${name}`);
          output.error('Plugin is not installed. Use "znvault plugin list" to see installed plugins.');
          process.exit(1);
        }

        const actualPackage = found.package;
        if (actualPackage === undefined) {
          spinner.fail(`Plugin '${name}' is a local-path plugin`);
          output.error('Path-based plugins are not npm-installed; remove the entry from the CLI config instead.');
          process.exit(1);
        }

        // Remove from plugins directory
        const pluginsDir = getPluginsDir();
        if (existsSync(join(pluginsDir, 'node_modules', actualPackage))) {
          spinner.text = `Removing ${actualPackage}...`;
          const uninstallResult = await runNpm(['uninstall', actualPackage], pluginsDir);

          if (!uninstallResult.success) {
            spinner.warn('Failed to uninstall npm package, but removing from config...');
          }
        }

        // Remove from config
        removePlugin(actualPackage);

        spinner.succeed(`Uninstalled ${chalk.cyan(getShortName(actualPackage))}`);

        if (options.json) {
          output.json({ success: true, name: getShortName(actualPackage), package: actualPackage });
        }
      } catch (err) {
        spinner.fail('Uninstall failed');
        output.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    });
}
