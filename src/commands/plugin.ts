// Path: znvault-cli/src/commands/plugin.ts
/**
 * Plugin Management Commands
 *
 * Commands for installing, uninstalling, and managing CLI plugins.
 */

import { type Command } from 'commander';
import { execSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import ora from 'ora';
import chalk from 'chalk';
import * as output from '../lib/output.js';
import {
  getPlugins,
  addPlugin,
  removePlugin,
  setPluginEnabled,
  getConfigPath,
} from '../lib/config.js';

// ZincApp plugin namespace
const ZINCAPP_PREFIX = '@zincapp/znvault-plugin-';

interface PluginInstallOptions {
  force?: boolean;
  global?: boolean;
}

interface PluginListOptions {
  json?: boolean;
}

/**
 * Get the plugins directory path (alongside config.json)
 */
function getPluginsDir(): string {
  const configPath = getConfigPath();
  return join(dirname(configPath), 'plugins');
}

/**
 * Ensure plugins directory exists with package.json
 */
function ensurePluginsDir(): string {
  const pluginsDir = getPluginsDir();

  if (!existsSync(pluginsDir)) {
    mkdirSync(pluginsDir, { recursive: true });
  }

  const packageJsonPath = join(pluginsDir, 'package.json');
  if (!existsSync(packageJsonPath)) {
    writeFileSync(packageJsonPath, JSON.stringify({
      name: 'znvault-plugins',
      version: '1.0.0',
      private: true,
      description: 'ZNVault CLI plugins',
      type: 'module',
    }, null, 2));
  }

  return pluginsDir;
}

/**
 * Resolve plugin name to full package name
 * - "payara" -> "@zincapp/znvault-plugin-payara"
 * - "@zincapp/znvault-plugin-payara" -> "@zincapp/znvault-plugin-payara"
 * - "@other/plugin" -> "@other/plugin"
 */
function resolvePluginName(name: string): string {
  // Already a scoped or full package name
  if (name.startsWith('@') || name.includes('/')) {
    return name;
  }

  // Check if it's a simple name, prepend ZincApp prefix
  return `${ZINCAPP_PREFIX}${name}`;
}

/**
 * Get short name from full package name
 */
function getShortName(packageName: string): string {
  if (packageName.startsWith(ZINCAPP_PREFIX)) {
    return packageName.slice(ZINCAPP_PREFIX.length);
  }
  return packageName;
}

/**
 * Check if a package exists on npm
 */
async function packageExists(packageName: string): Promise<boolean> {
  try {
    execSync(`npm view ${packageName} version`, { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

/**
 * Get package version from npm
 */
function getPackageVersion(packageName: string): string | null {
  try {
    return execSync(`npm view ${packageName} version`, { stdio: 'pipe' }).toString().trim();
  } catch {
    return null;
  }
}

/**
 * Get installed package version
 */
function getInstalledVersion(packageName: string, pluginsDir: string): string | null {
  try {
    const packageJsonPath = join(pluginsDir, 'node_modules', packageName, 'package.json');
    if (existsSync(packageJsonPath)) {
      const pkg = JSON.parse(readFileSync(packageJsonPath, 'utf-8'));
      return pkg.version;
    }
  } catch {
    // Ignore
  }
  return null;
}

/**
 * Run npm command in plugins directory
 */
function runNpm(args: string[], pluginsDir: string): Promise<{ success: boolean; output: string }> {
  return new Promise((resolve) => {
    const npm = spawn('npm', args, {
      cwd: pluginsDir,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    npm.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    npm.stderr.on('data', (data) => {
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

/**
 * Validate that a package is a valid znvault CLI plugin
 */
async function validatePlugin(packageName: string, pluginsDir: string): Promise<{ valid: boolean; error?: string }> {
  try {
    const packageJsonPath = join(pluginsDir, 'node_modules', packageName, 'package.json');
    if (!existsSync(packageJsonPath)) {
      return { valid: false, error: 'Package not found after installation' };
    }

    const pkg = JSON.parse(readFileSync(packageJsonPath, 'utf-8'));

    // Check for CLI plugin export
    const hasCliExport = pkg.exports?.['./cli'] || pkg.main;
    if (!hasCliExport) {
      return { valid: false, error: 'Package does not export a CLI plugin' };
    }

    // Try to dynamically import and validate
    try {
      const modulePath = join(pluginsDir, 'node_modules', packageName);
      const cliPath = pkg.exports?.['./cli']?.import || pkg.exports?.['./cli'] || './dist/cli.js';
      const fullPath = join(modulePath, cliPath);

      // Check if the CLI module exists
      if (!existsSync(fullPath.replace(/\.js$/, '.js')) && !existsSync(fullPath)) {
        // Try without ./cli export - main export might have createPayaraCLIPlugin
        const mainPath = join(modulePath, pkg.exports?.['.']?.import || pkg.main || 'dist/index.js');
        if (!existsSync(mainPath)) {
          return { valid: false, error: 'CLI module not found' };
        }
      }

      return { valid: true };
    } catch (err) {
      return { valid: false, error: `Failed to validate plugin: ${err}` };
    }
  } catch (err) {
    return { valid: false, error: `Validation error: ${err}` };
  }
}

export function registerPluginCommands(program: Command): void {
  const plugin = program
    .command('plugin')
    .description('Manage CLI plugins');

  // ============================================================================
  // plugin install <name>
  // ============================================================================
  plugin
    .command('install <name>')
    .alias('add')
    .description('Install a CLI plugin')
    .option('-f, --force', 'Force reinstall even if already installed')
    .option('-g, --global', 'Install globally instead of in plugins directory')
    .action(async (name: string, options: PluginInstallOptions) => {
      const spinner = ora('Resolving plugin...').start();

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

  // ============================================================================
  // plugin uninstall <name>
  // ============================================================================
  plugin
    .command('uninstall <name>')
    .alias('remove')
    .description('Uninstall a CLI plugin')
    .action(async (name: string) => {
      const spinner = ora('Uninstalling plugin...').start();

      try {
        // Resolve plugin name
        const packageName = resolvePluginName(name);

        // Check if configured
        const plugins = getPlugins();
        const found = plugins.find(p =>
          p.package === packageName ||
          p.package === name ||
          getShortName(p.package ?? '') === name
        );

        if (!found) {
          spinner.fail(`Plugin not found: ${name}`);
          output.error('Plugin is not installed. Use "znvault plugin list" to see installed plugins.');
          process.exit(1);
        }

        const actualPackage = found.package!;

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
      } catch (err) {
        spinner.fail('Uninstall failed');
        output.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    });

  // ============================================================================
  // plugin list
  // ============================================================================
  plugin
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

  // ============================================================================
  // plugin update [name]
  // ============================================================================
  plugin
    .command('update [name]')
    .alias('upgrade')
    .description('Update plugins (all or specific)')
    .action(async (name?: string) => {
      const plugins = getPlugins();

      if (plugins.length === 0) {
        console.log(chalk.dim('No plugins installed.'));
        return;
      }

      const pluginsDir = getPluginsDir();
      const spinner = ora('Checking for updates...').start();

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

        const updates: Array<{ name: string; from: string; to: string }> = [];

        for (const p of toUpdate) {
          const packageName = p.package!;
          const currentVersion = getInstalledVersion(packageName, pluginsDir);
          const latestVersion = getPackageVersion(packageName);

          if (currentVersion && latestVersion && currentVersion !== latestVersion) {
            updates.push({
              name: getShortName(packageName),
              from: currentVersion,
              to: latestVersion,
            });
          }
        }

        if (updates.length === 0) {
          spinner.succeed('All plugins are up to date.');
          return;
        }

        spinner.text = `Updating ${updates.length} plugin(s)...`;

        // Update all at once
        const packagesToUpdate = toUpdate.map(p => p.package!);
        const updateResult = await runNpm(['update', ...packagesToUpdate], pluginsDir);

        if (!updateResult.success) {
          spinner.fail('Update failed');
          output.error(updateResult.output);
          process.exit(1);
        }

        spinner.succeed('Plugins updated');
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

  // ============================================================================
  // plugin enable <name>
  // ============================================================================
  plugin
    .command('enable <name>')
    .description('Enable a disabled plugin')
    .action((name: string) => {
      const plugins = getPlugins();
      const packageName = resolvePluginName(name);

      const found = plugins.find(p =>
        p.package === packageName ||
        p.package === name ||
        getShortName(p.package ?? '') === name
      );

      if (!found) {
        output.error(`Plugin not found: ${name}`);
        console.log('Use "znvault plugin list" to see installed plugins.');
        process.exit(1);
      }

      if (found.enabled !== false) {
        console.log(`Plugin ${chalk.cyan(getShortName(found.package ?? name))} is already enabled.`);
        return;
      }

      setPluginEnabled(found.package ?? found.path ?? '', true);
      output.success(`Enabled plugin: ${getShortName(found.package ?? name)}`);
    });

  // ============================================================================
  // plugin disable <name>
  // ============================================================================
  plugin
    .command('disable <name>')
    .description('Disable a plugin without uninstalling')
    .action((name: string) => {
      const plugins = getPlugins();
      const packageName = resolvePluginName(name);

      const found = plugins.find(p =>
        p.package === packageName ||
        p.package === name ||
        getShortName(p.package ?? '') === name
      );

      if (!found) {
        output.error(`Plugin not found: ${name}`);
        console.log('Use "znvault plugin list" to see installed plugins.');
        process.exit(1);
      }

      if (found.enabled === false) {
        console.log(`Plugin ${chalk.cyan(getShortName(found.package ?? name))} is already disabled.`);
        return;
      }

      setPluginEnabled(found.package ?? found.path ?? '', false);
      output.success(`Disabled plugin: ${getShortName(found.package ?? name)}`);
    });

  // ============================================================================
  // plugin info <name>
  // ============================================================================
  plugin
    .command('info <name>')
    .description('Show plugin information')
    .action(async (name: string) => {
      const spinner = ora('Fetching plugin info...').start();

      try {
        const packageName = resolvePluginName(name);
        const plugins = getPlugins();
        const pluginsDir = getPluginsDir();

        // Check if installed locally
        const installed = plugins.find(p =>
          p.package === packageName ||
          p.package === name ||
          getShortName(p.package ?? '') === name
        );

        // Get npm info
        let npmInfo: {
          version: string;
          description?: string;
          homepage?: string;
          author?: string;
        } | null = null;

        try {
          const infoStr = execSync(`npm view ${packageName} --json`, { stdio: 'pipe' }).toString();
          npmInfo = JSON.parse(infoStr);
        } catch {
          // Try without prefix
          if (packageName !== name) {
            try {
              const infoStr = execSync(`npm view ${name} --json`, { stdio: 'pipe' }).toString();
              npmInfo = JSON.parse(infoStr);
            } catch {
              // Not found
            }
          }
        }

        spinner.stop();

        if (!installed && !npmInfo) {
          output.error(`Plugin not found: ${name}`);
          process.exit(1);
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
          console.log(`  Version:     ${localVersion || 'unknown'}`);
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
