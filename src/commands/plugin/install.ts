// Path: src/commands/plugin/install.ts

/**
 * Plugin install command
 */

import type { Command } from 'commander';

import chalk from 'chalk';
import * as output from '../../lib/output.js';
import { getPlugins, addPlugin } from '../../lib/config.js';
import type { PluginInstallOptions } from './types.js';
import { ZINCAPP_PREFIX } from './types.js';
import {
  resolvePluginName,
  getShortName,
  packageExists,
  getInstalledVersion,
  ensurePluginsDir,
  runNpm,
  validatePlugin,
} from './helpers.js';

export function registerInstallCommand(parent: Command): void {
  parent
    .command('install <name>')
    .alias('add')
    .description('Install a CLI plugin')
    .option('-f, --force', 'Force reinstall even if already installed')
    .option('-g, --global', 'Install globally instead of in plugins directory')
    .option('--json', 'Output as JSON')
    .action(async (name: string, options: PluginInstallOptions) => {
      const spinner = output.spinner('Resolving plugin...').start();

      try {
        // Resolve plugin name
        let packageName = resolvePluginName(name);
        let foundWithPrefix = true;

        // Check if @zincapp prefixed version exists
        if (packageName.startsWith(ZINCAPP_PREFIX)) {
          const exists = await packageExists(packageName);
          if (!exists) {
            // Try the original name directly
            const directExists = await packageExists(name);
            if (directExists) {
              packageName = name;
              foundWithPrefix = false;
            } else {
              spinner.fail(`Plugin not found: ${packageName}`);
              output.error(`Could not find '${packageName}' or '${name}' on npm.`);
              console.log();
              console.log('Available ZincApp plugins:');
              console.log(`  ${chalk.cyan('payara')} - Payara WAR deployment`);
              process.exit(1);
            }
          }
        }

        spinner.text = `Installing ${packageName}...`;

        // Check if already configured
        const existingPlugins = getPlugins();
        const alreadyConfigured = existingPlugins.some(p => p.package === packageName);

        if (alreadyConfigured && !options.force) {
          spinner.info(`Plugin ${chalk.cyan(getShortName(packageName))} is already installed.`);
          if (options.json) {
            output.json({ success: false, name: getShortName(packageName), package: packageName, alreadyInstalled: true });
            return;
          }
          console.log(`Use ${chalk.cyan('--force')} to reinstall.`);
          return;
        }

        // Ensure plugins directory
        const pluginsDir = ensurePluginsDir();

        // Install package
        spinner.text = `Installing ${packageName}...`;
        const installResult = await runNpm(['install', packageName], pluginsDir);

        if (!installResult.success) {
          spinner.fail(`Failed to install ${packageName}`);
          output.error(installResult.output);
          process.exit(1);
        }

        // Validate it's a valid plugin
        spinner.text = 'Validating plugin...';
        const validation = await validatePlugin(packageName, pluginsDir);

        if (!validation.valid) {
          spinner.fail(`Invalid plugin: ${validation.error}`);

          // Uninstall the invalid package
          await runNpm(['uninstall', packageName], pluginsDir);

          output.error('The package was installed but is not a valid znvault CLI plugin.');
          process.exit(1);
        }

        // Add to config
        addPlugin({ package: packageName, enabled: true });

        const version = getInstalledVersion(packageName, pluginsDir);
        spinner.succeed(`Installed ${chalk.cyan(getShortName(packageName))}${version ? ` v${version}` : ''}`);

        if (options.json) {
          output.json({ success: true, name: getShortName(packageName), package: packageName, version: version ?? 'unknown' });
          return;
        }

        console.log();
        console.log(chalk.dim('Plugin will be loaded on next command execution.'));

        if (foundWithPrefix && name !== packageName) {
          console.log(chalk.dim(`Resolved '${name}' to '${packageName}'`));
        }
      } catch (err) {
        spinner.fail('Installation failed');
        output.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    });
}
