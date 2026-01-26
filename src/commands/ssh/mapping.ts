// Path: src/commands/ssh/mapping.ts

/**
 * SSH principal mapping commands
 */

import type { Command } from 'commander';
import ora from 'ora';
import { client } from '../../lib/client.js';
import { promptConfirm } from '../../lib/prompts.js';
import * as output from '../../lib/output.js';
import type { PrincipalMapping, ListOptions, CreateMappingOptions, DeleteOptions } from './types.js';
import { buildTenantQuery } from './helpers.js';

export function registerMappingCommands(parent: Command): void {
  const mapping = parent
    .command('mapping')
    .description('SSH principal mapping management (SSO groups → SSH principals)');

  // List Mappings
  mapping
    .command('list')
    .description('List principal mappings')
    .option('--tenant <id>', 'Tenant ID (superadmin only)')
    .option('--json', 'Output as JSON')
    .action(async (options: ListOptions) => {
      const spinner = ora('Fetching mappings...').start();

      try {
        const query = buildTenantQuery(options.tenant);
        const response = await client.get<{ items: PrincipalMapping[] }>(`/v1/ssh/principal-mappings${query}`);
        spinner.stop();

        if (options.json) {
          output.json(response.items);
          return;
        }

        if (response.items.length === 0) {
          output.info('No principal mappings found');
          output.info('Use "znvault ssh mapping create" to create a mapping');
          return;
        }

        output.table(
          ['ID', 'Group', 'Principals', 'Created'],
          response.items.map(m => [
            m.id.substring(0, 8) + '...',
            m.groupDisplayName ?? m.groupName ?? m.groupId.substring(0, 8),
            m.principals.join(', '),
            output.formatDate(m.createdAt),
          ])
        );

        output.info(`Total: ${response.items.length} mapping(s)`);
      } catch (err) {
        spinner.fail('Failed to list mappings');
        output.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    });

  // Create Mapping
  mapping
    .command('create <groupId> <principals...>')
    .description('Create principal mapping (SSO group → SSH principals)')
    .option('--tenant <id>', 'Tenant ID (superadmin only)')
    .option('--json', 'Output as JSON')
    .action(async (groupId: string, principals: string[], options: CreateMappingOptions) => {
      const spinner = ora('Creating mapping...').start();

      try {
        const query = buildTenantQuery(options.tenant);
        const mappingResult = await client.post<PrincipalMapping>(`/v1/ssh/principal-mappings${query}`, {
          groupId,
          principals,
        });
        spinner.succeed('Mapping created successfully');

        if (options.json) {
          output.json(mappingResult);
          return;
        }

        output.keyValue({
          'ID': mappingResult.id,
          'Group ID': mappingResult.groupId,
          'Principals': mappingResult.principals.join(', '),
          'Created': output.formatDate(mappingResult.createdAt),
        });
      } catch (err) {
        spinner.fail('Failed to create mapping');
        output.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    });

  // Update Mapping
  mapping
    .command('update <mappingId> <principals...>')
    .description('Update principal mapping')
    .option('--tenant <id>', 'Tenant ID (superadmin only)')
    .action(async (mappingId: string, principals: string[], options: { tenant?: string }) => {
      const spinner = ora('Updating mapping...').start();

      try {
        const query = buildTenantQuery(options.tenant);
        await client.put(`/v1/ssh/principal-mappings/${encodeURIComponent(mappingId)}${query}`, {
          principals,
        });
        spinner.succeed('Mapping updated successfully');
      } catch (err) {
        spinner.fail('Failed to update mapping');
        output.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    });

  // Delete Mapping
  mapping
    .command('delete <mappingId>')
    .description('Delete principal mapping')
    .option('--tenant <id>', 'Tenant ID (superadmin only)')
    .option('-y, --yes', 'Skip confirmation')
    .action(async (mappingId: string, options: DeleteOptions) => {
      try {
        const query = buildTenantQuery(options.tenant);

        if (!options.yes) {
          const confirmed = await promptConfirm('Delete this mapping?');
          if (!confirmed) {
            output.info('Delete cancelled');
            return;
          }
        }

        const spinner = ora('Deleting mapping...').start();

        try {
          await client.delete(`/v1/ssh/principal-mappings/${encodeURIComponent(mappingId)}${query}`);
          spinner.succeed('Mapping deleted successfully');
        } catch (err) {
          spinner.fail('Failed to delete mapping');
          throw err;
        }
      } catch (err) {
        output.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    });
}
