// Path: src/commands/kms/lifecycle.ts

/**
 * KMS key lifecycle operations (rotate, enable, disable, versions)
 */

import type { Command } from 'commander';

import Table from 'cli-table3';
import { client } from '../../lib/client.js';
import * as output from '../../lib/output.js';
import type {
  KeyVersion,
  RotateOptions,
  EnableDisableOptions,
  VersionsOptions,
} from './types.js';
import { formatDate } from './helpers.js';
import { kmsKeysPath, kmsKeysQuery, withKmsContext } from './routing.js';

// ============================================================================
// Command Implementations
// ============================================================================

async function rotateKey(keyId: string, options: RotateOptions): Promise<void> {
  const spinner = output.spinner('Rotating key...').start();

  try {
    const result = await client.post<{ keyId: string; newVersionId: string; message: string }>(
      kmsKeysPath(options.tenant, `/${keyId}/rotate`) + kmsKeysQuery(options.tenant),
      {}
    );
    spinner.stop();

    if (options.json) {
      output.json(result);
      return;
    }

    output.success('Key rotated successfully!');
    console.log(`  Key ID:        ${result.keyId}`);
    console.log(`  New Version:   ${result.newVersionId}`);
  } catch (error) {
    spinner.fail('Failed to rotate key');
    output.error((error as Error).message);
    process.exit(1);
  }
}

async function enableKey(keyId: string, options: EnableDisableOptions): Promise<void> {
  const spinner = output.spinner('Enabling key...').start();

  try {
    const result = await client.post<{ keyId: string; message?: string }>(
      kmsKeysPath(options.tenant, `/${keyId}/enable`) + kmsKeysQuery(options.tenant),
      {}
    );
    spinner.stop();

    if (options.json) {
      output.json({ success: true, ...result });
      return;
    }

    output.success(`Key ${keyId} enabled`);
  } catch (error) {
    spinner.fail('Failed to enable key');
    output.error((error as Error).message);
    process.exit(1);
  }
}

async function disableKey(keyId: string, options: EnableDisableOptions): Promise<void> {
  const spinner = output.spinner('Disabling key...').start();

  try {
    const result = await client.post<{ keyId: string; message?: string }>(
      kmsKeysPath(options.tenant, `/${keyId}/disable`) + kmsKeysQuery(options.tenant),
      {}
    );
    spinner.stop();

    if (options.json) {
      output.json({ success: true, ...result });
      return;
    }

    output.success(`Key ${keyId} disabled`);
  } catch (error) {
    spinner.fail('Failed to disable key');
    output.error((error as Error).message);
    process.exit(1);
  }
}

async function listVersions(keyId: string, options: VersionsOptions): Promise<void> {
  const spinner = output.spinner('Fetching key versions...').start();

  try {
    const versions = await client.get<KeyVersion[]>(`/v1/kms/keys/${keyId}/versions`);
    spinner.stop();

    if (options.json) {
      output.json(versions);
      return;
    }

    if (versions.length === 0) {
      output.info('No versions found');
      return;
    }

    const table = new Table({
      head: ['Version ID', 'Created', 'Current'],
      colWidths: [40, 26, 10],
    });

    for (const v of versions) {
      table.push([
        v.versionId,
        formatDate(v.createdAt),
        v.isCurrentVersion ? 'Yes' : '-',
      ]);
    }

    console.log(table.toString());
  } catch (error) {
    spinner.fail('Failed to fetch versions');
    output.error((error as Error).message);
    process.exit(1);
  }
}

// ============================================================================
// Command Registration
// ============================================================================

export function registerLifecycleCommands(parent: Command, asSuperadmin = false): void {
  // Rotate key
  parent
    .command('rotate <keyId>')
    .description('Rotate a KMS key (create new version)')
    .option('-t, --tenant <id>', 'Tenant ID (superadmin only — routes via /v1/superadmin/kms/keys)')
    .option('--json', 'Output as JSON')
    .action((keyId: string, options: RotateOptions) =>
      withKmsContext(asSuperadmin, () => rotateKey(keyId, options))
    );

  // Enable key
  parent
    .command('enable <keyId>')
    .description('Enable a disabled key')
    .option('-t, --tenant <id>', 'Tenant ID (superadmin only — routes via /v1/superadmin/kms/keys)')
    .option('--json', 'Output as JSON')
    .action((keyId: string, options: EnableDisableOptions) =>
      withKmsContext(asSuperadmin, () => enableKey(keyId, options))
    );

  // Disable key
  parent
    .command('disable <keyId>')
    .description('Disable a key')
    .option('-t, --tenant <id>', 'Tenant ID (superadmin only — routes via /v1/superadmin/kms/keys)')
    .option('--json', 'Output as JSON')
    .action((keyId: string, options: EnableDisableOptions) =>
      withKmsContext(asSuperadmin, () => disableKey(keyId, options))
    );

  // List versions (tenant-only on server; superadmin has no equivalent endpoint)
  parent
    .command('versions <keyId>')
    .description('List key versions')
    .option('--json', 'Output as JSON')
    .action((keyId: string, options: VersionsOptions) =>
      withKmsContext(asSuperadmin, () => listVersions(keyId, options))
    );
}
