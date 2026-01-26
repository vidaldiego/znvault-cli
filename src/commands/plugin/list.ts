// Path: src/commands/plugin/list.ts

/**
 * Plugin list command
 */

import type { Command } from 'commander';
import chalk from 'chalk';
import { getPlugins } from '../../lib/config.js';
import type { PluginListOptions } from './types.js';
import { getShortName, getPluginsDir, getInstalledVersion } from './helpers.js';

export function registerListCommand(parent: Command): void {
  parent
    .command('list')
    .alias('ls')
    .description('List installed plugins')
    .option('--json', 'Output as JSON')
    .action((options: PluginListOptions) => {
      const plugins = getPlugins();
      const pluginsDir = getPluginsDir();

      if (plugins.length === 0) {
        if (options.json) {
          console.log(JSON.stringify([], null, 2));
        } else {
          console.log(chalk.dim('No plugins installed.'));
          console.log();
          console.log(`Install a plugin with: ${chalk.cyan('znvault plugin install <name>')}`);
          console.log();
          console.log('Available plugins:');
          console.log(`  ${chalk.cyan('payara')} - Payara WAR deployment`);
        }
        return;
      }

      const pluginList = plugins.map(p => {
        const packageName = p.package || p.path || 'unknown';
        const shortName = getShortName(packageName);
        const version = p.package ? getInstalledVersion(p.package, pluginsDir) : null;
        const enabled = p.enabled !== false;

        return {
          name: shortName,
          package: packageName,
          version: version || 'unknown',
          enabled,
          source: p.path ? 'local' : 'npm',
        };
      });

      if (options.json) {
        console.log(JSON.stringify(pluginList, null, 2));
        return;
      }

      console.log(chalk.bold('Installed Plugins'));
      console.log();

      for (const p of pluginList) {
        const status = p.enabled ? chalk.green('●') : chalk.gray('○');
        const versionStr = chalk.dim(`v${p.version}`);
        const disabledStr = p.enabled ? '' : chalk.yellow(' (disabled)');

        console.log(`  ${status} ${chalk.cyan(p.name)} ${versionStr}${disabledStr}`);
        if (p.package !== p.name) {
          console.log(`    ${chalk.dim(p.package)}`);
        }
      }

      console.log();
      console.log(chalk.dim(`Plugins directory: ${pluginsDir}`));
    });
}
