// Path: znvault-cli/src/commands/self-update.ts
/**
 * Self-Update Command
 *
 * Handles CLI self-update functionality and plugin updates.
 */

import { type Command } from 'commander';
import { execSync, spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import ora from 'ora';
import chalk from 'chalk';
import * as output from '../lib/output.js';
import {
  checkForUpdate,
  performUpdate,
  getCurrentVersion,
  clearUpdateCache,
} from '../lib/cli-update.js';
import { getPlugins, getConfigPath } from '../lib/config.js';

interface SelfUpdateOptions {
  check?: boolean;
  force?: boolean;
  yes?: boolean;
  skipPlugins?: boolean;
}

interface PluginUpdateInfo {
  name: string;
  package: string;
  currentVersion: string;
  latestVersion: string;
}

/**
 * Get the plugins directory path
 */
function getPluginsDir(): string {
  const configPath = getConfigPath();
  return join(dirname(configPath), 'plugins');
}

/**
 * Get installed package version from plugins directory
 */
function getInstalledVersion(packageName: string, pluginsDir: string): string | null {
  try {
    const packageJsonPath = join(pluginsDir, 'node_modules', packageName, 'package.json');
    if (existsSync(packageJsonPath)) {
      const pkg = JSON.parse(readFileSync(packageJsonPath, 'utf-8')) as { version?: string };
      return pkg.version ?? null;
    }
  } catch {
    // Ignore
  }
  return null;
}

/**
 * Get latest package version from npm
 */
function getLatestVersion(packageName: string): string | null {
  try {
    return execSync(`npm view ${packageName} version`, { stdio: 'pipe' }).toString().trim();
  } catch {
    return null;
  }
}

/**
 * Get short name from full package name
 */
function getShortName(packageName: string): string {
  const prefix = '@zincapp/znvault-plugin-';
  if (packageName.startsWith(prefix)) {
    return packageName.slice(prefix.length);
  }
  return packageName;
}

/**
 * Check for plugin updates
 */
function checkPluginUpdates(): PluginUpdateInfo[] {
  const plugins = getPlugins();
  const pluginsDir = getPluginsDir();
  const updates: PluginUpdateInfo[] = [];

  for (const plugin of plugins) {
    if (!plugin.package || plugin.enabled === false) continue;

    const currentVersion = getInstalledVersion(plugin.package, pluginsDir);
    if (!currentVersion) continue;

    const latestVersion = getLatestVersion(plugin.package);
    if (!latestVersion) continue;

    if (currentVersion !== latestVersion) {
      updates.push({
        name: getShortName(plugin.package),
        package: plugin.package,
        currentVersion,
        latestVersion,
      });
    }
  }

  return updates;
}

/**
 * Run npm update in plugins directory
 */
function updatePlugins(packages: string[], pluginsDir: string): Promise<{ success: boolean; output: string }> {
  return new Promise((resolve) => {
    const npm = spawn('npm', ['update', ...packages], {
      cwd: pluginsDir,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    npm.stdout.on('data', (data: Buffer) => {
      stdout += data.toString();
    });

    npm.stderr.on('data', (data: Buffer) => {
      stderr += data.toString();
    });

    npm.on('close', (code) => {
      resolve({
        success: code === 0,
        output: stdout + stderr,
      });
    });

    npm.on('error', (err) => {
      resolve({
        success: false,
        output: err.message,
      });
    });
  });
}

export function registerSelfUpdateCommands(program: Command): void {
  program
    .command('self-update')
    .description('Update znvault CLI and plugins to the latest versions')
    .option('-c, --check', 'Only check for updates, do not install')
    .option('-f, --force', 'Force update even if already on latest version')
    .option('-y, --yes', 'Skip confirmation prompt')
    .option('--skip-plugins', 'Skip plugin updates')
    .action(async (options: SelfUpdateOptions) => {
      const spinner = ora('Checking for updates...').start();

      try {
        // Check CLI updates
        const cliResult = await checkForUpdate(true);

        // Check plugin updates
        spinner.text = 'Checking plugins...';
        const pluginUpdates = options.skipPlugins ? [] : checkPluginUpdates();

        spinner.stop();

        // Display CLI update info
        console.log();
        console.log(chalk.bold('ZnVault CLI Update Check'));
        console.log();
        console.log(`  Current version: ${chalk.cyan(cliResult.currentVersion)}`);
        console.log(`  Latest version:  ${cliResult.latestVersion ? chalk.green(cliResult.latestVersion) : chalk.gray('unknown')}`);

        // Display plugin update info
        if (!options.skipPlugins) {
          console.log();
          console.log(chalk.bold('Plugin Updates'));
          console.log();
          if (pluginUpdates.length === 0) {
            console.log(chalk.dim('  All plugins are up to date.'));
          } else {
            for (const plugin of pluginUpdates) {
              console.log(`  ${chalk.cyan(plugin.name)}: ${plugin.currentVersion} → ${chalk.green(plugin.latestVersion)}`);
            }
          }
        }

        console.log();

        if (!cliResult.latestVersion) {
          output.warn('Could not check npm registry. Check your network connection.');
          return;
        }

        const hasCliUpdate = cliResult.updateAvailable || options.force;
        const hasPluginUpdates = pluginUpdates.length > 0;

        if (!hasCliUpdate && !hasPluginUpdates) {
          console.log(chalk.green('✓ Everything is up to date!'));
          return;
        }

        if (options.check) {
          if (hasCliUpdate || hasPluginUpdates) {
            console.log(chalk.yellow('✨ Updates available!'));
            console.log();
            console.log(`  Run ${chalk.cyan('znvault self-update')} to update.`);
          }
          return;
        }

        // Build confirmation message
        const updateItems: string[] = [];
        if (hasCliUpdate) updateItems.push('CLI');
        if (hasPluginUpdates) updateItems.push(`${pluginUpdates.length} plugin(s)`);

        // Confirm update
        if (!options.yes && !options.force) {
          console.log(chalk.yellow(`Updates available: ${updateItems.join(' and ')}`));
          console.log();

          const { confirm } = await import('inquirer').then(m =>
            m.default.prompt<{ confirm: boolean }>([
              {
                type: 'confirm',
                name: 'confirm',
                message: 'Do you want to update now?',
                default: true,
              },
            ])
          );

          if (!confirm) {
            console.log('Update cancelled.');
            return;
          }
        }

        // Perform CLI update
        if (hasCliUpdate) {
          const updateSpinner = ora('Updating CLI...').start();

          const updateResult = await performUpdate({ silent: false, global: true });

          if (updateResult.success) {
            updateSpinner.succeed('CLI updated successfully!');
            clearUpdateCache();
          } else {
            updateSpinner.fail('CLI update failed');
            output.error(updateResult.error ?? 'Unknown error');
            console.log();
            console.log('Try running manually:');
            console.log(chalk.cyan('  npm install -g @zincapp/znvault-cli'));
          }
        }

        // Perform plugin updates
        if (hasPluginUpdates) {
          const pluginSpinner = ora('Updating plugins...').start();

          const pluginsDir = getPluginsDir();
          const packagesToUpdate = pluginUpdates.map(p => p.package);
          const pluginResult = await updatePlugins(packagesToUpdate, pluginsDir);

          if (pluginResult.success) {
            pluginSpinner.succeed('Plugins updated successfully!');
            console.log();
            for (const plugin of pluginUpdates) {
              console.log(`  ${chalk.green('✓')} ${chalk.cyan(plugin.name)}: ${plugin.currentVersion} → ${plugin.latestVersion}`);
            }
          } else {
            pluginSpinner.fail('Plugin update failed');
            output.error(pluginResult.output);
          }
        }

        console.log();
        if (hasCliUpdate) {
          console.log(chalk.dim('Run "znvault --version" to verify the new CLI version.'));
        }
        if (hasPluginUpdates) {
          console.log(chalk.dim('Run "znvault plugin list" to verify plugin versions.'));
        }
      } catch (err) {
        spinner.fail('Update check failed');
        output.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    });

  // Version command with update check
  program
    .command('version')
    .description('Show version and check for updates')
    .action(async () => {
      const currentVersion = getCurrentVersion();
      console.log(`znvault version ${currentVersion}`);

      const spinner = ora('Checking for updates...').start();

      try {
        const result = await checkForUpdate(true);
        const pluginUpdates = checkPluginUpdates();
        spinner.stop();

        if (result.updateAvailable && result.latestVersion) {
          console.log();
          console.log(chalk.yellow(`CLI update available: ${result.latestVersion}`));
        } else if (result.latestVersion) {
          console.log(chalk.green(' (latest)'));
        }

        if (pluginUpdates.length > 0) {
          console.log(chalk.yellow(`${pluginUpdates.length} plugin update(s) available`));
        }

        if (result.updateAvailable || pluginUpdates.length > 0) {
          console.log(chalk.dim('Run "znvault self-update" to update.'));
        }
      } catch {
        spinner.stop();
        // Silently ignore update check errors
      }
    });
}
