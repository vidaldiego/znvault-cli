// Path: znvault-cli/src/commands/tui.ts
import { type Command } from 'commander';
import { render } from 'ink';
import React from 'react';
import { App } from '../tui/App.js';
import * as output from '../lib/output.js';

type ScreenType = 'dashboard' | 'secrets' | 'audit' | 'cluster';

interface TuiOptions {
  screen?: ScreenType;
  refresh?: string;
}

interface DashboardOptions {
  refresh?: string;
}

export function registerTuiCommands(program: Command): void {
  // Main TUI command
  program
    .command('tui')
    .description('Launch interactive terminal dashboard')
    .option('-s, --screen <screen>', 'Initial screen (dashboard, secrets, audit, cluster)', 'dashboard')
    .option('-r, --refresh <ms>', 'Refresh interval in milliseconds', '5000')
    .action(async (options: TuiOptions) => {
      // Check if running in a TTY
      if (!process.stdout.isTTY) {
        output.error('TUI mode requires an interactive terminal');
        output.info('Use regular commands for non-interactive environments');
        process.exit(1);
      }

      const refreshInterval = parseInt(options.refresh ?? '5000', 10);

      if (isNaN(refreshInterval) || refreshInterval < 1000) {
        output.error('Refresh interval must be at least 1000ms');
        process.exit(1);
      }

      try {
        const { waitUntilExit } = render(
          React.createElement(App, {
            initialScreen: options.screen ?? 'dashboard',
            refreshInterval,
          })
        );

        await waitUntilExit();
      } catch (err) {
        output.error(`TUI error: ${err instanceof Error ? err.message : String(err)}`);
        process.exit(1);
      }
    });

  // Convenience alias for dashboard
  program
    .command('dashboard')
    .description('Launch interactive dashboard (alias for tui --screen dashboard)')
    .option('-r, --refresh <ms>', 'Refresh interval in milliseconds', '5000')
    .action(async (options: DashboardOptions) => {
      // Check if running in a TTY
      if (!process.stdout.isTTY) {
        output.error('Dashboard mode requires an interactive terminal');
        output.info('Use "znvault status" for non-interactive status');
        process.exit(1);
      }

      const refreshInterval = parseInt(options.refresh ?? '5000', 10);

      if (isNaN(refreshInterval) || refreshInterval < 1000) {
        output.error('Refresh interval must be at least 1000ms');
        process.exit(1);
      }

      try {
        const { waitUntilExit } = render(
          React.createElement(App, {
            initialScreen: 'dashboard',
            refreshInterval,
          })
        );

        await waitUntilExit();
      } catch (err) {
        output.error(`Dashboard error: ${err instanceof Error ? err.message : String(err)}`);
        process.exit(1);
      }
    });
}
