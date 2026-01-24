// Path: src/commands/ssh-ca/ca.ts

/**
 * SSH CA management commands
 */

import ora from 'ora';
import inquirer from 'inquirer';
import { client } from '../../lib/client.js';
import * as output from '../../lib/output.js';
import type { SSHCAStatus, SSHCA, InitCAOptions } from './types.js';
import { formatTtl, formatKeyType, parseExtensions } from './helpers.js';

export async function getStatus(options: { json?: boolean }): Promise<void> {
  const spinner = ora('Fetching CA status...').start();

  try {
    const response = await client.get<SSHCAStatus>('/v1/ssh/ca');
    spinner.stop();

    if (options.json) {
      output.json(response);
      return;
    }

    if (!response.initialized) {
      output.warn('SSH CA is not initialized.');
      output.info('Run: znvault ssh-ca init');
      return;
    }

    output.keyValue({
      'Status': 'Initialized',
      'Key Type': formatKeyType(response.keyType),
      'Fingerprint': response.fingerprint ?? '-',
      'Default TTL': formatTtl(response.defaultTtlSeconds),
      'Max TTL': formatTtl(response.maxTtlSeconds),
      'Extensions': response.allowedExtensions?.join(', ') ?? '-',
      'Total Certificates': String(response.totalCertificatesIssued ?? 0),
      'Active Certificates': String(response.activeCertificates ?? 0),
    });
  } catch (err) {
    spinner.fail('Failed to get CA status');
    output.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}

export async function initCA(options: InitCAOptions): Promise<void> {
  // Interactive prompts if options not provided
  const keyType = options.keyType ?? (await inquirer.prompt<{ keyType: string }>([{
    type: 'list',
    name: 'keyType',
    message: 'Key type:',
    choices: [
      { name: 'Ed25519 (recommended)', value: 'ed25519' },
      { name: 'RSA-4096', value: 'rsa-4096' },
    ],
    default: 'ed25519',
  }])).keyType;

  const defaultTtl = options.defaultTtl ? parseInt(options.defaultTtl, 10) : (await inquirer.prompt<{ ttl: number }>([{
    type: 'number',
    name: 'ttl',
    message: 'Default TTL (seconds):',
    default: 28800, // 8 hours
  }])).ttl;

  const maxTtl = options.maxTtl ? parseInt(options.maxTtl, 10) : (await inquirer.prompt<{ ttl: number }>([{
    type: 'number',
    name: 'ttl',
    message: 'Maximum TTL (seconds):',
    default: 86400, // 24 hours
  }])).ttl;

  const extensionsInput = options.extensions ?? (await inquirer.prompt<{ ext: string }>([{
    type: 'input',
    name: 'ext',
    message: 'Allowed extensions (comma-separated):',
    default: 'permit-pty,permit-port-forwarding',
  }])).ext;

  const extensions = parseExtensions(extensionsInput);

  const spinner = ora('Initializing SSH CA...').start();

  try {
    const response = await client.post<SSHCA>('/v1/ssh/ca', {
      keyType,
      defaultTtlSeconds: defaultTtl,
      maxTtlSeconds: maxTtl,
      allowedExtensions: extensions,
    });
    spinner.succeed('SSH CA initialized successfully');

    if (options.json) {
      output.json(response);
      return;
    }

    output.keyValue({
      'ID': response.id,
      'Key Type': formatKeyType(response.keyType),
      'Fingerprint': response.fingerprint,
      'Default TTL': formatTtl(response.defaultTtlSeconds),
      'Max TTL': formatTtl(response.maxTtlSeconds),
      'Extensions': response.allowedExtensions.join(', '),
    });

    console.log();
    output.info('Next steps:');
    output.info('  1. Create principal mappings: znvault ssh-ca mapping create');
    output.info('  2. Create server groups: znvault ssh-ca server-group create');
    output.info('  3. Configure servers with CA public key: znvault ssh-ca public-key --raw');
  } catch (err) {
    spinner.fail('Failed to initialize CA');
    output.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}

export async function deleteCA(options: { force?: boolean; json?: boolean }): Promise<void> {
  if (!options.force) {
    const { confirm } = await inquirer.prompt<{ confirm: boolean }>([{
      type: 'confirm',
      name: 'confirm',
      message: 'Are you sure you want to delete the SSH CA? This will invalidate all issued certificates.',
      default: false,
    }]);

    if (!confirm) {
      output.info('Operation cancelled.');
      return;
    }
  }

  const spinner = ora('Deleting SSH CA...').start();

  try {
    await client.delete('/v1/ssh/ca');
    spinner.succeed('SSH CA deleted successfully');

    if (options.json) {
      output.json({ success: true });
    }
  } catch (err) {
    spinner.fail('Failed to delete CA');
    output.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}

export async function getPublicKey(options: { raw?: boolean; json?: boolean }): Promise<void> {
  const spinner = ora('Fetching CA public key...').start();

  try {
    const response = await client.get<SSHCAStatus>('/v1/ssh/ca');
    spinner.stop();

    if (!response.initialized || !response.publicKey) {
      output.error('SSH CA is not initialized.');
      process.exit(1);
    }

    if (options.raw) {
      console.log(response.publicKey);
      return;
    }

    if (options.json) {
      output.json({
        publicKey: response.publicKey,
        fingerprint: response.fingerprint,
        keyType: response.keyType,
      });
      return;
    }

    output.keyValue({
      'Fingerprint': response.fingerprint ?? '-',
      'Key Type': formatKeyType(response.keyType),
    });
    console.log();
    console.log('Public Key:');
    console.log(response.publicKey);
    console.log();
    output.info('Add this to your servers\' /etc/ssh/trusted-user-ca-keys.pub');
  } catch (err) {
    spinner.fail('Failed to get CA public key');
    output.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}
