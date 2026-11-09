// Path: src/commands/kms/lifecycle.ts

/**
 * KMS key lifecycle operations (rotate, enable, disable, versions)
 */

import type { Command } from 'commander';

import Table from 'cli-table3';
import { kmsPost } from '../../lib/linking-kms.js';
import { linkingErrorCode, sanitiseLinkMetadata } from '../../lib/linking.js';
import { client } from '../../lib/client.js';
import * as output from '../../lib/output.js';
import type {
  KeyVersion,
  RotateOptions,
  EnableDisableOptions,
  VersionsOptions,
} from './types.js';
import { formatDate, encodeKeyId } from './helpers.js';
import { kmsKeysPath, kmsKeysQuery, withKmsContext } from './routing.js';

// ============================================================================
// Command Implementations
// ============================================================================

async function rotateKey(keyId: string, options: RotateOptions): Promise<void> {
  const spinner = output.spinner('Rotating key...').start();

  try {
    const result = await kmsPost<{ keyId: string; newVersionId: string; message: string }>(
      kmsKeysPath(options.tenant, `/${encodeKeyId(keyId)}/rotate`) + kmsKeysQuery(options.tenant),
      {}, options.requestId
    );
    spinner.stop();

    if (options.json) {
      output.json(sanitiseLinkMetadata({ ...result, ...(options.requestId ? { requestId: options.requestId } : {}) }));
      return;
    }
    if (options.requestId) output.info(`Request ID: ${options.requestId}; reuse this exact ID on retry`);
    output.success('Key rotated successfully!');
    console.log(`  Key ID:        ${result.keyId}`);
    console.log(`  New Version:   ${result.newVersionId}`);
  } catch (error) {
    spinner.fail('Failed to rotate key');
    const code = linkingErrorCode(error);
    output.error(code);
    if (code === 'KMS_REPLICATION_PENDING' && error !== null && typeof error === 'object' && 'details' in error) {
      const details = error.details;
      if (details !== null && typeof details === 'object') output.json(sanitiseLinkMetadata({ ...('operationId' in details ? { operationId: details.operationId } : {}), ...('version' in details ? { version: details.version } : {}), ...(options.requestId ? { requestId: options.requestId } : {}) }));
    }
    process.exitCode = 1;
  }
}

async function enableKey(keyId: string, options: EnableDisableOptions): Promise<void> {
  const spinner = output.spinner('Enabling key...').start();

  try {
    const result = await client.post<{ keyId: string; message?: string }>(
      kmsKeysPath(options.tenant, `/${encodeKeyId(keyId)}/enable`) + kmsKeysQuery(options.tenant),
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
      kmsKeysPath(options.tenant, `/${encodeKeyId(keyId)}/disable`) + kmsKeysQuery(options.tenant),
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
    const query = new URLSearchParams();
    if (options.limit !== undefined) {
      if (!/^(?:[1-9]|[1-9][0-9]|100)$/.test(options.limit)) throw new Error('LINKING_INVALID_REQUEST');
      query.set('limit', options.limit);
    }
    if (options.offset !== undefined) {
      if (!/^(?:0|[1-9][0-9]{0,9})$/.test(options.offset)) throw new Error('LINKING_INVALID_REQUEST');
      query.set('offset', options.offset);
    }
    const response = await client.get<KeyVersion[] | {items: Array<{version: number; createdAt: string; isPrimary: boolean; isPending: boolean}>; total: number; limit: number; offset: number}>(`/v1/kms/keys/${encodeKeyId(keyId)}/versions${query.size ? `?${query.toString()}` : ''}`);
    const versions = Array.isArray(response) ? response : response.items;
    spinner.stop();

    if (options.json) {
      output.json(sanitiseLinkMetadata(response));
      return;
    }

    if (versions.length === 0) {
      output.info('No versions found');
      return;
    }

    const table = new Table({
      head: ['Version', 'Created', 'Current', 'Pending'],
      colWidths: [40, 26, 10, 10],
    });

    for (const v of versions) {
      table.push([
        'version' in v ? String(v.version) : v.versionId,
        formatDate(v.createdAt),
        ('isPrimary' in v ? v.isPrimary : v.isCurrentVersion) ? 'Yes' : '-',
        'isPending' in v && v.isPending ? 'Yes' : '-',
      ]);
    }

    console.log(table.toString());
  } catch (error) {
    spinner.fail('Failed to fetch versions');
    output.error(linkingErrorCode(error));
    process.exitCode = 1;
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
    .option('--request-id <uuid>', 'Idempotency UUID; reuse the exact ID on retry')
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
    .option('--limit <n>', 'Page size, 1 to 100')
    .option('--offset <n>', 'Page offset, zero or greater')
    .option('--json', 'Output as JSON')
    .action((keyId: string, options: VersionsOptions) =>
      withKmsContext(asSuperadmin, () => listVersions(keyId, options))
    );
}
