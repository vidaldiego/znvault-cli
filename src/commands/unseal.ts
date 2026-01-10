// Path: znvault-cli/src/commands/unseal.ts

import { type Command } from 'commander';
import ora from 'ora';
import os from 'node:os';
import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { client } from '../lib/client.js';
import { promptInput } from '../lib/prompts.js';
import * as output from '../lib/output.js';
import * as visual from '../lib/visual.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

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

interface ChallengeResponse {
  challenge: string;
  expiresAt: string;
}

interface SecureEnclaveSignOutput {
  success: boolean;
  signature?: string;
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

// Track whether we're using software keys
let useSoftwareKey = false;

/**
 * Check if a software key exists
 */
function detectKeyType(): 'software' | 'secure_enclave' | 'none' {
  const helperPath = getSecureEnclaveHelperPath();
  if (!helperPath) return 'none';

  // Try software key first (more likely if Secure Enclave isn't properly signed)
  try {
    const env = { ...process.env, ZNVAULT_USE_SOFTWARE_KEYS: '1' };
    const result = execSync(`"${helperPath}" check`, {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
      env,
    });
    const parsed = JSON.parse(result.trim()) as SecureEnclaveCheckOutput;
    if (parsed.exists) return 'software';
  } catch {
    // Ignore
  }

  // Try Secure Enclave
  try {
    const result = execSync(`"${helperPath}" check`, {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const parsed = JSON.parse(result.trim()) as SecureEnclaveCheckOutput;
    if (parsed.exists) return 'secure_enclave';
  } catch {
    // Ignore
  }

  return 'none';
}

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
    const result = execSync(`"${helperPath}" ${args.map(a => `"${a}"`).join(' ')}`, {
      encoding: 'utf-8',
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return JSON.parse(result.trim()) as T;
  } catch (err: unknown) {
    const error = err as { stderr?: string; stdout?: string; message?: string };
    if (error.stdout) {
      try {
        return JSON.parse(error.stdout.trim()) as T;
      } catch {
        // Fall through
      }
    }
    throw new Error(error.stderr ?? error.message ?? 'Unknown error');
  }
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
        if (options.otp) {
          // User explicitly requested OTP
          await unsealWithOTP(options);
        } else if (options.device) {
          // User explicitly requested device
          await unsealWithDevice(options);
        } else {
          // Auto-detect: try device first on macOS if enrolled
          if (os.platform() === 'darwin') {
            const keyType = detectKeyType();
            if (keyType !== 'none') {
              const method = keyType === 'software' ? 'device key' : 'Touch ID';
              output.info(`Device key detected. Using ${method} for unseal.`);
              output.info('(Use --otp to force OTP unseal instead)');
              console.log();
              await unsealWithDevice(options);
              return;
            }
          }
          // Fallback to OTP
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
          statusData.Method = { value: status.method ?? 'unknown' };
          statusData.Scope = { value: status.scope };
          statusData.Expires = { value: status.unsealedUntil ?? 'unknown' };
          statusData.Remaining = {
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
  // Check platform
  if (os.platform() !== 'darwin') {
    output.error('Device unseal via Secure Enclave is only available on macOS.');
    output.info('On other platforms, use --otp or the dashboard for WebAuthn.');
    process.exit(1);
  }

  // Check if Secure Enclave helper exists
  const helperPath = getSecureEnclaveHelperPath();
  if (!helperPath) {
    output.error('Secure Enclave helper not found.');
    output.info('Please build it first:');
    console.log('  cd znvault-cli/secure-enclave && swift build -c release');
    process.exit(1);
  }

  // Detect key type (software or Secure Enclave)
  const checkSpinner = ora('Checking for enrolled device...').start();
  const keyType = detectKeyType();

  if (keyType === 'none') {
    checkSpinner.fail('No device key found');
    output.info('This device is not enrolled. Use "znvault device enroll" first.');
    process.exit(1);
  }

  useSoftwareKey = keyType === 'software';
  checkSpinner.succeed(`Device key found (${keyType === 'software' ? 'software' : 'Secure Enclave'})`)

  // Get challenge from server
  const challengeSpinner = ora('Getting challenge from server...').start();
  let challenge: string;
  try {
    const result = await client.post<ChallengeResponse>('/v1/auth/unseal/challenge', {});
    challenge = result.challenge;
    challengeSpinner.succeed('Challenge received');
  } catch (err) {
    challengeSpinner.fail('Failed to get challenge');
    throw err;
  }

  // Sign challenge with Secure Enclave (Touch ID required)
  console.log();
  output.info('Touch ID required to sign challenge...');
  console.log();

  const signSpinner = ora('Signing challenge with Secure Enclave...').start();
  let signature: string;
  try {
    const signResult = execSecureEnclaveHelper<SecureEnclaveSignOutput>(['sign', challenge]);
    if (!signResult.success || !signResult.signature) {
      throw new Error(signResult.error ?? 'Failed to sign challenge');
    }
    signature = signResult.signature;
    signSpinner.succeed('Challenge signed');
  } catch (err) {
    signSpinner.fail('Failed to sign challenge');
    output.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }

  // Verify signature with server
  const verifySpinner = ora('Verifying signature...').start();
  try {
    const result = await client.post<UnsealStatusResponse>('/v1/auth/unseal/verify', {
      challenge,
      signature,
    });

    verifySpinner.succeed('Vault unsealed');

    if (options.json) {
      output.json(result);
      return;
    }

    console.log();
    output.success(`Crypto access granted for ${formatDuration(result.remainingSeconds)}`);
    output.info('Method: Secure Enclave');
    console.log();
  } catch (err) {
    verifySpinner.fail('Signature verification failed');
    throw err;
  }
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
