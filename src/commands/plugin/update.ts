// Path: src/commands/plugin/update.ts

/**
 * Plugin update command
 */

import type { Command } from 'commander';

import chalk from 'chalk';
import * as output from '../../lib/output.js';
import { getPlugins } from '../../lib/config.js';
import type { PluginUpdateOptions, PluginUpdate } from './types.js';
import {
  resolvePluginName,
  getShortName,
  getPackageVersion,
  getInstalledVersion,
  getPluginsDir,
  isVersionNewer,
  runNpm,
} from './helpers.js';

export function registerUpdateCommand(parent: Command): void {
  parent
    .command('update [name]')
    .alias('upgrade')
    .description('Update plugins (all or specific)')
    .option('--json', 'Output as JSON')
    .action(async (name: string | undefined, options: PluginUpdateOptions) => {
      const plugins = getPlugins();

      if (plugins.length === 0) {
        console.log(chalk.dim('No plugins installed.'));
        return;
      }

      const pluginsDir = getPluginsDir();
      const spinner = output.spinner('Checking for updates...').start();

      try {
        // Filter to specific plugin if name provided
        let toUpdate = plugins.filter(p => p.package);
        if (name) {
          const packageName = resolvePluginName(name);
          toUpdate = toUpdate.filter(p =>
            p.package === packageName ||
            p.package === name ||
            getShortName(p.package ?? '') === name
          );

          if (toUpdate.length === 0) {
            spinner.fail(`Plugin not found: ${name}`);
            process.exit(1);
          }
        }

        const updates: PluginUpdate[] = [];

        for (const p of toUpdate) {
          const packageName = p.package;
          if (!packageName) continue;

          const currentVersion = getInstalledVersion(packageName, pluginsDir);
          const latestVersion = getPackageVersion(packageName);

          if (currentVersion && latestVersion && isVersionNewer(latestVersion, currentVersion)) {
            updates.push({
              name: getShortName(packageName),
              packageName,
              from: currentVersion,
              to: latestVersion,
            });
          }
        }

        if (updates.length === 0) {
          spinner.succeed('All plugins are up to date.');
          if (options.json) {
            output.json({ success: true, updates: [] });
          }
          return;
        }

        spinner.text = `Updating ${updates.length} plugin(s)...`;

        // Install latest versions explicitly (npm update respects semver ranges,
        // which wouldn't update e.g. ^1.0.0 to 2.0.0)
        const packagesToUpdate = updates.map(u => `${u.packageName}@latest`);
        const updateResult = await runNpm(['install', ...packagesToUpdate], pluginsDir);

        if (!updateResult.success) {
          spinner.fail('Update failed');
          output.error(updateResult.output);
          process.exit(1);
        }

        spinner.succeed('Plugins updated');

        if (options.json) {
          output.json({ success: true, updates });
          return;
        }

        console.log();

        for (const u of updates) {
          console.log(`  ${chalk.cyan(u.name)}: ${u.from} → ${chalk.green(u.to)}`);
        }
      } catch (err) {
        spinner.fail('Update failed');
        output.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    });
}
