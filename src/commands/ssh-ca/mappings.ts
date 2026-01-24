// Path: src/commands/ssh-ca/mappings.ts

/**
 * Principal mapping commands for SSH CA
 */

import ora from 'ora';
import Table from 'cli-table3';
import inquirer from 'inquirer';
import { client } from '../../lib/client.js';
import * as output from '../../lib/output.js';
import type {
  PrincipalMapping,
  MappingsListResponse,
  MappingCreateOptions,
  MappingUpdateOptions,
} from './types.js';
import { formatDate, formatPrincipals, parsePrincipals, isValidPrincipal } from './helpers.js';

interface SSOGroup {
  id: string;
  name: string;
  displayName?: string;
}

interface SSOGroupsResponse {
  items: SSOGroup[];
}

export async function listMappings(options: { json?: boolean }): Promise<void> {
  const spinner = ora('Fetching principal mappings...').start();

  try {
    const response = await client.get<MappingsListResponse>('/v1/ssh/principal-mappings');
    spinner.stop();

    if (options.json) {
      output.json(response.items);
      return;
    }

    if (response.items.length === 0) {
      output.info('No principal mappings found.');
      output.info('Create one with: znvault ssh-ca mapping create');
      return;
    }

    const table = new Table({
      head: ['ID', 'SSO Group', 'Principals', 'Created'],
      style: { head: ['cyan'] },
    });

    for (const mapping of response.items) {
      table.push([
        mapping.id.substring(0, 8) + '...',
        mapping.groupDisplayName ?? mapping.groupName ?? mapping.groupId.substring(0, 8),
        formatPrincipals(mapping.principals),
        formatDate(mapping.createdAt),
      ]);
    }

    console.log(table.toString());
    output.info(`${response.items.length} mapping(s) found`);
  } catch (err) {
    spinner.fail('Failed to list mappings');
    output.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}

export async function createMapping(options: MappingCreateOptions): Promise<void> {
  // Fetch SSO groups for selection
  let groups: SSOGroup[] = [];
  try {
    const groupsResponse = await client.get<SSOGroupsResponse>('/v1/sso/groups');
    groups = groupsResponse.items;
  } catch {
    // Groups endpoint might fail, continue with manual input
  }

  let groupId = options.groupId;
  if (!groupId) {
    if (groups.length > 0) {
      const { selectedGroup } = await inquirer.prompt<{ selectedGroup: string }>([{
        type: 'list',
        name: 'selectedGroup',
        message: 'Select SSO group:',
        choices: groups.map(g => ({
          name: g.displayName ?? g.name,
          value: g.id,
        })),
      }]);
      groupId = selectedGroup;
    } else {
      const { id } = await inquirer.prompt<{ id: string }>([{
        type: 'input',
        name: 'id',
        message: 'SSO Group ID:',
        validate: (input: string) => input.trim() ? true : 'Group ID is required',
      }]);
      groupId = id;
    }
  }

  const principalsInput = options.principals ?? (await inquirer.prompt<{ principals: string }>([{
    type: 'input',
    name: 'principals',
    message: 'SSH Principals (comma-separated):',
    validate: (input: string) => {
      const principals = parsePrincipals(input);
      if (principals.length === 0) return 'At least one principal is required';
      for (const p of principals) {
        if (!isValidPrincipal(p)) return `Invalid principal: ${p}`;
      }
      return true;
    },
  }])).principals;

  const principals = parsePrincipals(principalsInput);

  const spinner = ora('Creating principal mapping...').start();

  try {
    const response = await client.post<PrincipalMapping>('/v1/ssh/principal-mappings', {
      groupId,
      principals,
    });
    spinner.succeed('Principal mapping created');

    if (options.json) {
      output.json(response);
      return;
    }

    output.keyValue({
      'ID': response.id,
      'Group ID': response.groupId,
      'Principals': response.principals.join(', '),
      'Created': formatDate(response.createdAt),
    });
  } catch (err) {
    spinner.fail('Failed to create mapping');
    output.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}

export async function updateMapping(mappingId: string, options: MappingUpdateOptions): Promise<void> {
  const principalsInput = options.principals ?? (await inquirer.prompt<{ principals: string }>([{
    type: 'input',
    name: 'principals',
    message: 'New SSH Principals (comma-separated):',
    validate: (input: string) => {
      const principals = parsePrincipals(input);
      if (principals.length === 0) return 'At least one principal is required';
      for (const p of principals) {
        if (!isValidPrincipal(p)) return `Invalid principal: ${p}`;
      }
      return true;
    },
  }])).principals;

  const principals = parsePrincipals(principalsInput);

  const spinner = ora('Updating principal mapping...').start();

  try {
    await client.put(`/v1/ssh/principal-mappings/${mappingId}`, { principals });
    spinner.succeed('Principal mapping updated');

    if (options.json) {
      output.json({ success: true, mappingId, principals });
    }
  } catch (err) {
    spinner.fail('Failed to update mapping');
    output.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}

export async function deleteMapping(mappingId: string, options: { force?: boolean; json?: boolean }): Promise<void> {
  if (!options.force) {
    const { confirm } = await inquirer.prompt<{ confirm: boolean }>([{
      type: 'confirm',
      name: 'confirm',
      message: `Delete principal mapping ${mappingId}?`,
      default: false,
    }]);

    if (!confirm) {
      output.info('Operation cancelled.');
      return;
    }
  }

  const spinner = ora('Deleting principal mapping...').start();

  try {
    await client.delete(`/v1/ssh/principal-mappings/${mappingId}`);
    spinner.succeed('Principal mapping deleted');

    if (options.json) {
      output.json({ success: true });
    }
  } catch (err) {
    spinner.fail('Failed to delete mapping');
    output.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}
