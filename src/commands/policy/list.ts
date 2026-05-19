// Path: src/commands/policy/list.ts

/**
 * Policy list and get commands
 */


import type { Command } from 'commander';
import { client } from '../../lib/client.js';
import * as output from '../../lib/output.js';
import { shortId, formatActiveStatus, formatPaginationInfo } from '../../lib/format-helpers.js';
import type { PolicyListOptions, PolicyGetOptions } from './types.js';
import { policyAsSuperadmin } from './helpers.js';

export async function listPolicies(options: PolicyListOptions, cmd?: Command): Promise<void> {
  const asSuperadmin = policyAsSuperadmin(cmd);
  const spinner = output.spinner('Fetching policies...').start();

  try {
    const result = await client.listPolicies({
      tenantId: options.tenant,
      enabled: options.enabled ? true : options.disabled ? false : undefined,
      effect: options.effect as 'allow' | 'deny' | undefined,
      search: options.search,
      asSuperadmin,
    });
    spinner.stop();

    if (options.json) {
      output.json(result.items);
      return;
    }

    if (result.items.length === 0) {
      output.info('No policies found');
      return;
    }

    output.table(
      ['ID', 'Name', 'Effect', 'Priority', 'Actions', 'Status', 'Tenant'],
      result.items.map(p => [
        shortId(p.id),
        p.name.length > 25 ? p.name.substring(0, 22) + '...' : p.name,
        p.effect.toUpperCase(),
        p.priority.toString(),
        p.actions.length > 2 ? `${p.actions.slice(0, 2).join(', ')}...` : p.actions.join(', '),
        formatActiveStatus(p.isActive),
        p.tenantId ?? '-',
      ])
    );

    output.info(formatPaginationInfo(result.pagination, 'policy'));
  } catch (err) {
    spinner.fail('Failed to list policies');
    output.fatal(output.getErrorMessage(err));
  }
}

export async function getPolicy(id: string, options: PolicyGetOptions, cmd?: Command): Promise<void> {
  const spinner = output.spinner('Fetching policy...').start();
  const asSuperadmin = policyAsSuperadmin(cmd);

  try {
    const result = await client.getPolicy(id, options.tenant, { asSuperadmin });
    spinner.stop();

    if (options.json) {
      output.json(result);
      return;
    }

    output.section('Policy Details');
    output.keyValue({
      'ID': result.id,
      'Name': result.name,
      'Description': result.description ?? '-',
      'Effect': result.effect.toUpperCase(),
      'Priority': result.priority.toString(),
      'Status': formatActiveStatus(result.isActive),
      'Tenant': result.tenantId ?? 'Global',
      'Created': output.formatDate(result.createdAt),
      'Updated': output.formatDate(result.updatedAt),
    });

    console.log();
    output.section('Actions');
    for (const action of result.actions) {
      console.log(`  - ${action}`);
    }

    if (result.resources && result.resources.length > 0) {
      console.log();
      output.section('Resources');
      for (const resource of result.resources) {
        const parts = [`type: ${resource.type}`];
        if (resource.id) parts.push(`id: ${resource.id}`);
        if (resource.tenantId) parts.push(`tenant: ${resource.tenantId}`);
        if (resource.tags) parts.push(`tags: ${JSON.stringify(resource.tags)}`);
        console.log(`  - ${parts.join(', ')}`);
      }
    }

    if (result.conditions && result.conditions.length > 0) {
      console.log();
      output.section('Conditions');
      for (const condition of result.conditions) {
        const op = condition.operator ? ` ${condition.operator}` : '';
        console.log(`  - ${condition.type}${op}: ${JSON.stringify(condition.value)}`);
      }
    }

    console.log();
  } catch (err) {
    spinner.fail('Failed to get policy');
    output.fatal(output.getErrorMessage(err));
  }
}
