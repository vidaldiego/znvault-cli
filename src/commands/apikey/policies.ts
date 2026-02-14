// Path: src/commands/apikey/policies.ts

/**
 * API key policy attachment commands
 */

import type { Command } from 'commander';

import Table from 'cli-table3';
import { client } from '../../lib/client.js';
import * as output from '../../lib/output.js';
import type { ListPoliciesOptions, AttachDetachPolicyOptions } from './types.js';
import { formatDate } from './helpers.js';

export function registerPolicyCommands(apiKeyCmd: Command): void {
  // List policies attached to an API key
  apiKeyCmd
    .command('list-policies <id>')
    .description('List ABAC policies attached to an API key')
    .option('-t, --tenant <id>', 'Tenant ID')
    .option('--json', 'Output as JSON')
    .action(async (id: string, options: ListPoliciesOptions) => {
      const spinner = output.spinner('Fetching policies...').start();

      try {
        const result = await client.getApiKeyPolicies(id, options.tenant);
        spinner.stop();

        if (options.json) {
          output.json(result);
          return;
        }

        if (result.policies.length === 0) {
          output.info('No ABAC policies attached to this API key');
          return;
        }

        const table = new Table({
          head: ['Policy ID', 'Policy Name', 'Attached At'],
          style: { head: ['cyan'] },
        });

        for (const policy of result.policies) {
          table.push([
            policy.policyId,
            policy.policyName,
            formatDate(policy.attachedAt),
          ]);
        }

        console.log(table.toString());
        console.log(`\nTotal: ${result.policies.length} policy/policies`);
      } catch (err) {
        spinner.fail('Failed to fetch policies');
        output.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    });

  // Attach policy to API key
  apiKeyCmd
    .command('attach-policy <keyId> <policyId>')
    .description('Attach an ABAC policy to an API key')
    .option('-t, --tenant <id>', 'Tenant ID')
    .action(async (keyId: string, policyId: string, options: AttachDetachPolicyOptions) => {
      const spinner = output.spinner('Attaching policy...').start();

      try {
        await client.attachApiKeyPolicy(keyId, policyId, options.tenant);
        spinner.succeed(`Policy ${policyId} attached to API key ${keyId}`);
      } catch (err) {
        spinner.fail('Failed to attach policy');
        output.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    });

  // Detach policy from API key
  apiKeyCmd
    .command('detach-policy <keyId> <policyId>')
    .description('Detach an ABAC policy from an API key')
    .option('-t, --tenant <id>', 'Tenant ID')
    .action(async (keyId: string, policyId: string, options: AttachDetachPolicyOptions) => {
      const spinner = output.spinner('Detaching policy...').start();

      try {
        await client.detachApiKeyPolicy(keyId, policyId, options.tenant);
        spinner.succeed(`Policy ${policyId} detached from API key ${keyId}`);
      } catch (err) {
        spinner.fail('Failed to detach policy');
        output.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    });
}
