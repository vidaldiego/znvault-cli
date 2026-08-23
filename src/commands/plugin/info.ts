// Path: src/commands/plugin/info.ts

/**
 * Plugin info command
 */

import type { Command } from 'commander';
import { execFileSync } from 'node:child_process';

import chalk from 'chalk';
import * as output from '../../lib/output.js';
import { getPlugins } from '../../lib/config.js';
import type { PluginInfoOptions, NpmPackageInfo } from './types.js';
import {
  resolvePluginName,
  getShortName,
  isValidPackageName,
  getInstalledVersion,
  getPluginsDir,
  findPlugin,
} from './helpers.js';

export function registerInfoCommand(parent: Command): void {
  parent
    .command('info <name>')
    .description('Show plugin information')
    .option('--json', 'Output as JSON')
    .action(async (name: string, options: PluginInfoOptions) => {
      const spinner = output.spinner('Fetching plugin info...').start();

      try {
        const packageName = resolvePluginName(name);
        const plugins = getPlugins();
        const pluginsDir = getPluginsDir();

        // Check if installed locally
        const installed = findPlugin(plugins, name);

        // Get npm info
        let npmInfo: NpmPackageInfo | null = null;

        try {
          if (isValidPackageName(packageName)) {
            const infoStr = execFileSync('npm', ['view', packageName, '--json'], { stdio: 'pipe' }).toString();
            npmInfo = JSON.parse(infoStr) as NpmPackageInfo;
          }
        } catch {
          // Try without prefix
          if (packageName !== name && isValidPackageName(name)) {
            try {
              const infoStr = execFileSync('npm', ['view', name, '--json'], { stdio: 'pipe' }).toString();
              npmInfo = JSON.parse(infoStr) as NpmPackageInfo;
            } catch {
              // Not found
            }
          }
        }

        spinner.stop();

        if (!installed && !npmInfo) {
          if (options.json) {
            output.json({ success: false, error: `Plugin not found: ${name}` });
            process.exit(1);
          }
          output.error(`Plugin not found: ${name}`);
          process.exit(1);
        }

        if (options.json) {
          const localVersion = installed?.package ? getInstalledVersion(installed.package, pluginsDir) : null;
          output.json({
            name: getShortName(packageName),
            package: packageName,
            npm: npmInfo ? {
              version: npmInfo.version,
              description: npmInfo.description,
              homepage: npmInfo.homepage,
            } : null,
            local: installed ? {
              installed: true,
              version: localVersion ?? 'unknown',
              enabled: installed.enabled !== false,
              updateAvailable: npmInfo && localVersion && localVersion !== npmInfo.version,
            } : null,
          });
          return;
        }

        console.log();
        console.log(chalk.bold(getShortName(packageName)));
        console.log();

        if (npmInfo) {
          console.log(`  Package:     ${chalk.cyan(packageName)}`);
          console.log(`  Version:     ${npmInfo.version}`);
          if (npmInfo.description) {
            console.log(`  Description: ${npmInfo.description}`);
          }
          if (npmInfo.homepage) {
            console.log(`  Homepage:    ${chalk.blue(npmInfo.homepage)}`);
          }
        }

        if (installed) {
          const localVersion = getInstalledVersion(installed.package!, pluginsDir);
          console.log();
          console.log(chalk.dim('Local Installation:'));
          console.log(`  Installed:   ${chalk.green('Yes')}`);
          console.log(`  Version:     ${localVersion ?? 'unknown'}`);
          console.log(`  Enabled:     ${installed.enabled !== false ? chalk.green('Yes') : chalk.yellow('No')}`);

          if (npmInfo && localVersion && localVersion !== npmInfo.version) {
            console.log();
            console.log(chalk.yellow(`  Update available: ${localVersion} → ${npmInfo.version}`));
            console.log(chalk.dim(`  Run: znvault plugin update ${getShortName(packageName)}`));
          }
        } else {
          console.log();
          console.log(chalk.dim('Not installed locally.'));
          console.log(`Install with: ${chalk.cyan(`znvault plugin install ${getShortName(packageName)}`)}`);
        }
      } catch (err) {
        spinner.fail('Failed to fetch info');
        output.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    });
}
