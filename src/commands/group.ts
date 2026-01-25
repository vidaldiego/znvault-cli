// Path: znvault-cli/src/commands/group.ts

import { type Command } from 'commander';
import ora from 'ora';
import { client } from '../lib/client.js';
import { promptConfirm } from '../lib/prompts.js';
import * as output from '../lib/output.js';

// ============================================================================
// Types
// ============================================================================

interface SSOGroup {
  id: string;
  tenantId: string;
  name: string;
  displayName: string | null;
  description: string | null;
  metadata: Record<string, unknown>;
  memberCount?: number;
  createdBy: string | null;
  createdByUsername?: string;
  createdAt: string;
  updatedAt: string;
}

interface SSOGroupMember {
  id: string;
  groupId: string;
  userId: string;
  username: string;
  email: string | null;
  metadata: Record<string, unknown>;
  addedBy: string | null;
  addedAt: string;
}

interface ListOptions {
  tenant?: string;
  json?: boolean;
}

interface GetOptions {
  json?: boolean;
}

interface CreateOptions {
  displayName?: string;
  description?: string;
  json?: boolean;
}

interface UpdateOptions {
  name?: string;
  displayName?: string;
  description?: string;
  json?: boolean;
}

interface DeleteOptions {
  yes?: boolean;
}

interface MembersListOptions {
  json?: boolean;
}

interface MembersRemoveOptions {
  yes?: boolean;
}

// ============================================================================
// Commands
// ============================================================================

export function registerGroupCommands(program: Command): void {
  const group = program
    .command('group')
    .description('SSO group management');

  // ---------------------------------------------------------------------------
  // List Groups
  // ---------------------------------------------------------------------------
  group
    .command('list')
    .description('List SSO groups')
    .option('--tenant <id>', 'Filter by tenant (superadmin only)')
    .option('--json', 'Output as JSON')
    .action(async (options: ListOptions) => {
      const spinner = ora('Fetching groups...').start();

      try {
        const params = new URLSearchParams();
        if (options.tenant) {
          params.set('tenantId', options.tenant);
        }

        const queryString = params.toString() ? `?${params.toString()}` : '';
        const data = await client.get<{ items: SSOGroup[]; pagination: { total: number } }>(
          `/v1/sso/groups${queryString}`
        );
        spinner.stop();

        if (options.json) {
          output.json(data);
          return;
        }

        if (data.items.length === 0) {
          output.info('No groups found');
          return;
        }

        output.table(
          ['Name', 'Display Name', 'Members', 'Created'],
          data.items.map((g) => [
            g.name,
            g.displayName ?? '-',
            g.memberCount ?? 0,
            new Date(g.createdAt).toLocaleDateString(),
          ])
        );

        output.info(`Total: ${data.pagination.total} group(s)`);
      } catch (err) {
        spinner.fail('Error fetching groups');
        output.error(err instanceof Error ? err.message : 'Unknown error');
        process.exit(1);
      }
    });

  // ---------------------------------------------------------------------------
  // Create Group
  // ---------------------------------------------------------------------------
  group
    .command('create <name>')
    .description('Create a new SSO group')
    .option('--display-name <name>', 'Human-readable display name')
    .option('--description <text>', 'Group description')
    .option('--json', 'Output as JSON')
    .action(async (name: string, options: CreateOptions) => {
      const spinner = ora('Creating group...').start();

      try {
        const body: Record<string, unknown> = {
          name,
        };

        if (options.displayName) {
          body.display_name = options.displayName;
        }
        if (options.description) {
          body.description = options.description;
        }

        const data = await client.post<SSOGroup>('/v1/sso/groups', body);
        spinner.succeed('Group created successfully');

        if (options.json) {
          output.json(data);
          return;
        }

        output.keyValue({
          'ID': data.id,
          'Name': data.name,
          'Display Name': data.displayName ?? '-',
          'Description': data.description ?? '-',
        });
      } catch (err) {
        spinner.fail('Error creating group');
        output.error(err instanceof Error ? err.message : 'Unknown error');
        process.exit(1);
      }
    });

  // ---------------------------------------------------------------------------
  // Get Group
  // ---------------------------------------------------------------------------
  group
    .command('get <id>')
    .description('Get group details')
    .option('--json', 'Output as JSON')
    .action(async (id: string, options: GetOptions) => {
      const spinner = ora('Fetching group...').start();

      try {
        const data = await client.get<SSOGroup>(`/v1/sso/groups/${id}`);
        spinner.stop();

        if (options.json) {
          output.json(data);
          return;
        }

        output.keyValue({
          'ID': data.id,
          'Tenant': data.tenantId,
          'Name': data.name,
          'Display Name': data.displayName ?? '-',
          'Description': data.description ?? '-',
          'Members': data.memberCount ?? 'N/A',
          'Created By': data.createdByUsername ?? data.createdBy ?? '-',
          'Created At': new Date(data.createdAt).toLocaleString(),
          'Updated At': new Date(data.updatedAt).toLocaleString(),
        });
      } catch (err) {
        spinner.fail('Error fetching group');
        output.error(err instanceof Error ? err.message : 'Unknown error');
        process.exit(1);
      }
    });

  // ---------------------------------------------------------------------------
  // Update Group
  // ---------------------------------------------------------------------------
  group
    .command('update <id>')
    .description('Update group')
    .option('--name <name>', 'New group name')
    .option('--display-name <name>', 'New display name')
    .option('--description <text>', 'New description')
    .option('--json', 'Output as JSON')
    .action(async (id: string, options: UpdateOptions) => {
      const spinner = ora('Updating group...').start();

      try {
        const body: Record<string, unknown> = {};

        if (options.name) {
          body.name = options.name;
        }
        if (options.displayName !== undefined) {
          body.display_name = options.displayName || null;
        }
        if (options.description !== undefined) {
          body.description = options.description || null;
        }

        if (Object.keys(body).length === 0) {
          spinner.fail('No updates specified');
          output.error('Use --name, --display-name, or --description to specify updates');
          process.exit(1);
        }

        const data = await client.patch<SSOGroup>(`/v1/sso/groups/${id}`, body);
        spinner.succeed('Group updated successfully');

        if (options.json) {
          output.json(data);
          return;
        }

        output.keyValue({
          'ID': data.id,
          'Name': data.name,
          'Display Name': data.displayName ?? '-',
          'Description': data.description ?? '-',
        });
      } catch (err) {
        spinner.fail('Error updating group');
        output.error(err instanceof Error ? err.message : 'Unknown error');
        process.exit(1);
      }
    });

  // ---------------------------------------------------------------------------
  // Delete Group
  // ---------------------------------------------------------------------------
  group
    .command('delete <id>')
    .description('Delete group')
    .option('-y, --yes', 'Skip confirmation')
    .action(async (id: string, options: DeleteOptions) => {
      try {
        // Get group info for confirmation
        const groupData = await client.get<SSOGroup>(`/v1/sso/groups/${id}`);

        if (!options.yes) {
          const confirmed = await promptConfirm(
            `Delete group "${groupData.name}"? This will remove all members.`
          );
          if (!confirmed) {
            output.info('Cancelled');
            return;
          }
        }

        const spinner = ora('Deleting group...').start();

        await client.delete(`/v1/sso/groups/${id}`);
        spinner.succeed(`Group "${groupData.name}" deleted`);
      } catch (err) {
        output.error(err instanceof Error ? err.message : 'Unknown error');
        process.exit(1);
      }
    });

  // ---------------------------------------------------------------------------
  // Members Subcommand
  // ---------------------------------------------------------------------------
  const members = group
    .command('members')
    .description('Manage group members');

  // List members
  members
    .command('list <groupId>')
    .description('List group members')
    .option('--json', 'Output as JSON')
    .action(async (groupId: string, options: MembersListOptions) => {
      const spinner = ora('Fetching members...').start();

      try {
        const data = await client.get<{ items: SSOGroupMember[]; pagination: { total: number } }>(
          `/v1/sso/groups/${groupId}/members`
        );
        spinner.stop();

        if (options.json) {
          output.json(data);
          return;
        }

        if (data.items.length === 0) {
          output.info('No members found');
          return;
        }

        output.table(
          ['User ID', 'Username', 'Email', 'Added At'],
          data.items.map((m) => [
            m.userId,
            m.username,
            m.email ?? '-',
            new Date(m.addedAt).toLocaleDateString(),
          ])
        );

        output.info(`Total: ${data.pagination.total} member(s)`);
      } catch (err) {
        spinner.fail('Error fetching members');
        output.error(err instanceof Error ? err.message : 'Unknown error');
        process.exit(1);
      }
    });

  // Add member
  members
    .command('add <groupId> <userId>')
    .description('Add user to group')
    .action(async (groupId: string, userId: string) => {
      const spinner = ora('Adding member...').start();

      try {
        const data = await client.post<SSOGroupMember>(`/v1/sso/groups/${groupId}/members`, {
          user_id: userId,
        });
        spinner.succeed('Member added successfully');

        output.keyValue({
          'User ID': data.userId,
          'Username': data.username,
          'Added At': new Date(data.addedAt).toLocaleString(),
        });
      } catch (err) {
        spinner.fail('Error adding member');
        output.error(err instanceof Error ? err.message : 'Unknown error');
        process.exit(1);
      }
    });

  // Remove member
  members
    .command('remove <groupId> <userId>')
    .description('Remove user from group')
    .option('-y, --yes', 'Skip confirmation')
    .action(async (groupId: string, userId: string, options: MembersRemoveOptions) => {
      try {
        if (!options.yes) {
          const confirmed = await promptConfirm(
            `Remove user ${userId} from group?`
          );
          if (!confirmed) {
            output.info('Cancelled');
            return;
          }
        }

        const spinner = ora('Removing member...').start();

        await client.delete(`/v1/sso/groups/${groupId}/members/${userId}`);
        spinner.succeed('Member removed successfully');
      } catch (err) {
        output.error(err instanceof Error ? err.message : 'Unknown error');
        process.exit(1);
      }
    });

  // ---------------------------------------------------------------------------
  // My Groups
  // ---------------------------------------------------------------------------
  group
    .command('my-groups')
    .description('List groups you belong to')
    .option('--json', 'Output as JSON')
    .action(async (options: { json?: boolean }) => {
      const spinner = ora('Fetching your groups...').start();

      try {
        const data = await client.get<{ groups: Array<{ id: string; name: string; displayName: string | null }> }>(
          '/v1/sso/my-groups'
        );
        spinner.stop();

        if (options.json) {
          output.json(data);
          return;
        }

        if (data.groups.length === 0) {
          output.info('You are not a member of any groups');
          return;
        }

        output.table(
          ['ID', 'Name', 'Display Name'],
          data.groups.map((g) => [
            g.id,
            g.name,
            g.displayName ?? '-',
          ])
        );

        output.info(`Total: ${data.groups.length} group(s)`);
      } catch (err) {
        spinner.fail('Error fetching groups');
        output.error(err instanceof Error ? err.message : 'Unknown error');
        process.exit(1);
      }
    });
}
