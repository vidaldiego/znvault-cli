// Path: znvault-cli/src/commands/device.ts

import { type Command } from 'commander';
import chalk from 'chalk';

import { execSync, execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import { client } from '../lib/client.js';
import { promptConfirm, promptInput } from '../lib/prompts.js';
import * as output from '../lib/output.js';
import * as visual from '../lib/visual.js';
import { createDebugLogger } from '../lib/debug.js';

const log = createDebugLogger('device');

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

interface DeviceResponse {
  id: string;
  deviceName: string;
  deviceType: string;
  deviceFingerprint: string;
  publicKeyAlgorithm: string;
  credentialId?: string | null;
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

interface DeviceEnrollOptions {
  name?: string;
  json?: boolean;
  softwareKey?: boolean;
}

interface SecureEnclaveGenerateOutput {
  success: boolean;
  publicKeyPem?: string;
  credentialId?: string;
  error?: string;
}

interface SecureEnclaveCheckOutput {
  success: boolean;
  exists: boolean;
  error?: string;
}

/**
 * Get path to the Secure Enclave helper binary
 */
function getSecureEnclaveHelperPath(): string | null {
  // Try multiple locations
  const possiblePaths = [
    // Development: relative to CLI dist
    join(__dirname, '..', '..', 'secure-enclave', '.build', 'release', 'znvault-secure-enclave'),
    // Installed: same directory as CLI
    join(__dirname, '..', 'bin', 'znvault-secure-enclave'),
    // System-wide
    '/usr/local/bin/znvault-secure-enclave',
    // Homebrew
    '/opt/homebrew/bin/znvault-secure-enclave',
  ];

  for (const path of possiblePaths) {
    if (existsSync(path)) {
      return path;
    }
  }

  return null;
}

// Track whether we're using software keys (set during enrollment)
let useSoftwareKey = false;

/**
 * Execute Secure Enclave helper command
 */
// eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters
function execSecureEnclaveHelper<T>(args: string[]): T {
  const helperPath = getSecureEnclaveHelperPath();
  if (!helperPath) {
    throw new Error(
      'Secure Enclave helper not found. Please build it first:\n' +
      '  cd znvault-cli/secure-enclave && swift build -c release'
    );
  }

  try {
    const env = useSoftwareKey ? { ...process.env, ZNVAULT_USE_SOFTWARE_KEYS: '1' } : process.env;
    // Use execFileSync to avoid shell injection - args passed as array, not shell string
    const result = execFileSync(helperPath, args, {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
      env,
    });
    return JSON.parse(result.trim()) as T;
  } catch (err: unknown) {
    const error = err as { stderr?: Buffer | string; stdout?: Buffer | string; message?: string };
    // Try to parse JSON error from stdout
    const stdout = error.stdout?.toString();
    if (stdout) {
      try {
        return JSON.parse(stdout.trim()) as T;
      } catch (parseErr) {
        log.silenced('execSecureEnclaveHelper:parseStdout', parseErr);
      }
    }
    const stderr = error.stderr?.toString();
    throw new Error(stderr ?? error.message ?? 'Unknown error');
  }
}

/**
 * Get macOS version
 */
function getMacOSVersion(): string {
  try {
    const result = execSync('sw_vers -productVersion', { encoding: 'utf-8' });
    return result.trim();
  } catch (err) {
    log.silenced('getMacOSVersion', err);
    return 'unknown';
  }
}

/**
 * Get CLI version
 */
function getCliVersion(): string {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const pkg = require('../../package.json') as { version: string };
    return pkg.version;
  } catch (err) {
    log.silenced('getCliVersion', err);
    return 'unknown';
  }
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
      const spinner = output.spinner('Loading devices...').start();

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
          output.info('Use "znvault device enroll" to enroll this device.');
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

      const spinner = output.spinner('Revoking device...').start();

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

  // Enroll device
  deviceCmd
    .command('enroll')
    .description('Enroll this device using Secure Enclave (macOS only)')
    .option('-n, --name <name>', 'Device name')
    .option('--software-key', 'Use software key instead of Secure Enclave (for testing)')
    .option('--json', 'Output as JSON')
    .action(async (options: DeviceEnrollOptions) => {
      // Check platform
      if (os.platform() !== 'darwin') {
        output.error('Secure Enclave enrollment is only available on macOS.');
        output.info('On other platforms, use the dashboard for WebAuthn enrollment.');
        process.exit(1);
      }

      // Check if helper exists
      const helperPath = getSecureEnclaveHelperPath();
      if (!helperPath) {
        output.error('Secure Enclave helper not found.');
        output.info('Please build it first:');
        console.log('  cd znvault-cli/secure-enclave && swift build -c release');
        process.exit(1);
      }

      // Set software key mode if requested
      if (options.softwareKey) {
        useSoftwareKey = true;
      }

      // Get device name
      let deviceName = options.name;
      if (!deviceName) {
        const hostname = os.hostname().replace('.local', '');
        deviceName = await promptInput('Device name', hostname);
      }

      console.log();
      if (useSoftwareKey) {
        output.info('Enrolling device using software key...');
        output.warn('Software keys are less secure than Secure Enclave.');
      } else {
        output.info('Enrolling device using Secure Enclave...');
        output.info('You may be prompted for Touch ID or password.');
      }
      console.log();

      // Check if key already exists
      const checkSpinner = output.spinner('Checking for existing key...').start();
      try {
        const checkResult = execSecureEnclaveHelper<SecureEnclaveCheckOutput>(['check']);
        if (checkResult.exists) {
          checkSpinner.warn('A Secure Enclave key already exists');
          const replace = await promptConfirm('Replace existing key?', false);
          if (!replace) {
            output.info('Enrollment cancelled');
            process.exit(0);
          }
          // Delete existing key
          execSecureEnclaveHelper(['delete']);
        } else {
          checkSpinner.succeed('No existing key found');
        }
      } catch (err) {
        checkSpinner.fail('Failed to check for existing key');
        output.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }

      // Generate key in Secure Enclave
      const generateSpinner = output.spinner('Generating key in Secure Enclave (Touch ID required)...').start();
      let generateResult: SecureEnclaveGenerateOutput;
      try {
        generateResult = execSecureEnclaveHelper<SecureEnclaveGenerateOutput>(['generate', deviceName]);
        if (!generateResult.success) {
          throw new Error(generateResult.error ?? 'Unknown error');
        }
        generateSpinner.succeed('Key generated in Secure Enclave');
      } catch (err) {
        generateSpinner.fail('Failed to generate key');
        output.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }

      // Register with server
      const registerSpinner = output.spinner('Registering device with server...').start();
      try {
        // First, unseal check - enrollment requires being unsealed
        const unsealStatus = await client.get<{ unsealed: boolean }>('/v1/auth/unseal/status');
        if (!unsealStatus.unsealed) {
          registerSpinner.fail('Vault must be unsealed to enroll a device');
          output.info('Please unseal first: znvault unseal');
          // Clean up the generated key
          execSecureEnclaveHelper(['delete']);
          process.exit(1);
        }

        // Generate device fingerprint (UUID)
        const deviceFingerprint = crypto.randomUUID();

        // Register device
        const enrollResult = await client.post<{ device: DeviceResponse; message: string }>('/v1/devices/enroll', {
          deviceName,
          deviceType: useSoftwareKey ? 'software' : 'secure_enclave',
          deviceFingerprint,
          publicKeyPem: generateResult.publicKeyPem,
          publicKeyAlgorithm: 'ES256',
          credentialId: generateResult.credentialId,
          osType: 'macos',
          osVersion: getMacOSVersion(),
          clientVersion: getCliVersion(),
        });

        registerSpinner.succeed('Device enrolled successfully');

        if (options.json) {
          output.json(enrollResult);
        } else {
          console.log();
          output.success(`Device "${deviceName}" has been enrolled!`);
          console.log();
          console.log(`  Device ID: ${enrollResult.device.id}`);
          console.log(`  Type: ${useSoftwareKey ? 'Software Key' : 'Secure Enclave'}`);
          console.log(`  Algorithm: ES256`);
          console.log();
          if (useSoftwareKey) {
            output.info('You can now use "znvault unseal --device" to unseal with your device key.');
          } else {
            output.info('You can now use "znvault unseal --device" to unseal with Touch ID.');
          }
        }
      } catch (err) {
        registerSpinner.fail('Failed to register device');
        output.error(err instanceof Error ? err.message : String(err));
        // Clean up the generated key on failure
        try {
          execSecureEnclaveHelper(['delete']);
        } catch (cleanupErr) {
          log.silenced('enroll:cleanupKey', cleanupErr);
        }
        process.exit(1);
      }
    });

  // Delete local key (does not revoke on server)
  deviceCmd
    .command('delete-local-key')
    .description('Delete the local Secure Enclave key (does not revoke on server)')
    .option('-f, --force', 'Skip confirmation')
    .action(async (options: { force?: boolean }) => {
      if (os.platform() !== 'darwin') {
        output.error('This command is only available on macOS.');
        process.exit(1);
      }

      if (!options.force) {
        output.warn('This will delete the local Secure Enclave key.');
        output.warn('The device will remain registered on the server but cannot be used for signing.');
        const confirmed = await promptConfirm('Continue?', false);
        if (!confirmed) {
          output.info('Cancelled');
          return;
        }
      }

      const spinner = output.spinner('Deleting local key...').start();
      try {
        execSecureEnclaveHelper(['delete']);
        spinner.succeed('Local key deleted');
      } catch (err) {
        spinner.fail('Failed to delete key');
        output.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    });
}
