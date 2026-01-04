// Path: znvault-cli/src/commands/update.ts

/**
 * Update Command
 *
 * Provides commands for checking, installing, and configuring
 * automatic updates for the znvault agent.
 */

import { Command } from 'commander';
import ora from 'ora';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import * as output from '../lib/output.js';
import { createUpdateChecker } from '../services/update-checker.js';
import { createUpdateInstaller } from '../services/update-installer.js';
import { getPlatform, getPlatformName, getInstallPath, ensureConfigDir, isRoot } from '../utils/platform.js';
import type { UpdateConfig, UpdateChannel, UpdateProgress } from '../types/update.js';
import { DEFAULT_UPDATE_CONFIG } from '../types/update.js';

// ESM workaround for __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const UPDATE_CONFIG_FILE = 'update.json';

/**
 * Get current version from package.json
 */
function getCurrentVersion(): string {
  // Try to read from package.json in various locations
  const possiblePaths = [
    path.join(process.cwd(), 'package.json'),
    path.join(__dirname, '../../package.json'),
    path.join(__dirname, '../../../package.json'),
  ];

  for (const p of possiblePaths) {
    try {
      if (fs.existsSync(p)) {
        const pkg = JSON.parse(fs.readFileSync(p, 'utf-8'));
        if (pkg.version) {
          return pkg.version;
        }
      }
    } catch {
      // Continue to next path
    }
  }

  // Fallback: check VERSION file
  const versionFile = path.join(__dirname, '../../VERSION');
  if (fs.existsSync(versionFile)) {
    return fs.readFileSync(versionFile, 'utf-8').trim();
  }

  return 'unknown';
}

/**
 * Load update configuration
 */
function loadConfig(): UpdateConfig {
  const configPath = path.join(ensureConfigDir(), UPDATE_CONFIG_FILE);

  if (fs.existsSync(configPath)) {
    try {
      const data = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      return { ...DEFAULT_UPDATE_CONFIG, ...data };
    } catch {
      // Return default on error
    }
  }

  return { ...DEFAULT_UPDATE_CONFIG };
}

/**
 * Save update configuration
 */
function saveConfig(config: UpdateConfig): void {
  const configPath = path.join(ensureConfigDir(), UPDATE_CONFIG_FILE);
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
}

export function registerUpdateCommands(program: Command): void {
  const update = program
    .command('update')
    .description('Manage agent updates');

  // Check for updates
  update
    .command('check')
    .description('Check for available updates')
    .option('--channel <channel>', 'Update channel (stable, beta, staging)', 'stable')
    .option('--json', 'Output as JSON')
    .action(async (options) => {
      const spinner = ora('Checking for updates...').start();

      try {
        const checker = createUpdateChecker(options.channel as UpdateChannel);
        const currentVersion = getCurrentVersion();
        const result = await checker.checkForUpdates(currentVersion);

        spinner.stop();

        if (options.json) {
          output.json(result);
          return;
        }

        console.log();
        console.log(`Current version:  ${result.currentVersion}`);
        console.log(`Latest version:   ${result.latestVersion}`);
        console.log(`Channel:          ${options.channel}`);
        console.log(`Platform:         ${getPlatformName()}`);

        if (result.error) {
          console.log();
          output.error(result.error);
          return;
        }

        if (result.updateAvailable) {
          console.log();
          console.log('✨ Update available!');
          console.log();
          console.log('Run "znvault update install" to update.');

          if (result.manifest?.releaseNotes) {
            console.log();
            console.log('Release notes:');
            console.log(result.manifest.releaseNotes);
          }
        } else {
          console.log();
          console.log('✓ You are running the latest version.');
        }
      } catch (err) {
        spinner.fail('Check failed');
        output.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    });

  // Install update
  update
    .command('install')
    .description('Download and install the latest update')
    .option('--channel <channel>', 'Update channel', 'stable')
    .option('--force', 'Force reinstall even if up to date')
    .option('--path <path>', 'Installation path')
    .option('-y, --yes', 'Skip confirmation prompts')
    .action(async (options) => {
      const config = loadConfig();
      const channel = (options.channel || config.channel) as UpdateChannel;
      const installPath = options.path || config.installPath || getInstallPath();

      // Check platform
      const platform = getPlatform();
      if (platform === 'unsupported') {
        output.error(`Unsupported platform: ${process.platform}/${process.arch}`);
        output.error('Auto-update is only available on Linux (amd64, arm64).');
        process.exit(1);
      }

      // Check permissions
      const installer = createUpdateInstaller(installPath);
      const { canInstall, reason } = installer.canInstall();
      if (!canInstall) {
        output.error(reason || 'Cannot install to target path');
        if (!isRoot()) {
          console.log('Tip: Try running with sudo');
        }
        process.exit(1);
      }

      // Check for updates
      const spinner = ora('Checking for updates...').start();

      try {
        const checker = createUpdateChecker(channel);
        const currentVersion = getCurrentVersion();
        const result = await checker.checkForUpdates(currentVersion);

        if (result.error) {
          spinner.fail(result.error);
          process.exit(1);
        }

        if (!result.updateAvailable && !options.force) {
          spinner.succeed('Already running the latest version');
          return;
        }

        if (!result.artifact || !result.manifest) {
          spinner.fail('No artifact available for this platform');
          process.exit(1);
        }

        spinner.stop();

        // Confirm installation
        if (!options.yes) {
          console.log();
          console.log(`Current version: ${result.currentVersion}`);
          console.log(`New version:     ${result.latestVersion}`);
          console.log(`Install path:    ${installPath}`);
          console.log();

          const { confirm } = await import('inquirer').then(m =>
            m.default.prompt([
              {
                type: 'confirm',
                name: 'confirm',
                message: 'Proceed with installation?',
                default: true,
              },
            ])
          );

          if (!confirm) {
            console.log('Installation cancelled.');
            return;
          }
        }

        // Install with progress
        let currentSpinner: ReturnType<typeof ora> | null = null;

        const progressHandler = (progress: UpdateProgress) => {
          if (currentSpinner) {
            if (progress.stage === 'complete') {
              currentSpinner.succeed(progress.message);
              currentSpinner = null;
            } else if (progress.stage === 'error') {
              currentSpinner.fail(progress.message);
              currentSpinner = null;
            } else {
              currentSpinner.text = progress.message;
            }
          } else if (progress.stage !== 'complete' && progress.stage !== 'error') {
            currentSpinner = ora(progress.message).start();
          }
        };

        const installerWithProgress = createUpdateInstaller(installPath, progressHandler);
        await installerWithProgress.install(result.artifact, result.latestVersion);

        console.log();
        console.log('✓ Update installed successfully!');
        console.log();
        console.log('Note: You may need to restart any running agents for the update to take effect.');
      } catch (err) {
        if (spinner.isSpinning) {
          spinner.fail('Installation failed');
        }
        output.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    });

  // Configure auto-update
  update
    .command('config')
    .description('Configure auto-update settings')
    .option('--enable', 'Enable auto-updates')
    .option('--disable', 'Disable auto-updates')
    .option('--channel <channel>', 'Update channel (stable, beta, staging)')
    .option('--window <start-end>', 'Maintenance window (e.g., "02:00-04:00")')
    .option('--timezone <tz>', 'Timezone for maintenance window', 'UTC')
    .option('--interval <minutes>', 'Check interval in minutes')
    .option('--path <path>', 'Installation path')
    .option('--vault-url <url>', 'Vault URL for WebSocket notifications')
    .option('--show', 'Show current configuration')
    .option('--json', 'Output as JSON')
    .action(async (options) => {
      const config = loadConfig();

      // Show current config
      if (options.show || Object.keys(options).length === 0) {
        if (options.json) {
          output.json(config);
          return;
        }

        console.log('Auto-Update Configuration:');
        console.log();
        console.log(`  Auto-update:    ${config.autoUpdate ? 'enabled' : 'disabled'}`);
        console.log(`  Channel:        ${config.channel}`);
        console.log(`  Check interval: ${config.checkInterval / 60000} minutes`);
        console.log(`  Install path:   ${config.installPath}`);
        if (config.maintenanceWindow) {
          console.log(`  Window:         ${config.maintenanceWindow.start}-${config.maintenanceWindow.end} ${config.maintenanceWindow.timezone}`);
        } else {
          console.log(`  Window:         none (updates anytime)`);
        }
        if (config.vaultUrl) {
          console.log(`  Vault URL:      ${config.vaultUrl}`);
        }
        return;
      }

      // Update config
      if (options.enable) {
        config.autoUpdate = true;
      }
      if (options.disable) {
        config.autoUpdate = false;
      }
      if (options.channel) {
        config.channel = options.channel as UpdateChannel;
      }
      if (options.window) {
        const [start, end] = options.window.split('-');
        if (start && end) {
          config.maintenanceWindow = {
            start,
            end,
            timezone: options.timezone || 'UTC',
          };
        }
      }
      if (options.interval) {
        config.checkInterval = parseInt(options.interval, 10) * 60000;
      }
      if (options.path) {
        config.installPath = options.path;
      }
      if (options.vaultUrl) {
        config.vaultUrl = options.vaultUrl;
      }

      saveConfig(config);
      console.log('Configuration saved.');

      if (options.json) {
        output.json(config);
      }
    });

  // Show status
  update
    .command('status')
    .description('Show update status and configuration')
    .option('--json', 'Output as JSON')
    .action(async (options) => {
      const config = loadConfig();
      const currentVersion = getCurrentVersion();
      const platform = getPlatform();

      const status = {
        currentVersion,
        platform: getPlatformName(),
        platformSupported: platform !== 'unsupported',
        installPath: config.installPath || getInstallPath(),
        config,
      };

      if (options.json) {
        output.json(status);
        return;
      }

      console.log('Update Status:');
      console.log();
      console.log(`  Version:        ${status.currentVersion}`);
      console.log(`  Platform:       ${status.platform}`);
      console.log(`  Supported:      ${status.platformSupported ? 'yes' : 'no'}`);
      console.log(`  Install path:   ${status.installPath}`);
      console.log();
      console.log('Configuration:');
      console.log(`  Auto-update:    ${config.autoUpdate ? 'enabled' : 'disabled'}`);
      console.log(`  Channel:        ${config.channel}`);
      console.log(`  Check interval: ${config.checkInterval / 60000} minutes`);
      if (config.maintenanceWindow) {
        console.log(`  Window:         ${config.maintenanceWindow.start}-${config.maintenanceWindow.end} ${config.maintenanceWindow.timezone}`);
      }
    });

  // Daemon mode (for systemd)
  update
    .command('daemon')
    .description('Start auto-update daemon (for systemd service)')
    .option('-c, --config <path>', 'Config file path')
    .action(async (options) => {
      const config = options.config
        ? JSON.parse(fs.readFileSync(options.config, 'utf-8'))
        : loadConfig();

      if (!config.autoUpdate) {
        console.log('Auto-update is disabled. Enable with "znvault update config --enable"');
        process.exit(0);
      }

      console.log('Starting auto-update daemon...');
      console.log(`  Channel:        ${config.channel}`);
      console.log(`  Check interval: ${config.checkInterval / 60000} minutes`);
      if (config.maintenanceWindow) {
        console.log(`  Window:         ${config.maintenanceWindow.start}-${config.maintenanceWindow.end} ${config.maintenanceWindow.timezone}`);
      }
      console.log();

      // Import and start daemon
      const { AutoUpdateDaemon } = await import('../services/auto-update-daemon.js');
      const daemon = new AutoUpdateDaemon(config);
      await daemon.start();
    });
}
