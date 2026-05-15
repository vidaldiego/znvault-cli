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

// Re-export types
export * from './types.js';

export function registerPolicyCommands(program: Command): void {
  const policy = program
    .command('policy')
    .description('ABAC policy management commands');

  // ============ List Policies ============
  policy
    .command('list')
    .description('List ABAC policies')
    .option('--tenant <id>', 'Filter by tenant ID (superadmin only)')
    .option('--enabled', 'Show only enabled policies')
    .option('--disabled', 'Show only disabled policies')
    .option('--effect <effect>', 'Filter by effect (allow|deny)')
    .option('--search <term>', 'Search by name or description')
    .option('--json', 'Output as JSON')
    .action(listPolicies);

  // ============ Get Policy ============
  policy
    .command('get <id>')
    .description('Get policy details')
    .option('-t, --tenant <id>', 'Tenant ID (superadmin only — routes via /v1/superadmin/policies)')
    .option('--json', 'Output as JSON')
    .action(getPolicy);

  // ============ Create Policy ============
  policy
    .command('create')
    .description('Create a new ABAC policy')
    .requiredOption('--name <name>', 'Policy name')
    .requiredOption('--effect <effect>', 'Policy effect (allow|deny)')
    .requiredOption('--actions <actions>', 'Comma-separated list of actions (e.g., secret:read:value,secret:update)')
    .option('--description <desc>', 'Policy description')
    .option('--priority <num>', 'Priority (higher = evaluated first)', '0')
    .option('--tenant <id>', 'Tenant ID (omit for global policy)')
    .option('--resources <json>', 'Resources JSON array')
    .option('--conditions <json>', 'Conditions JSON array')
    .option('--from-file <path>', 'Load policy definition from JSON file')
    .option('--json', 'Output as JSON')
    .action(createPolicy);

  // ============ Update Policy ============
  policy
    .command('update <id>')
    .description('Update an ABAC policy')
    .option('-t, --tenant <id>', 'Tenant ID (superadmin only — routes via /v1/superadmin/policies)')
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

  // ============ Delete Policy ============
  policy
    .command('delete <id>')
    .description('Delete an ABAC policy')
    .option('-t, --tenant <id>', 'Tenant ID (superadmin only — routes via /v1/superadmin/policies)')
    .option('-y, --yes', 'Skip confirmation')
    .option('--json', 'Output as JSON')
    .action(deletePolicy);

  // ============ Enable Policy ============
  policy
    .command('enable <id>')
    .description('Enable an ABAC policy')
    .option('-t, --tenant <id>', 'Tenant ID (superadmin only — routes via /v1/superadmin/policies)')
    .option('--json', 'Output as JSON')
    .action(enablePolicy);

  // ============ Disable Policy ============
  policy
    .command('disable <id>')
    .description('Disable an ABAC policy')
    .option('-t, --tenant <id>', 'Tenant ID (superadmin only — routes via /v1/superadmin/policies)')
    .option('--json', 'Output as JSON')
    .action(disablePolicy);

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
  policy
    .command('attachments <id>')
    .description('Show users and roles attached to a policy')
    .option('-t, --tenant <id>', 'Tenant ID (superadmin only — routes via /v1/superadmin/policies)')
    .option('--json', 'Output as JSON')
    .action(showAttachments);

  // ============ Attach Policy to User ============
  policy
    .command('attach-user <policyId> <userId>')
    .description('Attach a policy to a user')
    .option('-t, --tenant <id>', 'Tenant ID (superadmin only — routes via /v1/superadmin/policies)')
    .option('--json', 'Output as JSON')
    .action(attachPolicyToUser);

  // ============ Attach Policy to Role ============
  policy
    .command('attach-role <policyId> <roleId>')
    .description('Attach a policy to a role')
    .option('-t, --tenant <id>', 'Tenant ID (superadmin only — routes via /v1/superadmin/policies)')
    .option('--json', 'Output as JSON')
    .action(attachPolicyToRole);

  // ============ Detach Policy from User ============
  policy
    .command('detach-user <policyId> <userId>')
    .description('Detach a policy from a user')
    .option('-t, --tenant <id>', 'Tenant ID (superadmin only — routes via /v1/superadmin/policies)')
    .option('--json', 'Output as JSON')
    .action(detachPolicyFromUser);

  // ============ Detach Policy from Role ============
  policy
    .command('detach-role <policyId> <roleId>')
    .description('Detach a policy from a role')
    .option('-t, --tenant <id>', 'Tenant ID (superadmin only — routes via /v1/superadmin/policies)')
    .option('--json', 'Output as JSON')
    .action(detachPolicyFromRole);

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
  policy
    .command('import <path>')
    .description('Import a policy from JSON file')
    .option('--tenant <id>', 'Override tenant ID')
    .option('--json', 'Output as JSON')
    .action(importPolicy);
}
