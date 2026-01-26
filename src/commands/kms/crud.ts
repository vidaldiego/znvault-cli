// Path: src/commands/kms/crud.ts

/**
 * KMS CRUD operations (list, get, create, delete)
 */

import type { Command } from 'commander';
import ora from 'ora';
import Table from 'cli-table3';
import inquirer from 'inquirer';
import { client } from '../../lib/client.js';
import * as output from '../../lib/output.js';
import { getAuthContext } from '../../lib/auth-context.js';
import type {
  KMSKey,
  ListKeysResponse,
  ListOptions,
  GetOptions,
  CreateOptions,
  DeleteOptions,
} from './types.js';
import { formatDate, formatKeyState, formatPaginationInfo } from './helpers.js';

// ============================================================================
// Command Implementations
// ============================================================================

async function listKeys(options: ListOptions): Promise<void> {
  const spinner = ora('Fetching KMS keys...').start();

  try {
    const query: Record<string, string | undefined> = {};
    if (options.tenant) query.tenant = options.tenant;
    if (options.state) query.state = options.state;

    const response = await client.get<ListKeysResponse>('/v1/kms/keys?' + new URLSearchParams(query as Record<string, string>).toString());
    spinner.stop();

    if (options.json) {
      output.json(response.items);
      return;
    }

    if (response.items.length === 0) {
      output.info('No KMS keys found');
      return;
    }

    const table = new Table({
      head: ['Key ID', 'Alias', 'State', 'Created'],
      colWidths: [40, 30, 18, 24],
    });

    for (const key of response.items) {
      table.push([
        key.keyId,
        key.alias ?? '-',
        formatKeyState(key.keyState),
        formatDate(key.createdDate),
      ]);
    }

    console.log(table.toString());
    output.info(formatPaginationInfo(response.pagination, 'key'));
  } catch (error) {
    spinner.fail('Failed to list keys');
    output.fatal(output.getErrorMessage(error));
  }
}

async function getKey(keyId: string, options: GetOptions): Promise<void> {
  const spinner = ora('Fetching key details...').start();

  try {
    // API returns { keyMetadata: { ... } }
    const response = await client.get<{ keyMetadata: KMSKey }>(`/v1/kms/keys/${keyId}`);
    const key = response.keyMetadata;
    spinner.stop();

    if (options.json) {
      output.json(key);
      return;
    }

    const table = new Table({
      colWidths: [20, 60],
    });

    table.push(
      ['Key ID', key.keyId],
      ['Alias', key.alias ?? '-'],
      ['ARN', key.arn ?? '-'],
      ['State', formatKeyState(key.keyState)],
      ['Usage', key.keyUsage],
      ['Key Spec', key.keySpec],
      ['Description', key.description ?? '-'],
      ['Tenant', key.tenant ?? '-'],
      ['Created', formatDate(key.createdDate)],
    );

    if (key.deletionDate) {
      table.push(['Deletion Date', formatDate(key.deletionDate)]);
    }
    if (key.currentVersionId) {
      table.push(['Current Version', key.currentVersionId]);
    }
    if (key.rotationEnabled !== undefined) {
      table.push(['Auto-Rotation', key.rotationEnabled ? 'Enabled' : 'Disabled']);
    }
    if (key.tags && Object.keys(key.tags).length > 0) {
      const tagStr = Object.entries(key.tags).map(([k, v]) => `${k}=${v}`).join(', ');
      table.push(['Tags', tagStr]);
    }

    console.log(table.toString());
  } catch (error) {
    spinner.fail('Failed to get key');
    output.error((error as Error).message);
    process.exit(1);
  }
}

async function createKey(options: CreateOptions): Promise<void> {
  // Resolve tenant: use explicit option, or get from stored credentials
  const authContext = getAuthContext();
  const tenantId = options.tenant || authContext.tenantId;

  if (!tenantId) {
    output.error('Tenant is required. Use --tenant <id> or login to a tenant account.');
    process.exit(1);
  }

  const spinner = ora('Creating KMS key...').start();

  try {
    const body: Record<string, unknown> = {
      tenant: tenantId,
    };

    if (options.alias) {
      // Ensure alias starts with "alias/"
      body.alias = options.alias.startsWith('alias/') ? options.alias : `alias/${options.alias}`;
    }
    if (options.description) body.description = options.description;
    if (options.usage) body.usage = options.usage;
    if (options.spec) body.keySpec = options.spec;
    if (options.tags) {
      const tags: Array<{ key: string; value: string }> = [];
      const pairs = options.tags.split(',');
      for (const pair of pairs) {
        const [k, v] = pair.split('=');
        if (k && v) {
          tags.push({ key: k.trim(), value: v.trim() });
        }
      }
      body.tags = tags;
    }

    const result = await client.post<KMSKey>('/v1/kms/keys', body);
    spinner.stop();

    if (options.json) {
      output.json(result);
      return;
    }

    output.success('KMS key created successfully!');
    console.log(`  Key ID:  ${result.keyId}`);
    console.log(`  Alias:   ${result.alias ?? '-'}`);
    console.log(`  ARN:     ${result.arn}`);
    console.log(`  State:   ${result.keyState}`);
    console.log(`  Usage:   ${result.keyUsage}`);
    console.log(`  Spec:    ${result.keySpec}`);
  } catch (error) {
    spinner.fail('Failed to create key');
    output.error((error as Error).message);
    process.exit(1);
  }
}

async function deleteKey(keyId: string, options: DeleteOptions): Promise<void> {
  if (!options.force) {
    // Get key info first
    const spinner = ora('Fetching key...').start();
    try {
      const key = await client.get<KMSKey>(`/v1/kms/keys/${keyId}`);
      spinner.stop();

      const days = options.days ? parseInt(options.days, 10) : 30;
      const { confirm } = await inquirer.prompt<{ confirm: boolean }>([
        {
          type: 'confirm',
          name: 'confirm',
          message: `Schedule deletion of key "${key.alias || keyId}" in ${days} days? This cannot be undone after the waiting period.`,
          default: false,
        },
      ]);

      if (!confirm) {
        output.info('Deletion cancelled');
        return;
      }
    } catch (error) {
      spinner.fail('Failed to fetch key');
      output.error((error as Error).message);
      process.exit(1);
    }
  }

  const deleteSpinner = ora('Scheduling key deletion...').start();

  try {
    const days = options.days ? parseInt(options.days, 10) : 30;
    const result = await client.delete<{ keyId: string; deletionDate: string; message: string }>(
      `/v1/kms/keys/${keyId}?pendingWindowInDays=${days}`
    );
    deleteSpinner.stop();

    if (options.json) {
      output.json(result);
      return;
    }

    output.success('Key deletion scheduled');
    console.log(`  Key ID:          ${result.keyId}`);
    console.log(`  Deletion Date:   ${formatDate(result.deletionDate)}`);
    output.warn('You can cancel the deletion before the scheduled date by enabling the key.');
  } catch (error) {
    deleteSpinner.fail('Failed to schedule key deletion');
    output.error((error as Error).message);
    process.exit(1);
  }
}

// ============================================================================
// Command Registration
// ============================================================================

export function registerCrudCommands(parent: Command): void {
  // List keys
  parent
    .command('list')
    .description('List KMS keys')
    .option('-t, --tenant <id>', 'Filter by tenant')
    .option('--state <state>', 'Filter by state (Enabled, Disabled, PendingDeletion)')
    .option('--json', 'Output as JSON')
    .action(listKeys);

  // Get key details
  parent
    .command('get <keyId>')
    .description('Get KMS key details')
    .option('--json', 'Output as JSON')
    .action(getKey);

  // Create key
  parent
    .command('create')
    .description('Create a new KMS key')
    .option('-t, --tenant <id>', 'Tenant ID (defaults to current user tenant)')
    .option('-a, --alias <alias>', 'Key alias (e.g., my-key or alias/my-key)')
    .option('-d, --description <desc>', 'Key description')
    .option('--usage <usage>', 'Key usage (ENCRYPT_DECRYPT, SIGN_VERIFY)', 'ENCRYPT_DECRYPT')
    .option('--spec <spec>', 'Key spec (AES_256, AES_128, RSA_2048, RSA_4096)', 'AES_256')
    .option('--tags <tags>', 'Comma-separated tags (key=value,...)')
    .option('--json', 'Output as JSON')
    .action(createKey);

  // Delete key
  parent
    .command('delete <keyId>')
    .description('Schedule key deletion')
    .option('--days <days>', 'Waiting period in days (7-30)', '30')
    .option('-f, --force', 'Skip confirmation')
    .option('--json', 'Output as JSON')
    .action(deleteKey);
}
