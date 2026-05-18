// Path: src/commands/policy/index.ts

/**
 * Policy command registration
 */

import { type Command } from 'commander';
import { listPolicies, getPolicy } from './list.js';
import { createPolicy, updatePolicy, deletePolicy, enablePolicy, disablePolicy, validatePolicy } from './crud.js';
import {
  showAttachments,
  attachPolicyToUser,
  attachPolicyToRole,
  detachPolicyFromUser,
  detachPolicyFromRole,
  listUserPolicies,
  listRolePolicies,
} from './attachments.js';
import { testPolicy } from './test.js';
import { exportPolicy, importPolicy } from './io.js';
import {
  resolveContext,
  withRegisterContext,
  type RegisterOptions,
} from '../../lib/command-context.js';

// Re-export types
export * from './types.js';

export function registerPolicyCommands(parent: Command, opts?: RegisterOptions): void {
  const ctx = resolveContext(opts);
  withRegisterContext(ctx, () => registerPolicyCommandsInner(parent, ctx));
}

function registerPolicyCommandsInner(parent: Command, ctx: 'tenant' | 'superadmin'): void {
  const policy = parent
    .command('policy')
    .description('ABAC policy management commands');

  // Helper: only register --tenant in superadmin context
  const t = (cmd: Command, desc: string, shortFlag = false): Command =>
    ctx === 'superadmin'
      ? cmd.option(shortFlag ? '-t, --tenant <id>' : '--tenant <id>', desc)
      : cmd;

  // ============ List Policies ============
  {
    const listCmd = policy
      .command('list')
      .description('List ABAC policies');
    t(listCmd, 'Filter by tenant ID');
    listCmd
      .option('--enabled', 'Show only enabled policies')
      .option('--disabled', 'Show only disabled policies')
      .option('--effect <effect>', 'Filter by effect (allow|deny)')
      .option('--search <term>', 'Search by name or description')
      .option('--json', 'Output as JSON')
      .action(listPolicies);
  }

  // ============ Get Policy ============
  {
    const getCmd = policy
      .command('get <id>')
      .description('Get policy details');
    t(getCmd, 'Tenant ID (superadmin only — routes via /v1/superadmin/policies)', true);
    getCmd
      .option('--json', 'Output as JSON')
      .action(getPolicy);
  }

  // ============ Create Policy ============
  {
    const createCmd = policy
      .command('create')
      .description('Create a new ABAC policy')
      .requiredOption('--name <name>', 'Policy name')
      .requiredOption('--effect <effect>', 'Policy effect (allow|deny)')
      .requiredOption('--actions <actions>', 'Comma-separated list of actions (e.g., secret:read:value,secret:update)')
      .option('--description <desc>', 'Policy description')
      .option('--priority <num>', 'Priority (higher = evaluated first)', '0');
    t(createCmd, 'Tenant ID (omit for global policy)');
    createCmd
      .option('--resources <json>', 'Resources JSON array')
      .option('--conditions <json>', 'Conditions JSON array')
      .option('--from-file <path>', 'Load policy definition from JSON file')
      .option('--json', 'Output as JSON')
      .action(createPolicy);
  }

  // ============ Update Policy ============
  {
    const updateCmd = policy
      .command('update <id>')
      .description('Update an ABAC policy');
    t(updateCmd, 'Tenant ID (superadmin only — routes via /v1/superadmin/policies)', true);
    updateCmd
      .option('--name <name>', 'New policy name')
      .option('--description <desc>', 'New description')
      .option('--effect <effect>', 'New effect (allow|deny)')
      .option('--actions <actions>', 'New comma-separated list of actions')
      .option('--priority <num>', 'New priority')
      .option('--resources <json>', 'New resources JSON array')
      .option('--conditions <json>', 'New conditions JSON array')
      .option('--from-file <path>', 'Load updates from JSON file')
      .option('--json', 'Output as JSON')
      .action(updatePolicy);
  }

  // ============ Delete Policy ============
  {
    const deleteCmd = policy
      .command('delete <id>')
      .description('Delete an ABAC policy');
    t(deleteCmd, 'Tenant ID (superadmin only — routes via /v1/superadmin/policies)', true);
    deleteCmd
      .option('-y, --yes', 'Skip confirmation')
      .option('--json', 'Output as JSON')
      .action(deletePolicy);
  }

  // ============ Enable Policy ============
  {
    const enableCmd = policy
      .command('enable <id>')
      .description('Enable an ABAC policy');
    t(enableCmd, 'Tenant ID (superadmin only — routes via /v1/superadmin/policies)', true);
    enableCmd
      .option('--json', 'Output as JSON')
      .action(enablePolicy);
  }

  // ============ Disable Policy ============
  {
    const disableCmd = policy
      .command('disable <id>')
      .description('Disable an ABAC policy');
    t(disableCmd, 'Tenant ID (superadmin only — routes via /v1/superadmin/policies)', true);
    disableCmd
      .option('--json', 'Output as JSON')
      .action(disablePolicy);
  }

  // ============ Validate Policy ============
  policy
    .command('validate')
    .description('Validate a policy definition without creating it')
    .requiredOption('--name <name>', 'Policy name')
    .requiredOption('--effect <effect>', 'Policy effect (allow|deny)')
    .requiredOption('--actions <actions>', 'Comma-separated list of actions')
    .option('--description <desc>', 'Policy description')
    .option('--priority <num>', 'Priority', '0')
    .option('--resources <json>', 'Resources JSON array')
    .option('--conditions <json>', 'Conditions JSON array')
    .option('--from-file <path>', 'Load policy from JSON file')
    .action(validatePolicy);

  // ============ Show Policy Attachments ============
  {
    const attCmd = policy
      .command('attachments <id>')
      .description('Show users and roles attached to a policy');
    t(attCmd, 'Tenant ID (superadmin only — routes via /v1/superadmin/policies)', true);
    attCmd
      .option('--json', 'Output as JSON')
      .action(showAttachments);
  }

  // ============ Attach Policy to User ============
  {
    const cmd = policy
      .command('attach-user <policyId> <userId>')
      .description('Attach a policy to a user');
    t(cmd, 'Tenant ID (superadmin only — routes via /v1/superadmin/policies)', true);
    cmd
      .option('--json', 'Output as JSON')
      .action(attachPolicyToUser);
  }

  // ============ Attach Policy to Role ============
  {
    const cmd = policy
      .command('attach-role <policyId> <roleId>')
      .description('Attach a policy to a role');
    t(cmd, 'Tenant ID (superadmin only — routes via /v1/superadmin/policies)', true);
    cmd
      .option('--json', 'Output as JSON')
      .action(attachPolicyToRole);
  }

  // ============ Detach Policy from User ============
  {
    const cmd = policy
      .command('detach-user <policyId> <userId>')
      .description('Detach a policy from a user');
    t(cmd, 'Tenant ID (superadmin only — routes via /v1/superadmin/policies)', true);
    cmd
      .option('--json', 'Output as JSON')
      .action(detachPolicyFromUser);
  }

  // ============ Detach Policy from Role ============
  {
    const cmd = policy
      .command('detach-role <policyId> <roleId>')
      .description('Detach a policy from a role');
    t(cmd, 'Tenant ID (superadmin only — routes via /v1/superadmin/policies)', true);
    cmd
      .option('--json', 'Output as JSON')
      .action(detachPolicyFromRole);
  }

  // ============ List User's Policies ============
  policy
    .command('user-policies <userId>')
    .description('List policies attached to a user (directly or via roles)')
    .option('--json', 'Output as JSON')
    .action(listUserPolicies);

  // ============ List Role's Policies ============
  policy
    .command('role-policies <roleId>')
    .description('List policies attached to a role')
    .option('--json', 'Output as JSON')
    .action(listRolePolicies);

  // ============ Test Policy Evaluation ============
  policy
    .command('test')
    .description('Test ABAC policy evaluation for a user and action')
    .requiredOption('--user <userId>', 'User ID to test')
    .requiredOption('--action <action>', 'Action to test (e.g., secret:read:value)')
    .option('--resource-type <type>', 'Resource type (secret|kms_key|certificate|...)')
    .option('--resource-id <id>', 'Resource ID')
    .option('--resource-tenant <id>', 'Resource tenant ID')
    .option('--ip <ip>', 'Simulated client IP address')
    .option('--mfa', 'Simulate MFA verified')
    .option('--json', 'Output as JSON')
    .action(testPolicy);

  // ============ Export Policy ============
  policy
    .command('export <id>')
    .description('Export a policy as JSON')
    .option('-o, --output <path>', 'Output file path')
    .action(exportPolicy);

  // ============ Import Policy ============
  {
    const importCmd = policy
      .command('import <path>')
      .description('Import a policy from JSON file');
    t(importCmd, 'Override tenant ID');
    importCmd
      .option('--json', 'Output as JSON')
      .action(importPolicy);
  }
}
