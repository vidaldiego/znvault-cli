// Path: src/commands/ssh-ca/server-groups.ts

/**
 * Server group commands for SSH CA
 */


import Table from 'cli-table3';
import inquirer from 'inquirer';
import { client } from '../../lib/client.js';
import * as output from '../../lib/output.js';
import type {
  ServerGroup,
  ServerGroupsListResponse,
  AccessRule,
  ServerGroupCreateOptions,
  AccessRuleOptions,
} from './types.js';
import { formatDate, parsePrincipals, isValidPrincipal } from './helpers.js';

export async function listServerGroups(options: { json?: boolean }): Promise<void> {
  const spinner = output.spinner('Fetching server groups...').start();

  try {
    const response = await client.get<ServerGroupsListResponse>('/v1/ssh/server-groups');
    spinner.stop();

    if (options.json) {
      output.json(response.items);
      return;
    }

    if (response.items.length === 0) {
      output.info('No server groups found.');
      output.info('Create one with: znvault ssh-ca server-group create');
      return;
    }

    const table = new Table({
      head: ['ID', 'Name', 'Description', 'Created'],
      style: { head: ['cyan'] },
    });

    for (const group of response.items) {
      table.push([
        group.id.substring(0, 8) + '...',
        group.name,
        group.description ?? '-',
        formatDate(group.createdAt),
      ]);
    }

    console.log(table.toString());
    output.info(`${response.items.length} server group(s) found`);
  } catch (err) {
    spinner.fail('Failed to list server groups');
    output.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}

export async function getServerGroup(groupId: string, options: { json?: boolean }): Promise<void> {
  const spinner = output.spinner('Fetching server group...').start();

  try {
    const group = await client.get<ServerGroup>(`/v1/ssh/server-groups/${groupId}`);
    const principals = await client.get<Record<string, string[]>>(
      `/v1/ssh/server-groups/${groupId}/authorized-principals`
    );
    spinner.stop();

    if (options.json) {
      output.json({ ...group, accessRules: principals });
      return;
    }

    output.keyValue({
      'ID': group.id,
      'Name': group.name,
      'Description': group.description ?? '-',
      'Created': formatDate(group.createdAt),
      'Created By': group.createdBy ?? '-',
    });

    console.log();
    console.log('Access Rules:');

    const ruleEntries = Object.entries(principals);
    if (ruleEntries.length === 0) {
      output.info('  No access rules defined.');
      output.info('  Add one with: znvault ssh-ca server-group set-access ' + groupId);
    } else {
      const table = new Table({
        head: ['Linux User', 'Allowed Principals'],
        style: { head: ['cyan'] },
      });

      for (const [user, userPrincipals] of ruleEntries) {
        table.push([user, userPrincipals.join(', ')]);
      }

      console.log(table.toString());
    }
  } catch (err) {
    spinner.fail('Failed to get server group');
    output.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}

export async function createServerGroup(options: ServerGroupCreateOptions): Promise<void> {
  const name = options.name ?? (await inquirer.prompt<{ name: string }>([{
    type: 'input',
    name: 'name',
    message: 'Server group name:',
    validate: (input: string) => input.trim() ? true : 'Name is required',
  }])).name;

  const description = options.description ?? ((await inquirer.prompt<{ desc: string }>([{
    type: 'input',
    name: 'desc',
    message: 'Description (optional):',
  }])).desc || undefined);

  const spinner = output.spinner('Creating server group...').start();

  try {
    const response = await client.post<ServerGroup>('/v1/ssh/server-groups', {
      name,
      description,
    });
    spinner.succeed('Server group created');

    if (options.json) {
      output.json(response);
      return;
    }

    output.keyValue({
      'ID': response.id,
      'Name': response.name,
      'Description': response.description ?? '-',
    });

    console.log();
    output.info('Next: Add access rules with:');
    output.info(`  znvault ssh-ca server-group set-access ${response.id} --linux-user deploy --principals deploy,admin`);
  } catch (err) {
    spinner.fail('Failed to create server group');
    output.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}

export async function deleteServerGroup(groupId: string, options: { force?: boolean; json?: boolean }): Promise<void> {
  if (!options.force) {
    const { confirm } = await inquirer.prompt<{ confirm: boolean }>([{
      type: 'confirm',
      name: 'confirm',
      message: `Delete server group ${groupId}?`,
      default: false,
    }]);

    if (!confirm) {
      output.info('Operation cancelled.');
      return;
    }
  }

  const spinner = output.spinner('Deleting server group...').start();

  try {
    await client.delete(`/v1/ssh/server-groups/${groupId}`);
    spinner.succeed('Server group deleted');

    if (options.json) {
      output.json({ success: true });
    }
  } catch (err) {
    spinner.fail('Failed to delete server group');
    output.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}

export async function setAccessRule(groupId: string, options: AccessRuleOptions): Promise<void> {
  const linuxUser = options.linuxUser ?? (await inquirer.prompt<{ user: string }>([{
    type: 'input',
    name: 'user',
    message: 'Linux user:',
    validate: (input: string) => input.trim() ? true : 'Linux user is required',
  }])).user;

  const principalsInput = options.principals ?? (await inquirer.prompt<{ principals: string }>([{
    type: 'input',
    name: 'principals',
    message: 'Allowed principals (comma-separated):',
    validate: (input: string) => {
      const principals = parsePrincipals(input);
      if (principals.length === 0) return 'At least one principal is required';
      for (const p of principals) {
        if (!isValidPrincipal(p)) return `Invalid principal: ${p}`;
      }
      return true;
    },
  }])).principals;

  const allowedPrincipals = parsePrincipals(principalsInput);

  const spinner = output.spinner('Setting access rule...').start();

  try {
    const response = await client.put<AccessRule>(
      `/v1/ssh/server-groups/${groupId}/access`,
      { linuxUser, allowedPrincipals }
    );
    spinner.succeed('Access rule set');

    if (options.json) {
      output.json(response);
      return;
    }

    output.keyValue({
      'Linux User': response.linuxUser,
      'Allowed Principals': response.allowedPrincipals.join(', '),
    });
  } catch (err) {
    spinner.fail('Failed to set access rule');
    output.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}

export async function deleteAccessRule(
  groupId: string,
  linuxUser: string,
  options: { force?: boolean; json?: boolean }
): Promise<void> {
  if (!options.force) {
    const { confirm } = await inquirer.prompt<{ confirm: boolean }>([{
      type: 'confirm',
      name: 'confirm',
      message: `Delete access rule for ${linuxUser}?`,
      default: false,
    }]);

    if (!confirm) {
      output.info('Operation cancelled.');
      return;
    }
  }

  const spinner = output.spinner('Deleting access rule...').start();

  try {
    await client.delete(`/v1/ssh/server-groups/${groupId}/access/${linuxUser}`);
    spinner.succeed('Access rule deleted');

    if (options.json) {
      output.json({ success: true });
    }
  } catch (err) {
    spinner.fail('Failed to delete access rule');
    output.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}

export async function getAuthorizedPrincipals(groupId: string, options: { json?: boolean }): Promise<void> {
  const spinner = output.spinner('Fetching authorized principals...').start();

  try {
    const principals = await client.get<Record<string, string[]>>(
      `/v1/ssh/server-groups/${groupId}/authorized-principals`
    );
    spinner.stop();

    if (options.json) {
      output.json(principals);
      return;
    }

    const entries = Object.entries(principals);
    if (entries.length === 0) {
      output.info('No access rules defined.');
      return;
    }

    console.log('# AuthorizedPrincipalsFile content');
    console.log('# Copy to /etc/ssh/auth_principals/<username>');
    console.log();

    for (const [user, userPrincipals] of entries) {
      console.log(`# /etc/ssh/auth_principals/${user}`);
      for (const p of userPrincipals) {
        console.log(p);
      }
      console.log();
    }
  } catch (err) {
    spinner.fail('Failed to get authorized principals');
    output.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}
