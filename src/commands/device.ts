// Path: znvault-cli/src/commands/device.ts

import { type Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import { client } from '../lib/client.js';
import { promptConfirm } from '../lib/prompts.js';
import * as output from '../lib/output.js';
import * as visual from '../lib/visual.js';

interface DeviceResponse {
  id: string;
  deviceName: string;
  deviceType: string;
  deviceFingerprint: string;
  publicKeyAlgorithm: string;
  osType: string | null;
  osVersion: string | null;
  clientVersion: string | null;
  isActive: boolean;
  lastUsed: string | null;
  useCount: number;
  enrolledAt: string;
}

interface DeviceListResponse {
  devices: DeviceResponse[];
  count: number;
}

interface DeviceListOptions {
  all?: boolean;
  json?: boolean;
}

interface DeviceRevokeOptions {
  force?: boolean;
  reason?: string;
  json?: boolean;
}

export function registerDeviceCommands(program: Command): void {
  const deviceCmd = program
    .command('device')
    .description('Manage enrolled devices for device-based unsealing');

  // List devices
  deviceCmd
    .command('list')
    .description('List enrolled devices')
    .option('--all', 'Include revoked devices')
    .option('--json', 'Output as JSON')
    .action(async (options: DeviceListOptions) => {
      const spinner = ora('Loading devices...').start();

      try {
        const query = options.all ? '?all=true' : '';
        const result = await client.get<DeviceListResponse>(`/v1/devices${query}`);
        spinner.stop();

        if (options.json) {
          output.json(result);
          return;
        }

        if (result.devices.length === 0) {
          console.log();
          output.info('No enrolled devices found.');
          output.info('Use the dashboard to enroll a device with WebAuthn/Passkey.');
          console.log();
          return;
        }

        console.log();
        console.log(visual.sectionHeader(`ENROLLED DEVICES (${result.count})`));
        console.log();

        for (const device of result.devices) {
          const statusIcon = device.isActive ? chalk.green('●') : chalk.red('●');
          const status = device.isActive ? 'Active' : 'Revoked';

          console.log(`${statusIcon} ${chalk.bold(device.deviceName)} (${device.deviceType})`);
          console.log(`  ID: ${device.id}`);
          console.log(`  Status: ${status}`);
          console.log(`  Algorithm: ${device.publicKeyAlgorithm}`);
          if (device.osType) {
            console.log(`  OS: ${device.osType}${device.osVersion ? ` ${device.osVersion}` : ''}`);
          }
          console.log(`  Enrolled: ${output.formatDate(device.enrolledAt)}`);
          if (device.lastUsed) {
            console.log(`  Last Used: ${output.formatDate(device.lastUsed)} (${device.useCount} uses)`);
          }
          console.log();
        }
      } catch (err) {
        spinner.fail('Failed to list devices');
        output.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    });

  // Revoke device
  deviceCmd
    .command('revoke <device-id>')
    .description('Revoke an enrolled device')
    .option('-f, --force', 'Skip confirmation')
    .option('-r, --reason <reason>', 'Reason for revocation')
    .option('--json', 'Output as JSON')
    .action(async (deviceId: string, options: DeviceRevokeOptions) => {
      // Confirm unless --force
      if (!options.force) {
        const confirmed = await promptConfirm(`Revoke device ${deviceId}?`, false);
        if (!confirmed) {
          output.info('Revocation cancelled');
          return;
        }
      }

      const spinner = ora('Revoking device...').start();

      try {
        // Include reason as query parameter if provided
        const query = options.reason ? `?reason=${encodeURIComponent(options.reason)}` : '';
        const result = await client.delete<{ revoked: boolean; deviceId: string }>(
          `/v1/devices/${deviceId}${query}`
        );

        spinner.succeed('Device revoked');

        if (options.json) {
          output.json(result);
        } else {
          output.success(`Device ${deviceId} has been revoked and can no longer be used for unsealing.`);
        }
      } catch (err) {
        spinner.fail('Failed to revoke device');
        output.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    });

  // Enroll device (CLI can't do WebAuthn, point to dashboard)
  deviceCmd
    .command('enroll')
    .description('Enroll a new device')
    .action(async () => {
      console.log();
      output.warn('Device enrollment requires WebAuthn/Passkey support.');
      output.info('Please use the dashboard to enroll a device:');
      console.log();
      output.info('  1. Log in to the ZN-Vault dashboard');
      output.info('  2. Navigate to Settings > Devices');
      output.info('  3. Click "Enroll This Browser"');
      output.info('  4. Complete the WebAuthn/Passkey prompt');
      console.log();
      process.exit(0);
    });
}
