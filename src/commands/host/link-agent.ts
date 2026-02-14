// Path: src/commands/host/link-agent.ts
// Link/unlink agents to host configurations

import type { Command } from 'commander';

import * as mode from '../../lib/mode.js';
import * as output from '../../lib/output.js';

/**
 * Command options for link-agent
 */
export interface LinkAgentOptions {
  agent?: string;
  agentId?: string;
  json?: boolean;
}

/**
 * Command options for unlink-agent
 */
export interface UnlinkAgentOptions {
  agent?: string;
  agentId?: string;
  json?: boolean;
}

/**
 * Link agent response
 */
interface LinkAgentResponse {
  success: boolean;
  agentId: string;
  agentHostname: string;
  hostConfigId: string;
  hostConfigName: string;
}

/**
 * Unlink agent response
 */
interface UnlinkAgentResponse {
  success: boolean;
  agentId: string;
  agentHostname: string;
}

/**
 * Register the link-agent command
 */
export function registerLinkAgentCommand(parentCmd: Command): void {
  parentCmd
    .command('link-agent <hostname>')
    .description('Link an agent to a host configuration')
    .option('-a, --agent <hostname>', 'Agent hostname to link')
    .option('-i, --agent-id <id>', 'Agent ID to link (e.g., agent_abc123)')
    .option('--json', 'Output as JSON')
    .action(async (hostname: string, options: LinkAgentOptions) => {
      // Validate options
      if (!options.agent && !options.agentId) {
        output.error('Either --agent <hostname> or --agent-id <id> is required');
        console.log('\nExamples:');
        console.log('  znvault host link-agent payara-staging --agent payara-staging-1');
        console.log('  znvault host link-agent payara-staging --agent-id agent_e8ca2d55b0cf');
        process.exit(1);
      }

      const spinner = output.spinner('Linking agent to host config...').start();

      try {
        const body: Record<string, string> = {};
        if (options.agentId) {
          body.agentId = options.agentId;
        } else if (options.agent) {
          body.agentHostname = options.agent;
        }

        const response = await mode.apiPost<LinkAgentResponse>(
          `/v1/hosts/${encodeURIComponent(hostname)}/link-agent`,
          body
        );

        spinner.succeed('Agent linked successfully');

        if (options.json) {
          output.json(response);
          return;
        }

        console.log();
        output.keyValue({
          'Agent ID': response.agentId,
          'Agent Hostname': response.agentHostname,
          'Host Config': response.hostConfigName,
          'Host Config ID': response.hostConfigId,
        });
        console.log();
        output.success(`Agent "${response.agentHostname}" is now linked to host config "${hostname}"`);
      } catch (err) {
        spinner.fail('Failed to link agent');
        output.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
      } finally {
        await mode.closeLocalClient();
      }
    });
}

/**
 * Register the unlink-agent command
 */
export function registerUnlinkAgentCommand(parentCmd: Command): void {
  parentCmd
    .command('unlink-agent <hostname>')
    .description('Unlink an agent from a host configuration')
    .option('-a, --agent <hostname>', 'Agent hostname to unlink')
    .option('-i, --agent-id <id>', 'Agent ID to unlink (e.g., agent_abc123)')
    .option('--json', 'Output as JSON')
    .action(async (hostname: string, options: UnlinkAgentOptions) => {
      // Validate options
      if (!options.agent && !options.agentId) {
        output.error('Either --agent <hostname> or --agent-id <id> is required');
        process.exit(1);
      }

      const spinner = output.spinner('Unlinking agent from host config...').start();

      try {
        // Build query params
        const params = new URLSearchParams();
        if (options.agentId) {
          params.set('agentId', options.agentId);
        } else if (options.agent) {
          params.set('agentHostname', options.agent);
        }

        const response = await mode.apiDelete<UnlinkAgentResponse>(
          `/v1/hosts/${encodeURIComponent(hostname)}/link-agent?${params.toString()}`
        );

        spinner.succeed('Agent unlinked successfully');

        if (options.json) {
          output.json(response);
          return;
        }

        console.log();
        output.keyValue({
          'Agent ID': response.agentId,
          'Agent Hostname': response.agentHostname,
        });
        console.log();
        output.success(`Agent "${response.agentHostname}" has been unlinked from host config "${hostname}"`);
      } catch (err) {
        spinner.fail('Failed to unlink agent');
        output.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
      } finally {
        await mode.closeLocalClient();
      }
    });
}
