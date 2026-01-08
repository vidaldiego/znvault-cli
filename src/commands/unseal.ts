// Path: znvault-cli/src/commands/unseal.ts

import { type Command } from 'commander';
import ora from 'ora';
import { client } from '../lib/client.js';
import { promptInput, promptConfirm } from '../lib/prompts.js';
import * as output from '../lib/output.js';
import * as visual from '../lib/visual.js';

interface UnsealStatusResponse {
  unsealed: boolean;
  unsealedUntil: string | null;
  method: 'otp' | 'device' | null;
  deviceId?: string;
  scope: string;
  remainingSeconds: number;
}

interface UnsealOptions {
  otp?: boolean;
  device?: boolean;
  json?: boolean;
}

interface UnsealStatusOptions {
  json?: boolean;
}

interface SealOptions {
  json?: boolean;
}

export function registerUnsealCommands(program: Command): void {
  const unsealCmd = program
    .command('unseal')
    .description('Unseal the vault for crypto operations');

  // Main unseal command (auto-select method)
  unsealCmd
    .option('--otp', 'Force OTP unseal')
    .option('--device', 'Force device unseal')
    .option('--json', 'Output as JSON')
    .action(async (options: UnsealOptions) => {
      try {
        if (options.device) {
          await unsealWithDevice(options);
        } else {
          // Default to OTP (device unseal requires browser/WebAuthn)
          await unsealWithOTP(options);
        }
      } catch (err) {
        output.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    });

  // Unseal status subcommand
  unsealCmd
    .command('status')
    .description('Check current unseal status')
    .option('--json', 'Output as JSON')
    .action(async (options: UnsealStatusOptions) => {
      const spinner = ora('Checking unseal status...').start();

      try {
        const status = await client.get<UnsealStatusResponse>('/v1/auth/unseal/status');
        spinner.stop();

        if (options.json) {
          output.json(status);
          return;
        }

        const statusData: Record<string, { value: string; status?: 'success' | 'warning' | 'error' | 'info' }> = {
          'Unsealed': {
            value: status.unsealed ? 'Yes' : 'No',
            status: status.unsealed ? 'success' : 'warning'
          },
        };

        if (status.unsealed) {
          statusData['Method'] = { value: status.method ?? 'unknown' };
          statusData['Scope'] = { value: status.scope };
          statusData['Expires'] = { value: status.unsealedUntil ?? 'unknown' };
          statusData['Remaining'] = {
            value: formatDuration(status.remainingSeconds),
            status: status.remainingSeconds < 60 ? 'warning' : 'info'
          };
        }

        console.log();
        console.log(visual.statusBox('UNSEAL STATUS', statusData));
        console.log();
      } catch (err) {
        spinner.fail('Failed to check unseal status');
        output.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    });

  // Seal command (revoke unseal)
  program
    .command('seal')
    .description('Seal the vault (revoke current unseal session)')
    .option('--json', 'Output as JSON')
    .action(async (options: SealOptions) => {
      const spinner = ora('Sealing vault...').start();

      try {
        await client.post<{ sealed: boolean }>('/v1/auth/unseal/seal', {});
        spinner.succeed('Vault sealed');

        if (options.json) {
          output.json({ sealed: true });
        } else {
          output.success('Crypto access has been revoked. Re-unseal when needed.');
        }
      } catch (err) {
        spinner.fail('Failed to seal vault');
        output.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    });
}

async function unsealWithOTP(options: UnsealOptions): Promise<void> {
  // Prompt for TOTP code
  const code = await promptInput('Enter your TOTP code');

  if (!code || !/^\d{6}$/.test(code)) {
    output.error('TOTP code must be 6 digits');
    process.exit(1);
  }

  const spinner = ora('Unsealing with OTP...').start();

  try {
    const result = await client.post<UnsealStatusResponse>('/v1/auth/unseal', {
      totpCode: code,
    });

    spinner.succeed('Vault unsealed');

    if (options.json) {
      output.json(result);
      return;
    }

    console.log();
    output.success(`Crypto access granted for ${formatDuration(result.remainingSeconds)}`);
    console.log();
  } catch (err) {
    spinner.fail('Unseal failed');
    throw err;
  }
}

async function unsealWithDevice(options: UnsealOptions): Promise<void> {
  output.warn('Device unseal requires a browser with WebAuthn support.');
  output.info('Use the dashboard to unseal with a registered device.');

  if (options.json) {
    output.json({
      error: 'Device unseal not supported in CLI',
      hint: 'Use the dashboard or --otp flag'
    });
  }

  process.exit(1);
}

function formatDuration(seconds: number): string {
  if (seconds < 60) {
    return `${seconds}s`;
  }
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  if (minutes < 60) {
    return remainingSeconds > 0 ? `${minutes}m ${remainingSeconds}s` : `${minutes}m`;
  }
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return remainingMinutes > 0 ? `${hours}h ${remainingMinutes}m` : `${hours}h`;
}
