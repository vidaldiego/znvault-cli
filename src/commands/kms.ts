// Path: znvault-cli/src/commands/kms.ts
// CLI commands for KMS (Key Management Service) operations

import { type Command } from 'commander';
import ora from 'ora';
import Table from 'cli-table3';
import inquirer from 'inquirer';
import { client } from '../lib/client.js';
import * as output from '../lib/output.js';

// ============================================================================
// Type Definitions
// ============================================================================

interface KMSKey {
  keyId: string;
  alias?: string;
  arn?: string;
  keyState: string;
  keyUsage: string;
  keySpec: string;
  description?: string;
  tenant?: string;
  createdDate: string;
  deletionDate?: string;
  currentVersionId?: string;
  rotationEnabled?: boolean;
  tags?: Record<string, string>;
}

interface ListKeysResponse {
  keys: Array<{
    keyId: string;
    alias?: string;
    keyState: string;
    createdDate: string;
  }>;
  nextMarker?: string;
  truncated: boolean;
}

interface EncryptResponse {
  keyId: string;
  ciphertext: string;
  encryptionContext: Record<string, string>;
}

interface DecryptResponse {
  keyId: string;
  plaintext: string;
  encryptionContext: Record<string, string>;
}

interface GenerateDataKeyResponse {
  keyId: string;
  plaintext?: string;
  ciphertext: string;
}

interface ListOptions {
  tenant?: string;
  state?: string;
  json?: boolean;
}

interface GetOptions {
  json?: boolean;
}

interface CreateOptions {
  tenant: string;
  alias?: string;
  description?: string;
  usage?: string;
  spec?: string;
  tags?: string;
  json?: boolean;
}

interface EncryptOptions {
  context?: string;
  file?: string;
  output?: string;
  json?: boolean;
}

interface DecryptOptions {
  context?: string;
  output?: string;
  json?: boolean;
}

interface RotateOptions {
  json?: boolean;
}

interface DeleteOptions {
  days?: string;
  force?: boolean;
}

interface GenerateDataKeyOptions {
  spec?: string;
  context?: string;
  output?: string;
  json?: boolean;
}

// ============================================================================
// Helper Functions
// ============================================================================

function formatDate(dateStr: string | undefined): string {
  if (!dateStr) return '-';
  return new Date(dateStr).toLocaleString();
}

function formatKeyState(state: string): string {
  const stateMap: Record<string, string> = {
    'Enabled': 'Enabled',
    'Disabled': 'Disabled',
    'PendingDeletion': 'Pending Deletion',
    'PendingImport': 'Pending Import',
  };
  return stateMap[state] || state;
}

function parseContext(contextStr?: string): Record<string, string> {
  if (!contextStr) return {};
  try {
    return JSON.parse(contextStr);
  } catch {
    // Try key=value format
    const context: Record<string, string> = {};
    const pairs = contextStr.split(',');
    for (const pair of pairs) {
      const [key, value] = pair.split('=');
      if (key && value) {
        context[key.trim()] = value.trim();
      }
    }
    return context;
  }
}

function truncateId(id: string, maxLen = 12): string {
  if (id.length <= maxLen) return id;
  return id.slice(0, maxLen - 2) + '..';
}

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
      output.json(response.keys);
      return;
    }

    if (response.keys.length === 0) {
      output.info('No KMS keys found');
      return;
    }

    const table = new Table({
      head: ['Key ID', 'Alias', 'State', 'Created'],
      colWidths: [40, 30, 18, 24],
    });

    for (const key of response.keys) {
      table.push([
        key.keyId,
        key.alias || '-',
        formatKeyState(key.keyState),
        formatDate(key.createdDate),
      ]);
    }

    console.log(table.toString());
    output.info(`Total: ${response.keys.length} key(s)${response.truncated ? ' (more available)' : ''}`);
  } catch (error) {
    spinner.fail('Failed to list keys');
    output.error((error as Error).message);
    process.exit(1);
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
      ['Alias', key.alias || '-'],
      ['ARN', key.arn || '-'],
      ['State', formatKeyState(key.keyState)],
      ['Usage', key.keyUsage],
      ['Key Spec', key.keySpec],
      ['Description', key.description || '-'],
      ['Tenant', key.tenant || '-'],
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
  if (!options.tenant) {
    output.error('Tenant is required. Use --tenant <id>');
    process.exit(1);
  }

  const spinner = ora('Creating KMS key...').start();

  try {
    const body: Record<string, unknown> = {
      tenant: options.tenant,
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
    console.log(`  Alias:   ${result.alias || '-'}`);
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

async function encryptData(keyId: string, data: string | undefined, options: EncryptOptions): Promise<void> {
  let plaintext: string;

  if (options.file) {
    const fs = await import('fs');
    if (!fs.existsSync(options.file)) {
      output.error(`File not found: ${options.file}`);
      process.exit(1);
    }
    const content = fs.readFileSync(options.file);
    plaintext = content.toString('base64');
  } else if (data) {
    plaintext = Buffer.from(data).toString('base64');
  } else {
    // Interactive prompt
    const { inputData } = await inquirer.prompt<{ inputData: string }>([
      { type: 'input', name: 'inputData', message: 'Data to encrypt:' },
    ]);
    plaintext = Buffer.from(inputData).toString('base64');
  }

  const spinner = ora('Encrypting data...').start();

  try {
    const body = {
      keyId,
      plaintext,
      context: parseContext(options.context),
    };

    const result = await client.post<EncryptResponse>('/v1/kms/encrypt', body);
    spinner.stop();

    if (options.output) {
      const fs = await import('fs');
      fs.writeFileSync(options.output, result.ciphertext);
      output.success(`Encrypted data written to: ${options.output}`);
      return;
    }

    if (options.json) {
      output.json(result);
      return;
    }

    console.log('\n--- Encrypted Data ---');
    console.log(`Key ID: ${result.keyId}`);
    console.log(`\nCiphertext (base64):`);
    console.log(result.ciphertext);

    if (Object.keys(result.encryptionContext).length > 0) {
      console.log(`\nEncryption Context:`);
      console.log(JSON.stringify(result.encryptionContext, null, 2));
    }
  } catch (error) {
    spinner.fail('Failed to encrypt data');
    output.error((error as Error).message);
    process.exit(1);
  }
}

async function decryptData(keyId: string, ciphertext: string | undefined, options: DecryptOptions): Promise<void> {
  let ciphertextData: string;

  if (!ciphertext) {
    // Interactive prompt
    const { inputCiphertext } = await inquirer.prompt<{ inputCiphertext: string }>([
      { type: 'input', name: 'inputCiphertext', message: 'Ciphertext (base64):' },
    ]);
    ciphertextData = inputCiphertext;
  } else {
    // Check if it's a file path
    const fs = await import('fs');
    if (fs.existsSync(ciphertext)) {
      ciphertextData = fs.readFileSync(ciphertext, 'utf-8').trim();
    } else {
      ciphertextData = ciphertext;
    }
  }

  const spinner = ora('Decrypting data...').start();

  try {
    const body = {
      keyId,
      ciphertext: ciphertextData,
      context: parseContext(options.context),
    };

    const result = await client.post<DecryptResponse>('/v1/kms/decrypt', body);
    spinner.stop();

    const decrypted = Buffer.from(result.plaintext, 'base64');

    if (options.output) {
      const fs = await import('fs');
      fs.writeFileSync(options.output, decrypted);
      output.success(`Decrypted data written to: ${options.output}`);
      return;
    }

    if (options.json) {
      output.json({
        keyId: result.keyId,
        plaintext: decrypted.toString('utf-8'),
        encryptionContext: result.encryptionContext,
      });
      return;
    }

    console.log('\n--- Decrypted Data ---');
    console.log(`Key ID: ${result.keyId}`);
    console.log(`\nPlaintext:`);
    console.log(decrypted.toString('utf-8'));
  } catch (error) {
    spinner.fail('Failed to decrypt data');
    output.error((error as Error).message);
    process.exit(1);
  }
}

async function rotateKey(keyId: string, options: RotateOptions): Promise<void> {
  const spinner = ora('Rotating key...').start();

  try {
    const result = await client.post<{ keyId: string; newVersionId: string; message: string }>(`/v1/kms/keys/${keyId}/rotate`, {});
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

async function generateDataKey(keyId: string, options: GenerateDataKeyOptions): Promise<void> {
  const spinner = ora('Generating data key...').start();

  try {
    const body = {
      keyId,
      keySpec: options.spec || 'AES_256',
      context: parseContext(options.context),
    };

    const result = await client.post<GenerateDataKeyResponse>('/v1/kms/generate-data-key', body);
    spinner.stop();

    if (options.output && result.plaintext) {
      const fs = await import('fs');
      const keyData = Buffer.from(result.plaintext, 'base64');
      fs.writeFileSync(options.output, keyData);
      output.success(`Data key written to: ${options.output}`);
      console.log(`\nEncrypted key (store this to decrypt the data key later):`);
      console.log(result.ciphertext);
      return;
    }

    if (options.json) {
      output.json(result);
      return;
    }

    console.log('\n--- Generated Data Key ---');
    console.log(`Key ID: ${result.keyId}`);
    console.log(`Key Spec: ${options.spec || 'AES_256'}`);
    if (result.plaintext) {
      console.log(`\nPlaintext Data Key (base64):`);
      console.log(result.plaintext);
    }
    console.log(`\nEncrypted Data Key (base64):`);
    console.log(result.ciphertext);
    output.info('\nStore the encrypted key to unwrap the data key later using KMS decrypt.');
  } catch (error) {
    spinner.fail('Failed to generate data key');
    output.error((error as Error).message);
    process.exit(1);
  }
}

async function enableKey(keyId: string): Promise<void> {
  const spinner = ora('Enabling key...').start();

  try {
    await client.post(`/v1/kms/keys/${keyId}/enable`, {});
    spinner.stop();
    output.success(`Key ${keyId} enabled`);
  } catch (error) {
    spinner.fail('Failed to enable key');
    output.error((error as Error).message);
    process.exit(1);
  }
}

async function disableKey(keyId: string): Promise<void> {
  const spinner = ora('Disabling key...').start();

  try {
    await client.post(`/v1/kms/keys/${keyId}/disable`, {});
    spinner.stop();
    output.success(`Key ${keyId} disabled`);
  } catch (error) {
    spinner.fail('Failed to disable key');
    output.error((error as Error).message);
    process.exit(1);
  }
}

async function listVersions(keyId: string, options: { json?: boolean }): Promise<void> {
  const spinner = ora('Fetching key versions...').start();

  try {
    const versions = await client.get<Array<{ versionId: string; createdAt: string; isCurrentVersion: boolean }>>(`/v1/kms/keys/${keyId}/versions`);
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

export function registerKmsCommands(program: Command): void {
  const kms = program
    .command('kms')
    .description('KMS (Key Management Service) operations');

  // List keys
  kms
    .command('list')
    .description('List KMS keys')
    .option('-t, --tenant <id>', 'Filter by tenant')
    .option('--state <state>', 'Filter by state (Enabled, Disabled, PendingDeletion)')
    .option('--json', 'Output as JSON')
    .action(listKeys);

  // Get key details
  kms
    .command('get <keyId>')
    .description('Get KMS key details')
    .option('--json', 'Output as JSON')
    .action(getKey);

  // Create key
  kms
    .command('create')
    .description('Create a new KMS key')
    .requiredOption('-t, --tenant <id>', 'Tenant ID')
    .option('-a, --alias <alias>', 'Key alias (e.g., my-key or alias/my-key)')
    .option('-d, --description <desc>', 'Key description')
    .option('--usage <usage>', 'Key usage (ENCRYPT_DECRYPT, SIGN_VERIFY)', 'ENCRYPT_DECRYPT')
    .option('--spec <spec>', 'Key spec (AES_256, AES_128, RSA_2048, RSA_4096)', 'AES_256')
    .option('--tags <tags>', 'Comma-separated tags (key=value,...)')
    .option('--json', 'Output as JSON')
    .action(createKey);

  // Encrypt data
  kms
    .command('encrypt <keyId> [data]')
    .description('Encrypt data using a KMS key')
    .option('-c, --context <context>', 'Encryption context (JSON or key=value,...)')
    .option('-f, --file <file>', 'Read data from file')
    .option('-o, --output <file>', 'Write ciphertext to file')
    .option('--json', 'Output as JSON')
    .action(encryptData);

  // Decrypt data
  kms
    .command('decrypt <keyId> [ciphertext]')
    .description('Decrypt data using a KMS key')
    .option('-c, --context <context>', 'Encryption context (JSON or key=value,...)')
    .option('-o, --output <file>', 'Write plaintext to file')
    .option('--json', 'Output as JSON')
    .action(decryptData);

  // Generate data key
  kms
    .command('generate-data-key <keyId>')
    .description('Generate a data encryption key (DEK)')
    .option('--spec <spec>', 'Key spec (AES_256, AES_128)', 'AES_256')
    .option('-c, --context <context>', 'Encryption context')
    .option('-o, --output <file>', 'Write plaintext key to file')
    .option('--json', 'Output as JSON')
    .action(generateDataKey);

  // Rotate key
  kms
    .command('rotate <keyId>')
    .description('Rotate a KMS key (create new version)')
    .option('--json', 'Output as JSON')
    .action(rotateKey);

  // Delete key
  kms
    .command('delete <keyId>')
    .description('Schedule key deletion')
    .option('--days <days>', 'Waiting period in days (7-30)', '30')
    .option('-f, --force', 'Skip confirmation')
    .action(deleteKey);

  // Enable key
  kms
    .command('enable <keyId>')
    .description('Enable a disabled key')
    .action(enableKey);

  // Disable key
  kms
    .command('disable <keyId>')
    .description('Disable a key')
    .action(disableKey);

  // List versions
  kms
    .command('versions <keyId>')
    .description('List key versions')
    .option('--json', 'Output as JSON')
    .action(listVersions);
}
