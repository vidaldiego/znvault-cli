// Path: znvault-cli/src/commands/policy.ts

import { Command } from 'commander';
import ora from 'ora';
import * as fs from 'fs';
import { client } from '../lib/client.js';
import { promptConfirm } from '../lib/prompts.js';
import * as output from '../lib/output.js';
import type { CreatePolicyInput, UpdatePolicyInput, PolicyEffect } from '../types/index.js';

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
    .action(async (options) => {
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
          output.json(result.data);
          return;
        }

        if (result.data.length === 0) {
          output.info('No policies found');
          return;
        }

        output.table(
          ['ID', 'Name', 'Effect', 'Priority', 'Actions', 'Status', 'Tenant'],
          result.data.map(p => [
            p.id.substring(0, 8),
            p.name.length > 25 ? p.name.substring(0, 22) + '...' : p.name,
            p.effect.toUpperCase(),
            p.priority.toString(),
            p.actions.length > 2 ? `${p.actions.slice(0, 2).join(', ')}...` : p.actions.join(', '),
            p.isActive ? 'Enabled' : 'Disabled',
            p.tenantId || '-',
          ])
        );

        output.info(`Total: ${result.total} policy(s)`);
      } catch (err) {
        spinner.fail('Failed to list policies');
        output.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    });

  // ============ Get Policy ============
  policy
    .command('get <id>')
    .description('Get policy details')
    .option('--json', 'Output as JSON')
    .action(async (id, options) => {
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
          'Description': result.description || '-',
          'Effect': result.effect.toUpperCase(),
          'Priority': result.priority.toString(),
          'Status': result.isActive ? 'Enabled' : 'Disabled',
          'Tenant': result.tenantId || 'Global',
          'Created': output.formatDate(result.createdAt),
          'Updated': output.formatDate(result.updatedAt),
        });

        console.log();
        output.section('Actions');
        for (const action of result.actions) {
          console.log(`  • ${action}`);
        }

        if (result.resources && result.resources.length > 0) {
          console.log();
          output.section('Resources');
          for (const resource of result.resources) {
            const parts = [`type: ${resource.type}`];
            if (resource.id) parts.push(`id: ${resource.id}`);
            if (resource.tenantId) parts.push(`tenant: ${resource.tenantId}`);
            if (resource.tags) parts.push(`tags: ${JSON.stringify(resource.tags)}`);
            console.log(`  • ${parts.join(', ')}`);
          }
        }

        if (result.conditions && result.conditions.length > 0) {
          console.log();
          output.section('Conditions');
          for (const condition of result.conditions) {
            const op = condition.operator ? ` ${condition.operator}` : '';
            console.log(`  • ${condition.type}${op}: ${JSON.stringify(condition.value)}`);
          }
        }

        console.log();
      } catch (err) {
        spinner.fail('Failed to get policy');
        output.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    });

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
    .action(async (options) => {
      try {
        let policyData: CreatePolicyInput;

        if (options.fromFile) {
          // Load from file
          const content = fs.readFileSync(options.fromFile, 'utf-8');
          policyData = JSON.parse(content) as CreatePolicyInput;
        } else {
          // Build from options
          policyData = {
            name: options.name,
            description: options.description,
            effect: options.effect as PolicyEffect,
            actions: options.actions.split(',').map((a: string) => a.trim()),
            priority: parseInt(options.priority, 10),
            tenantId: options.tenant,
          };

          if (options.resources) {
            policyData.resources = JSON.parse(options.resources);
          }
          if (options.conditions) {
            policyData.conditions = JSON.parse(options.conditions);
          }
        }

        const spinner = ora('Creating policy...').start();

        const result = await client.createPolicy(policyData);
        spinner.succeed('Policy created successfully');

        if (options.json) {
          output.json(result);
        } else {
          output.keyValue({
            'ID': result.id,
            'Name': result.name,
            'Effect': result.effect.toUpperCase(),
            'Priority': result.priority.toString(),
            'Status': result.isActive ? 'Enabled' : 'Disabled',
          });
        }
      } catch (err) {
        output.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    });

  // ============ Update Policy ============
  policy
    .command('update <id>')
    .description('Update an ABAC policy')
    .option('--name <name>', 'New policy name')
    .option('--description <desc>', 'New description')
    .option('--effect <effect>', 'New effect (allow|deny)')
    .option('--actions <actions>', 'New comma-separated list of actions')
    .option('--priority <num>', 'New priority')
    .option('--resources <json>', 'New resources JSON array')
    .option('--conditions <json>', 'New conditions JSON array')
    .option('--from-file <path>', 'Load updates from JSON file')
    .option('--json', 'Output as JSON')
    .action(async (id, options) => {
      try {
        let updates: UpdatePolicyInput;

        if (options.fromFile) {
          const content = fs.readFileSync(options.fromFile, 'utf-8');
          updates = JSON.parse(content) as UpdatePolicyInput;
        } else {
          updates = {};
          if (options.name) updates.name = options.name;
          if (options.description) updates.description = options.description;
          if (options.effect) updates.effect = options.effect as PolicyEffect;
          if (options.actions) updates.actions = options.actions.split(',').map((a: string) => a.trim());
          if (options.priority) updates.priority = parseInt(options.priority, 10);
          if (options.resources) updates.resources = JSON.parse(options.resources);
          if (options.conditions) updates.conditions = JSON.parse(options.conditions);
        }

        if (Object.keys(updates).length === 0) {
          output.error('No updates specified');
          process.exit(1);
        }

        const spinner = ora('Updating policy...').start();

        const result = await client.updatePolicy(id, updates);
        spinner.succeed('Policy updated successfully');

        if (options.json) {
          output.json(result);
        } else {
          output.keyValue({
            'ID': result.id,
            'Name': result.name,
            'Effect': result.effect.toUpperCase(),
            'Updated': output.formatDate(result.updatedAt),
          });
        }
      } catch (err) {
        output.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    });

  // ============ Delete Policy ============
  policy
    .command('delete <id>')
    .description('Delete an ABAC policy')
    .option('-y, --yes', 'Skip confirmation')
    .action(async (id, options) => {
      try {
        if (!options.yes) {
          const confirmed = await promptConfirm(
            `Are you sure you want to delete policy '${id}'? This cannot be undone.`
          );
          if (!confirmed) {
            output.info('Delete cancelled');
            return;
          }
        }

        const spinner = ora('Deleting policy...').start();
        await client.deletePolicy(id);
        spinner.succeed(`Policy '${id}' deleted successfully`);
      } catch (err) {
        output.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    });

  // ============ Enable Policy ============
  policy
    .command('enable <id>')
    .description('Enable an ABAC policy')
    .action(async (id) => {
      const spinner = ora('Enabling policy...').start();

      try {
        const result = await client.togglePolicy(id, true);
        spinner.succeed('Policy enabled successfully');
        output.keyValue({
          'ID': result.id,
          'Name': result.name,
          'Status': 'Enabled',
        });
      } catch (err) {
        spinner.fail('Failed to enable policy');
        output.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    });

  // ============ Disable Policy ============
  policy
    .command('disable <id>')
    .description('Disable an ABAC policy')
    .action(async (id) => {
      const spinner = ora('Disabling policy...').start();

      try {
        const result = await client.togglePolicy(id, false);
        spinner.succeed('Policy disabled successfully');
        output.keyValue({
          'ID': result.id,
          'Name': result.name,
          'Status': 'Disabled',
        });
      } catch (err) {
        spinner.fail('Failed to disable policy');
        output.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    });

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
    .action(async (options) => {
      try {
        let policyData: CreatePolicyInput;

        if (options.fromFile) {
          const content = fs.readFileSync(options.fromFile, 'utf-8');
          policyData = JSON.parse(content) as CreatePolicyInput;
        } else {
          policyData = {
            name: options.name,
            description: options.description,
            effect: options.effect as PolicyEffect,
            actions: options.actions.split(',').map((a: string) => a.trim()),
            priority: parseInt(options.priority, 10),
          };

          if (options.resources) {
            policyData.resources = JSON.parse(options.resources);
          }
          if (options.conditions) {
            policyData.conditions = JSON.parse(options.conditions);
          }
        }

        const spinner = ora('Validating policy...').start();

        const result = await client.validatePolicy(policyData);

        if (result.valid) {
          spinner.succeed('Policy is valid');
        } else {
          spinner.fail('Policy validation failed');
          if (result.errors) {
            for (const error of result.errors) {
              output.error(`  • ${error}`);
            }
          }
          process.exit(1);
        }
      } catch (err) {
        output.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    });

  // ============ Show Policy Attachments ============
  policy
    .command('attachments <id>')
    .description('Show users and roles attached to a policy')
    .option('--json', 'Output as JSON')
    .action(async (id, options) => {
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
              a.userId?.substring(0, 8) || '-',
              a.username || '-',
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
              a.roleId?.substring(0, 8) || '-',
              a.roleName || '-',
              output.formatDate(a.attachedAt),
            ])
          );
        }
      } catch (err) {
        spinner.fail('Failed to get attachments');
        output.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    });

  // ============ Attach Policy to User ============
  policy
    .command('attach-user <policyId> <userId>')
    .description('Attach a policy to a user')
    .action(async (policyId, userId) => {
      const spinner = ora('Attaching policy to user...').start();

      try {
        await client.attachPolicyToUser(policyId, userId);
        spinner.succeed('Policy attached to user successfully');
      } catch (err) {
        spinner.fail('Failed to attach policy');
        output.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    });

  // ============ Attach Policy to Role ============
  policy
    .command('attach-role <policyId> <roleId>')
    .description('Attach a policy to a role')
    .action(async (policyId, roleId) => {
      const spinner = ora('Attaching policy to role...').start();

      try {
        await client.attachPolicyToRole(policyId, roleId);
        spinner.succeed('Policy attached to role successfully');
      } catch (err) {
        spinner.fail('Failed to attach policy');
        output.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    });

  // ============ Detach Policy from User ============
  policy
    .command('detach-user <policyId> <userId>')
    .description('Detach a policy from a user')
    .action(async (policyId, userId) => {
      const spinner = ora('Detaching policy from user...').start();

      try {
        await client.detachPolicyFromUser(policyId, userId);
        spinner.succeed('Policy detached from user successfully');
      } catch (err) {
        spinner.fail('Failed to detach policy');
        output.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    });

  // ============ Detach Policy from Role ============
  policy
    .command('detach-role <policyId> <roleId>')
    .description('Detach a policy from a role')
    .action(async (policyId, roleId) => {
      const spinner = ora('Detaching policy from role...').start();

      try {
        await client.detachPolicyFromRole(policyId, roleId);
        spinner.succeed('Policy detached from role successfully');
      } catch (err) {
        spinner.fail('Failed to detach policy');
        output.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    });

  // ============ List User's Policies ============
  policy
    .command('user-policies <userId>')
    .description('List policies attached to a user (directly or via roles)')
    .option('--json', 'Output as JSON')
    .action(async (userId, options) => {
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
    });

  // ============ List Role's Policies ============
  policy
    .command('role-policies <roleId>')
    .description('List policies attached to a role')
    .option('--json', 'Output as JSON')
    .action(async (roleId, options) => {
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
    });

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
    .action(async (options) => {
      const spinner = ora('Testing policy evaluation...').start();

      try {
        const request = {
          userId: options.user,
          action: options.action,
          resource: options.resourceType ? {
            type: options.resourceType,
            id: options.resourceId,
            tenantId: options.resourceTenant,
          } : undefined,
          requestContext: (options.ip || options.mfa) ? {
            ip: options.ip,
            mfaVerified: options.mfa || false,
          } : undefined,
        };

        const result = await client.testPolicy(request);
        spinner.stop();

        if (options.json) {
          output.json(result);
          return;
        }

        // Display result with color
        const statusIcon = result.allowed ? '✓' : '✗';
        const statusText = result.allowed ? 'ALLOWED' : 'DENIED';
        console.log();
        console.log(`  ${statusIcon} Access: ${statusText}`);
        console.log(`    Effect: ${result.effect.toUpperCase()}`);
        console.log(`    Reason: ${result.reason}`);
        console.log();

        output.keyValue({
          'Policies Evaluated': result.evaluatedPolicies.toString(),
          'Policies Matched': result.matchedPolicies.length.toString(),
          'Evaluation Time': `${result.evaluationTimeMs}ms`,
        });

        if (result.matchedPolicies.length > 0) {
          console.log();
          output.section('Matched Policies');
          output.table(
            ['Name', 'Effect', 'Priority'],
            result.matchedPolicies.map(p => [
              p.name,
              p.effect.toUpperCase(),
              p.priority.toString(),
            ])
          );
        }
      } catch (err) {
        spinner.fail('Failed to test policy');
        output.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    });

  // ============ Export Policy ============
  policy
    .command('export <id>')
    .description('Export a policy as JSON')
    .option('-o, --output <path>', 'Output file path')
    .action(async (id, options) => {
      const spinner = ora('Exporting policy...').start();

      try {
        const result = await client.getPolicy(id);
        spinner.stop();

        const exportData = {
          name: result.name,
          description: result.description,
          effect: result.effect,
          actions: result.actions,
          resources: result.resources,
          conditions: result.conditions,
          priority: result.priority,
        };

        const jsonString = JSON.stringify(exportData, null, 2);

        if (options.output) {
          fs.writeFileSync(options.output, jsonString);
          output.success(`Policy exported to ${options.output}`);
        } else {
          console.log(jsonString);
        }
      } catch (err) {
        spinner.fail('Failed to export policy');
        output.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    });

  // ============ Import Policy ============
  policy
    .command('import <path>')
    .description('Import a policy from JSON file')
    .option('--tenant <id>', 'Override tenant ID')
    .option('--json', 'Output as JSON')
    .action(async (path, options) => {
      try {
        const content = fs.readFileSync(path, 'utf-8');
        const policyData = JSON.parse(content) as CreatePolicyInput;

        if (options.tenant) {
          policyData.tenantId = options.tenant;
        }

        const spinner = ora('Importing policy...').start();

        const result = await client.createPolicy(policyData);
        spinner.succeed('Policy imported successfully');

        if (options.json) {
          output.json(result);
        } else {
          output.keyValue({
            'ID': result.id,
            'Name': result.name,
            'Effect': result.effect.toUpperCase(),
            'Status': result.isActive ? 'Enabled' : 'Disabled',
          });
        }
      } catch (err) {
        output.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    });
}
