// Path: src/commands/policy/list.ts

/**
 * Policy list and get commands
 */

import ora from 'ora';
import { client } from '../../lib/client.js';
import * as output from '../../lib/output.js';
import type { PolicyListOptions, PolicyGetOptions } from './types.js';

export async function listPolicies(options: PolicyListOptions): Promise<void> {
  const spinner = ora('Fetching policies...').start();

  try {
    const result = await client.listPolicies({
      tenantId: options.tenant,
      enabled: options.enabled ? true : options.disabled ? false : undefined,
      effect: options.effect as 'allow' | 'deny' | undefined,
      search: options.search,
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
        p.id.substring(0, 8),
        p.name.length > 25 ? p.name.substring(0, 22) + '...' : p.name,
        p.effect.toUpperCase(),
        p.priority.toString(),
        p.actions.length > 2 ? `${p.actions.slice(0, 2).join(', ')}...` : p.actions.join(', '),
        p.isActive ? 'Enabled' : 'Disabled',
        p.tenantId ?? '-',
      ])
    );

    output.info(`Total: ${result.pagination.total} policy(s)${result.pagination.hasMore ? ' (more available)' : ''}`);
  } catch (err) {
    spinner.fail('Failed to list policies');
    output.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}

export async function getPolicy(id: string, options: PolicyGetOptions): Promise<void> {
  const spinner = ora('Fetching policy...').start();

  try {
    const result = await client.getPolicy(id);
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
      'Status': result.isActive ? 'Enabled' : 'Disabled',
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
    output.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}
