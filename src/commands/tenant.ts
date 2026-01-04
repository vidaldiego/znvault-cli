import { type Command } from 'commander';
import ora from 'ora';
import { client } from '../lib/client.js';
import * as mode from '../lib/mode.js';
import { promptConfirm } from '../lib/prompts.js';
import * as output from '../lib/output.js';

interface TenantListOptions {
  status?: string;
  withUsage?: boolean;
  json?: boolean;
}

interface TenantCreateOptions {
  maxSecrets?: number;
  maxKeys?: number;
  email?: string;
  json?: boolean;
}

interface TenantGetOptions {
  withUsage?: boolean;
  json?: boolean;
}

interface TenantUpdateOptions {
  name?: string;
  maxSecrets?: number;
  maxKeys?: number;
  email?: string;
  status?: string;
  json?: boolean;
}

interface TenantDeleteOptions {
  yes?: boolean;
}

interface TenantUsageOptions {
  json?: boolean;
}

export function registerTenantCommands(program: Command): void {
  const tenant = program
    .command('tenant')
    .description('Tenant management commands');

  // List tenants
  tenant
    .command('list')
    .description('List all tenants')
    .option('--status <status>', 'Filter by status (active|suspended|archived)')
    .option('--with-usage', 'Include usage statistics')
    .option('--json', 'Output as JSON')
    .action(async (options: TenantListOptions) => {
      const spinner = ora('Fetching tenants...').start();

      try {
        const tenants = await mode.listTenants({
          status: options.status,
          withUsage: options.withUsage,
        });
        spinner.stop();

        if (options.json) {
          output.json(tenants);
          return;
        }

        if (tenants.length === 0) {
          output.info('No tenants found');
          return;
        }

        const headers = ['ID', 'Name', 'Status'];
        if (options.withUsage) {
          headers.push('Secrets', 'Users');
        }

        output.table(
          headers,
          tenants.map(t => {
            const row: Array<string | number | boolean> = [
              t.id,
              t.name,
              t.status,
            ];
            if (options.withUsage && t.usage) {
              row.push(t.usage.secretsCount);
              row.push(t.usage.usersCount);
            }
            return row;
          })
        );

        output.info(`Total: ${tenants.length} tenant(s)`);
      } catch (err) {
        spinner.fail('Failed to list tenants');
        output.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
      } finally {
        await mode.closeLocalClient();
      }
    });

  // Create tenant (API only)
  tenant
    .command('create <id> <name>')
    .description('Create a new tenant')
    .option('--max-secrets <number>', 'Maximum secrets allowed', parseInt)
    .option('--max-keys <number>', 'Maximum KMS keys allowed', parseInt)
    .option('--email <email>', 'Contact email')
    .option('--json', 'Output as JSON')
    .action(async (id: string, name: string, options: TenantCreateOptions) => {
      if (mode.getMode() === 'local') {
        output.error('Tenant creation requires API mode with authentication');
        output.info('Use: znvault login first, or set ZNVAULT_API_KEY');
        process.exit(1);
      }

      const spinner = ora('Creating tenant...').start();

      try {
        const result = await client.createTenant({
          id,
          name,
          maxSecrets: options.maxSecrets,
          maxKmsKeys: options.maxKeys,
          contactEmail: options.email,
        });
        spinner.succeed('Tenant created successfully');

        if (options.json) {
          output.json(result);
        } else {
          output.keyValue({
            'ID': result.id,
            'Name': result.name,
            'Status': result.status,
            'Max Secrets': result.maxSecrets ?? 'Unlimited',
            'Max KMS Keys': result.maxKmsKeys ?? 'Unlimited',
            'Created': output.formatDate(result.createdAt),
          });
        }
      } catch (err) {
        spinner.fail('Failed to create tenant');
        output.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    });

  // Get tenant
  tenant
    .command('get <id>')
    .description('Get tenant details')
    .option('--with-usage', 'Include usage statistics')
    .option('--json', 'Output as JSON')
    .action(async (id: string, options: TenantGetOptions) => {
      const spinner = ora('Fetching tenant...').start();

      try {
        const result = await mode.getTenant(id, options.withUsage);
        spinner.stop();

        if (!result) {
          output.error(`Tenant '${id}' not found`);
          process.exit(1);
        }

        if (options.json) {
          output.json(result);
          return;
        }

        output.section('Tenant Details');
        output.keyValue({
          'ID': result.id,
          'Name': result.name,
          'Status': result.status,
          'Max Secrets': result.maxSecrets ?? 'Unlimited',
          'Max KMS Keys': result.maxKmsKeys ?? 'Unlimited',
          'Contact Email': result.contactEmail ?? '-',
          'Created': output.formatDate(result.createdAt),
          'Updated': output.formatDate(result.updatedAt),
        });

        if (result.usage) {
          output.section('Usage');
          output.keyValue({
            'Secrets': result.usage.secretsCount,
            'KMS Keys': result.usage.kmsKeysCount,
            'Users': result.usage.usersCount,
            'API Keys': result.usage.apiKeysCount,
          });
        }

        console.log();
      } catch (err) {
        spinner.fail('Failed to get tenant');
        output.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
      } finally {
        await mode.closeLocalClient();
      }
    });

  // Update tenant (API only)
  tenant
    .command('update <id>')
    .description('Update tenant settings')
    .option('--name <name>', 'New tenant name')
    .option('--max-secrets <number>', 'Maximum secrets allowed', parseInt)
    .option('--max-keys <number>', 'Maximum KMS keys allowed', parseInt)
    .option('--email <email>', 'Contact email')
    .option('--status <status>', 'Tenant status (active|suspended)')
    .option('--json', 'Output as JSON')
    .action(async (id: string, options: TenantUpdateOptions) => {
      if (mode.getMode() === 'local') {
        output.error('Tenant update requires API mode with authentication');
        output.info('Use: znvault login first, or set ZNVAULT_API_KEY');
        process.exit(1);
      }

      const updates: Record<string, unknown> = {};
      if (options.name) updates.name = options.name;
      if (options.maxSecrets) updates.maxSecrets = options.maxSecrets;
      if (options.maxKeys) updates.maxKmsKeys = options.maxKeys;
      if (options.email) updates.contactEmail = options.email;
      if (options.status) updates.status = options.status;

      if (Object.keys(updates).length === 0) {
        output.error('No updates specified. Use --name, --max-secrets, --max-keys, --email, or --status');
        process.exit(1);
      }

      const spinner = ora('Updating tenant...').start();

      try {
        const result = await client.updateTenant(id, updates as Parameters<typeof client.updateTenant>[1]);
        spinner.succeed('Tenant updated successfully');

        if (options.json) {
          output.json(result);
        } else {
          output.keyValue({
            'ID': result.id,
            'Name': result.name,
            'Status': result.status,
            'Max Secrets': result.maxSecrets ?? 'Unlimited',
            'Updated': output.formatDate(result.updatedAt),
          });
        }
      } catch (err) {
        spinner.fail('Failed to update tenant');
        output.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    });

  // Delete tenant (API only)
  tenant
    .command('delete <id>')
    .description('Archive a tenant (soft delete)')
    .option('-y, --yes', 'Skip confirmation')
    .action(async (id: string, options: TenantDeleteOptions) => {
      if (mode.getMode() === 'local') {
        output.error('Tenant deletion requires API mode with authentication');
        output.info('Use: znvault login first, or set ZNVAULT_API_KEY');
        process.exit(1);
      }

      try {
        if (!options.yes) {
          const confirmed = await promptConfirm(
            `Are you sure you want to archive tenant '${id}'? This will disable all access.`
          );
          if (!confirmed) {
            output.info('Delete cancelled');
            return;
          }
        }

        const spinner = ora('Archiving tenant...').start();

        try {
          await client.deleteTenant(id);
          spinner.succeed(`Tenant '${id}' archived successfully`);
        } catch (err) {
          spinner.fail('Failed to archive tenant');
          throw err;
        }
      } catch (err) {
        output.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    });

  // Get tenant usage
  tenant
    .command('usage <id>')
    .description('Get tenant usage statistics')
    .option('--json', 'Output as JSON')
    .action(async (id: string, options: TenantUsageOptions) => {
      const spinner = ora('Fetching usage...').start();

      try {
        const usage = await mode.getTenantUsage(id);
        spinner.stop();

        if (options.json) {
          output.json(usage);
          return;
        }

        output.section(`Usage for Tenant: ${id}`);
        output.keyValue({
          'Secrets': usage.secretsCount,
          'KMS Keys': usage.kmsKeysCount,
          'Users': usage.usersCount,
          'API Keys': usage.apiKeysCount,
        });
        console.log();
      } catch (err) {
        spinner.fail('Failed to get usage');
        output.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
      } finally {
        await mode.closeLocalClient();
      }
    });
}
