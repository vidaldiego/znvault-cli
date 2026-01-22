// Path: src/commands/policy/attachments.ts

/**
 * Policy attachment commands
 */

import ora from 'ora';
import { client } from '../../lib/client.js';
import * as output from '../../lib/output.js';
import type {
  PolicyAttachmentsOptions,
  PolicyAttachOptions,
  PolicyUserPoliciesOptions,
  PolicyRolePoliciesOptions,
} from './types.js';

export async function showAttachments(id: string, options: PolicyAttachmentsOptions): Promise<void> {
  const spinner = ora('Fetching attachments...').start();

  try {
    const result = await client.getPolicyAttachments(id);
    spinner.stop();

    if (options.json) {
      output.json(result);
      return;
    }

    if (result.users.length === 0 && result.roles.length === 0) {
      output.info('No attachments found for this policy');
      return;
    }

    if (result.users.length > 0) {
      output.section('Attached Users');
      output.table(
        ['User ID', 'Username', 'Attached At'],
        result.users.map(a => [
          a.userId?.substring(0, 8) ?? '-',
          a.username ?? '-',
          output.formatDate(a.attachedAt),
        ])
      );
    }

    if (result.roles.length > 0) {
      console.log();
      output.section('Attached Roles');
      output.table(
        ['Role ID', 'Role Name', 'Attached At'],
        result.roles.map(a => [
          a.roleId?.substring(0, 8) ?? '-',
          a.roleName ?? '-',
          output.formatDate(a.attachedAt),
        ])
      );
    }
  } catch (err) {
    spinner.fail('Failed to get attachments');
    output.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}

export async function attachPolicyToUser(policyId: string, userId: string, options: PolicyAttachOptions): Promise<void> {
  const spinner = ora('Attaching policy to user...').start();

  try {
    await client.attachPolicyToUser(policyId, userId);
    spinner.succeed('Policy attached to user successfully');

    if (options.json) {
      output.json({ success: true, policyId, userId, message: 'Policy attached to user successfully' });
    }
  } catch (err) {
    spinner.fail('Failed to attach policy');
    output.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}

export async function attachPolicyToRole(policyId: string, roleId: string, options: PolicyAttachOptions): Promise<void> {
  const spinner = ora('Attaching policy to role...').start();

  try {
    await client.attachPolicyToRole(policyId, roleId);
    spinner.succeed('Policy attached to role successfully');

    if (options.json) {
      output.json({ success: true, policyId, roleId, message: 'Policy attached to role successfully' });
    }
  } catch (err) {
    spinner.fail('Failed to attach policy');
    output.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}

export async function detachPolicyFromUser(policyId: string, userId: string, options: PolicyAttachOptions): Promise<void> {
  const spinner = ora('Detaching policy from user...').start();

  try {
    await client.detachPolicyFromUser(policyId, userId);
    spinner.succeed('Policy detached from user successfully');

    if (options.json) {
      output.json({ success: true, policyId, userId, message: 'Policy detached from user successfully' });
    }
  } catch (err) {
    spinner.fail('Failed to detach policy');
    output.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}

export async function detachPolicyFromRole(policyId: string, roleId: string, options: PolicyAttachOptions): Promise<void> {
  const spinner = ora('Detaching policy from role...').start();

  try {
    await client.detachPolicyFromRole(policyId, roleId);
    spinner.succeed('Policy detached from role successfully');

    if (options.json) {
      output.json({ success: true, policyId, roleId, message: 'Policy detached from role successfully' });
    }
  } catch (err) {
    spinner.fail('Failed to detach policy');
    output.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}

export async function listUserPolicies(userId: string, options: PolicyUserPoliciesOptions): Promise<void> {
  const spinner = ora('Fetching user policies...').start();

  try {
    const policies = await client.getUserPolicies(userId);
    spinner.stop();

    if (options.json) {
      output.json(policies);
      return;
    }

    if (policies.length === 0) {
      output.info('No policies attached to this user');
      return;
    }

    output.table(
      ['ID', 'Name', 'Effect', 'Priority', 'Status'],
      policies.map(p => [
        p.id.substring(0, 8),
        p.name,
        p.effect.toUpperCase(),
        p.priority.toString(),
        p.isActive ? 'Enabled' : 'Disabled',
      ])
    );

    output.info(`Total: ${policies.length} policy(s)`);
  } catch (err) {
    spinner.fail('Failed to get user policies');
    output.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}

export async function listRolePolicies(roleId: string, options: PolicyRolePoliciesOptions): Promise<void> {
  const spinner = ora('Fetching role policies...').start();

  try {
    const policies = await client.getRolePolicies(roleId);
    spinner.stop();

    if (options.json) {
      output.json(policies);
      return;
    }

    if (policies.length === 0) {
      output.info('No policies attached to this role');
      return;
    }

    output.table(
      ['ID', 'Name', 'Effect', 'Priority', 'Status'],
      policies.map(p => [
        p.id.substring(0, 8),
        p.name,
        p.effect.toUpperCase(),
        p.priority.toString(),
        p.isActive ? 'Enabled' : 'Disabled',
      ])
    );

    output.info(`Total: ${policies.length} policy(s)`);
  } catch (err) {
    spinner.fail('Failed to get role policies');
    output.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}
