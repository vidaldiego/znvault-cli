// Path: src/commands/agent/remote/reprovision/create.ts

/**
 * Reprovision create command - generate a one-time reprovision token
 */

import type { Command } from 'commander';

import * as mode from '../../../../lib/mode.js';
import * as output from '../../../../lib/output.js';
import type { ReprovisionOptions, ReprovisionResponse } from '../../types.js';

export function registerReprovisionCreateCommand(parentCmd: Command): void {
  parentCmd
    .command('create <agent-id>')
    .description('Generate a one-time token to reprovision an agent with new credentials')
    .option('-r, --reason <reason>', 'Reason for reprovisioning (for audit trail)')
    .option('-e, --expires-in <duration>', 'Token expiration (default: 15m)', '15m')
    .action(async (agentId: string, options: ReprovisionOptions) => {
      const spinner = output.spinner('Generating reprovision token...').start();

      try {
        const response = await mode.apiPost<ReprovisionResponse>(
          `/v1/agents/${encodeURIComponent(agentId)}/reprovision`,
          {
            reason: options.reason,
            expiresIn: options.expiresIn,
          }
        );

        spinner.succeed('Reprovision token generated');
        console.log();
        console.log('╔══════════════════════════════════════════════════════════════════╗');
        console.log('║  ONE-TIME REPROVISION TOKEN - SAVE THIS NOW!                    ║');
        console.log('╚══════════════════════════════════════════════════════════════════╝');
        console.log();
        console.log(`  Token: ${response.token}`);
        console.log();
        console.log('Details:');
        console.log(`  Agent ID:    ${response.agentId}`);
        console.log(`  Tenant:      ${response.tenantId}`);
        console.log(`  Expires:     ${new Date(response.expiresAt).toLocaleString()}`);
        if (response.reason) {
          console.log(`  Reason:      ${response.reason}`);
        }
        console.log();
        console.log('To reprovision the agent, provide this token to the agent:');
        console.log();
        console.log('  1. On the agent machine, run:');
        console.log(`     zn-vault-agent reprovision --token "${response.token}"`);
        console.log();
        console.log('  2. Or set the environment variable:');
        console.log(`     ZNVAULT_REPROVISION_TOKEN="${response.token}" zn-vault-agent start`);
        console.log();
        console.log('The token can only be used once and expires in 15 minutes.');
      } catch (err) {
        spinner.fail('Failed to generate reprovision token');
        output.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
      } finally {
        await mode.closeLocalClient();
      }
    });
}
