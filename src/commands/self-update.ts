// Path: znvault-cli/src/commands/self-update.ts
/**
 * Self-Update Command
 *
 * Handles CLI self-update functionality.
 */

import { type Command } from 'commander';
import ora from 'ora';
import chalk from 'chalk';
import * as output from '../lib/output.js';
import {
  checkForUpdate,
  performUpdate,
  getCurrentVersion,
  clearUpdateCache,
} from '../lib/cli-update.js';

interface SelfUpdateOptions {
  check?: boolean;
  force?: boolean;
  yes?: boolean;
}

export function registerSelfUpdateCommands(program: Command): void {
  program
    .command('self-update')
    .description('Update znvault CLI to the latest version')
    .option('-c, --check', 'Only check for updates, do not install')
    .option('-f, --force', 'Force update even if already on latest version')
    .option('-y, --yes', 'Skip confirmation prompt')
    .action(async (options: SelfUpdateOptions) => {
      const spinner = ora('Checking for updates...').start();

      try {
        const result = await checkForUpdate(true); // Force fresh check

        spinner.stop();

        console.log();
        console.log(chalk.bold('ZnVault CLI Update Check'));
        console.log();
        console.log(`  Current version: ${chalk.cyan(result.currentVersion)}`);
        console.log(`  Latest version:  ${result.latestVersion ? chalk.green(result.latestVersion) : chalk.gray('unknown')}`);
        console.log();

        if (!result.latestVersion) {
          output.warn('Could not check npm registry. Check your network connection.');
          return;
        }

        if (!result.updateAvailable && !options.force) {
          console.log(chalk.green('✓ You are running the latest version!'));
          return;
        }

        if (options.check) {
          if (result.updateAvailable) {
            console.log(chalk.yellow('✨ Update available!'));
            console.log();
            console.log(`  Run ${chalk.cyan('znvault self-update')} to update.`);
          }
          return;
        }

        // Confirm update
        if (!options.yes && !options.force) {
          console.log(chalk.yellow('An update is available.'));
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

        // Perform update
        const updateSpinner = ora('Installing update...').start();

        const updateResult = await performUpdate({ silent: false, global: true });

        if (updateResult.success) {
          updateSpinner.succeed('Update installed successfully!');
          console.log();
          console.log(chalk.green('✓ znvault CLI has been updated.'));
          console.log();
          console.log(chalk.dim('Run "znvault --version" to verify the new version.'));

          // Clear cache so next run doesn't show update notification
          clearUpdateCache();
        } else {
          updateSpinner.fail('Update failed');
          output.error(updateResult.error ?? 'Unknown error');
          console.log();
          console.log('Try running manually:');
          console.log(chalk.cyan('  npm install -g @zincapp/znvault-cli'));
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
        spinner.stop();

        if (result.updateAvailable && result.latestVersion) {
          console.log();
          console.log(chalk.yellow(`Update available: ${result.latestVersion}`));
          console.log(chalk.dim('Run "znvault self-update" to update.'));
        } else if (result.latestVersion) {
          console.log(chalk.green('(latest)'));
        }
      } catch {
        spinner.stop();
        // Silently ignore update check errors
      }
    });
}
