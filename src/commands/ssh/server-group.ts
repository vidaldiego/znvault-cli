// Path: src/commands/ssh/server-group.ts

/**
 * SSH server group management commands
 */

import type { Command } from 'commander';

import { client } from '../../lib/client.js';
import { promptConfirm } from '../../lib/prompts.js';
import * as output from '../../lib/output.js';
import type { ServerGroup, ListOptions, CreateServerGroupOptions, GetOptions, DeleteOptions, SetAccessOptions } from './types.js';
import { buildTenantQuery } from './helpers.js';

export function registerServerGroupCommands(parent: Command): void {
  const group = parent
    .command('server-group')
    .description('SSH server group management');

  // List Server Groups
  group
    .command('list')
    .description('List server groups')
    .option('--tenant <id>', 'Tenant ID (superadmin only)')
    .option('--json', 'Output as JSON')
    .action(async (options: ListOptions) => {
      const spinner = output.spinner('Fetching server groups...').start();

      try {
        const query = buildTenantQuery(options.tenant);
        const response = await client.get<{ items: ServerGroup[] }>(`/v1/ssh/server-groups${query}`);
        spinner.stop();

        if (options.json) {
          output.json(response.items);
          return;
        }

        if (response.items.length === 0) {
          output.info('No server groups found');
          output.info('Use "znvault ssh server-group create" to create a group');
          return;
        }

        output.table(
          ['ID', 'Name', 'Description', 'Created'],
          response.items.map(g => [
            g.id.substring(0, 8) + '...',
            g.name,
            (g.description ?? '-').substring(0, 30),
            output.formatDate(g.createdAt),
          ])
        );

        output.info(`Total: ${response.items.length} server group(s)`);
      } catch (err) {
        spinner.fail('Failed to list server groups');
        output.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    });

  // Create Server Group
  group
    .command('create <name>')
    .description('Create server group')
    .option('--tenant <id>', 'Tenant ID (superadmin only)')
    .option('-d, --description <text>', 'Group description')
    .option('--json', 'Output as JSON')
    .action(async (name: string, options: CreateServerGroupOptions) => {
      const spinner = output.spinner('Creating server group...').start();

      try {
        const query = buildTenantQuery(options.tenant);
        const groupResult = await client.post<ServerGroup>(`/v1/ssh/server-groups${query}`, {
          name,
          description: options.description,
        });
        spinner.succeed('Server group created successfully');

        if (options.json) {
          output.json(groupResult);
          return;
        }

        output.keyValue({
          'ID': groupResult.id,
          'Name': groupResult.name,
          'Description': groupResult.description ?? '-',
          'Created': output.formatDate(groupResult.createdAt),
        });
      } catch (err) {
        spinner.fail('Failed to create server group');
        output.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    });

  // Get Server Group
  group
    .command('get <id>')
    .description('Get server group details')
    .option('--tenant <id>', 'Tenant ID (superadmin only)')
    .option('--json', 'Output as JSON')
    .action(async (id: string, options: GetOptions) => {
      const spinner = output.spinner('Fetching server group...').start();

      try {
        const query = buildTenantQuery(options.tenant);
        const groupResult = await client.get<ServerGroup>(`/v1/ssh/server-groups/${encodeURIComponent(id)}${query}`);
        spinner.stop();

        if (options.json) {
          output.json(groupResult);
          return;
        }

        output.section('Server Group');
        output.keyValue({
          'ID': groupResult.id,
          'Name': groupResult.name,
          'Description': groupResult.description ?? '-',
          'Created': output.formatDate(groupResult.createdAt),
        });

        if (groupResult.accessRules && groupResult.accessRules.length > 0) {
          output.section('Access Rules');
          output.table(
            ['Linux User', 'Allowed Principals'],
            groupResult.accessRules.map(r => [
              r.linuxUser,
              r.allowedPrincipals.join(', '),
            ])
          );
        } else {
          output.section('Access Rules');
          output.info('No access rules defined');
          output.info('Use "znvault ssh server-group set-access" to add rules');
        }
      } catch (err) {
        spinner.fail('Failed to get server group');
        output.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    });

  // Delete Server Group
  group
    .command('delete <id>')
    .description('Delete server group')
    .option('--tenant <id>', 'Tenant ID (superadmin only)')
    .option('-y, --yes', 'Skip confirmation')
    .action(async (id: string, options: DeleteOptions) => {
      try {
        const query = buildTenantQuery(options.tenant);

        if (!options.yes) {
          const confirmed = await promptConfirm('Delete this server group?');
          if (!confirmed) {
            output.info('Delete cancelled');
            return;
          }
        }

        const spinner = output.spinner('Deleting server group...').start();

        try {
          await client.delete(`/v1/ssh/server-groups/${encodeURIComponent(id)}${query}`);
          spinner.succeed('Server group deleted successfully');
        } catch (err) {
          spinner.fail('Failed to delete server group');
          throw err;
        }
      } catch (err) {
        output.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    });

  // Set Access Rule
  group
    .command('set-access <groupId> <linuxUser> <principals...>')
    .description('Set access rule for server group (which principals can access which Linux user)')
    .option('--tenant <id>', 'Tenant ID (superadmin only)')
    .option('--json', 'Output as JSON')
    .action(async (groupId: string, linuxUser: string, principals: string[], options: SetAccessOptions) => {
      const spinner = output.spinner('Setting access rule...').start();

      try {
        const query = buildTenantQuery(options.tenant);
        const access = await client.put<{ linuxUser: string; allowedPrincipals: string[] }>(
          `/v1/ssh/server-groups/${encodeURIComponent(groupId)}/access${query}`,
          { linuxUser, allowedPrincipals: principals }
        );
        spinner.succeed('Access rule set successfully');

        if (options.json) {
          output.json(access);
          return;
        }

        output.keyValue({
          'Linux User': access.linuxUser,
          'Allowed Principals': access.allowedPrincipals.join(', '),
        });
      } catch (err) {
        spinner.fail('Failed to set access rule');
        output.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    });

  // Delete Access Rule
  group
    .command('delete-access <groupId> <linuxUser>')
    .description('Delete access rule from server group')
    .option('--tenant <id>', 'Tenant ID (superadmin only)')
    .option('-y, --yes', 'Skip confirmation')
    .action(async (groupId: string, linuxUser: string, options: DeleteOptions) => {
      try {
        const query = buildTenantQuery(options.tenant);

        if (!options.yes) {
          const confirmed = await promptConfirm(`Delete access rule for Linux user "${linuxUser}"?`);
          if (!confirmed) {
            output.info('Delete cancelled');
            return;
          }
        }

        const spinner = output.spinner('Deleting access rule...').start();

        try {
          await client.delete(
            `/v1/ssh/server-groups/${encodeURIComponent(groupId)}/access/${encodeURIComponent(linuxUser)}${query}`
          );
          spinner.succeed('Access rule deleted successfully');
        } catch (err) {
          spinner.fail('Failed to delete access rule');
          throw err;
        }
      } catch (err) {
        output.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    });

  // Get Authorized Principals
  group
    .command('authorized-principals <groupId>')
    .description('Get AuthorizedPrincipalsFile content for a server group')
    .option('--tenant <id>', 'Tenant ID (superadmin only)')
    .option('--output <file>', 'Output to file')
    .action(async (groupId: string, options: { tenant?: string; output?: string }) => {
      const spinner = output.spinner('Generating authorized principals...').start();

      try {
        const query = buildTenantQuery(options.tenant);
        const response = await client.get<Record<string, string[]>>(
          `/v1/ssh/server-groups/${encodeURIComponent(groupId)}/authorized-principals${query}`
        );
        spinner.stop();

        // Format as AuthorizedPrincipalsFile content
        const lines: string[] = [];
        for (const [linuxUser, principals] of Object.entries(response)) {
          lines.push(`# Linux user: ${linuxUser}`);
          for (const principal of principals) {
            lines.push(principal);
          }
          lines.push('');
        }

        const content = lines.join('\n');

        if (options.output) {
          const fs = await import('fs');
          const path = await import('path');
          fs.writeFileSync(path.resolve(options.output), content);
          output.success(`Written to ${options.output}`);
        } else {
          console.log(content);
        }
      } catch (err) {
        spinner.fail('Failed to get authorized principals');
        output.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    });
}
