// Path: src/commands/agent/direct/update-all.ts

/**
 * Agent update-all command - batch update all online agents
 */

import type { Command } from 'commander';

import * as mode from '../../../lib/mode.js';
import * as output from '../../../lib/output.js';
import { DEFAULT_AGENT_PORT } from '../../../lib/constants.js';
import type { UpdateAllOptions, AgentListResponse, RemoteAgent } from '../types.js';
import {
  confirmAction,
  fetchAgentVersion,
  fetchPluginVersions,
  triggerAgentUpdate,
  triggerPluginUpdate,
  waitForAgentRestart,
} from '../helpers.js';
import { withAgentConnection } from '../../../lib/ssh-tunnel.js';

interface AgentUpdateInfo {
  agent: RemoteAgent;
  ip: string;
  currentVersion: string;
  latestVersion: string;
  updateAvailable: boolean;
  autoUpdateEnabled?: boolean;
  pluginUpdates?: number;
}

export function registerUpdateAllCommand(parentCmd: Command): void {
  parentCmd
    .command('update-all')
    .description('Update all online agents')
    .option('--plugins', 'Update plugins instead of agent')
    .option('-t, --tenant <id>', 'Filter by tenant (superadmin only)')
    .option('--dry-run', 'Show what would be updated without making changes')
    .option('-y, --yes', 'Skip confirmation')
    .option('--json', 'Output as JSON')
    .option('--no-tunnel', 'Connect directly to each host instead of via an SSH-CA tunnel')
    .action(async (options: UpdateAllOptions) => {
      const spinner = output.spinner('Fetching online agents...').start();

      try {
        // Build query params
        const params = new URLSearchParams();
        params.set('status', 'online');
        params.set('pageSize', '100');
        if (options.tenant) params.set('tenantId', options.tenant);

        const response = await mode.apiGet<AgentListResponse>(`/v1/agents?${params.toString()}`);
        spinner.stop();

        if (response.agents.length === 0) {
          if (options.json) {
            output.json({ updated: 0, message: 'No online agents found' });
          } else {
            console.log('No online agents found');
          }
          return;
        }

        // Filter to agents with IP addresses and extract normalized IPs
        const reachableAgents = response.agents
          .filter((a): a is RemoteAgent & { lastIpAddress: string } => !!a.lastIpAddress)
          .map(a => ({
            agent: a,
            ip: a.lastIpAddress.replace(/^::ffff:/i, ''),
          }));

        if (reachableAgents.length === 0) {
          if (options.json) {
            output.json({ updated: 0, message: 'No agents with reachable IP addresses' });
          } else {
            console.log('No agents with reachable IP addresses');
          }
          return;
        }

        // Check versions for all agents
        const checkSpinner = output.spinner(`Checking ${reachableAgents.length} agent(s)...`).start();
        const agentInfo: AgentUpdateInfo[] = [];

        const useTunnel = options.tunnel !== false;
        for (const { agent, ip } of reachableAgents) {

          try {
            if (options.plugins) {
              // Check plugin versions (through an SSH-CA tunnel by default).
              const pluginInfo = await withAgentConnection(ip, DEFAULT_AGENT_PORT, { tunnel: useTunnel }, (h, p) =>
                fetchPluginVersions(h, p),
              );
              const updatesNeeded = pluginInfo.versions.filter(v => v.updateAvailable).length;
              agentInfo.push({
                agent,
                ip,
                currentVersion: agent.version || 'unknown',
                latestVersion: agent.version || 'unknown',
                updateAvailable: updatesNeeded > 0,
                pluginUpdates: updatesNeeded,
              });
            } else {
              // Check agent version (through an SSH-CA tunnel by default).
              const versionInfo = await withAgentConnection(ip, DEFAULT_AGENT_PORT, { tunnel: useTunnel }, (h, p) =>
                fetchAgentVersion(h, p),
              );
              agentInfo.push({
                agent,
                ip,
                currentVersion: versionInfo.current,
                latestVersion: versionInfo.latest,
                updateAvailable: versionInfo.updateAvailable,
                autoUpdateEnabled: versionInfo.autoUpdateEnabled,
              });
            }
          } catch {
            // Skip unreachable agents
            agentInfo.push({
              agent,
              ip,
              currentVersion: agent.version || 'unknown',
              latestVersion: 'unreachable',
              updateAvailable: false,
            });
          }
        }

        checkSpinner.stop();

        // Filter to agents that need updates
        const needsUpdate = agentInfo.filter(a => a.updateAvailable);

        if (needsUpdate.length === 0) {
          if (options.json) {
            output.json({
              updated: 0,
              checked: agentInfo.length,
              message: options.plugins ? 'All plugin versions up to date' : 'All agents up to date',
            });
          } else {
            console.log();
            console.log(`Checked ${agentInfo.length} agent(s)`);
            console.log(`\x1b[32m✓\x1b[0m ${options.plugins ? 'All plugin versions' : 'All agents'} up to date`);
          }
          return;
        }

        // Show summary
        if (!options.json) {
          console.log();
          console.log(`${needsUpdate.length} of ${agentInfo.length} agent(s) need updates:`);
          console.log();

          for (const info of needsUpdate) {
            if (options.plugins) {
              console.log(`  ${info.agent.hostname} (${info.ip}): ${info.pluginUpdates} plugin update(s)`);
            } else {
              const autoUpdate = info.autoUpdateEnabled ? '' : ' (auto-update disabled)';
              console.log(`  ${info.agent.hostname} (${info.ip}): ${info.currentVersion} → ${info.latestVersion}${autoUpdate}`);
            }
          }
          console.log();
        }

        // Dry run - just show what would be updated
        if (options.dryRun) {
          if (options.json) {
            output.json({
              dryRun: true,
              wouldUpdate: needsUpdate.map(a => ({
                hostname: a.agent.hostname,
                ip: a.ip,
                currentVersion: a.currentVersion,
                latestVersion: a.latestVersion,
                pluginUpdates: a.pluginUpdates,
              })),
            });
          } else {
            console.log('Dry run - no changes made');
          }
          return;
        }

        // Filter out agents with auto-update disabled (for agent updates only)
        const canUpdate = options.plugins
          ? needsUpdate
          : needsUpdate.filter(a => a.autoUpdateEnabled !== false);

        if (canUpdate.length === 0) {
          if (options.json) {
            output.json({ updated: 0, message: 'No agents eligible for update (auto-update disabled)' });
          } else {
            console.log('No agents eligible for update (auto-update disabled on all)');
          }
          return;
        }

        // Confirm
        if (!options.yes && !options.json) {
          const confirmed = await confirmAction(`Update ${canUpdate.length} agent(s)? Each will restart.`);
          if (!confirmed) {
            console.log('Cancelled');
            return;
          }
        }

        // Update agents sequentially
        const results: Array<{ hostname: string; success: boolean; message: string }> = [];

        for (const info of canUpdate) {
          if (!options.json) {
            process.stdout.write(`Updating ${info.agent.hostname}... `);
          }

          try {
            if (options.plugins) {
              const response = await withAgentConnection(info.ip, DEFAULT_AGENT_PORT, { tunnel: useTunnel }, (h, p) =>
                triggerPluginUpdate(h, p),
              );
              results.push({
                hostname: info.agent.hostname,
                success: response.updated > 0,
                message: `Updated ${response.updated} plugin(s)`,
              });
              if (!options.json) {
                console.log(`\x1b[32m✓\x1b[0m Updated ${response.updated} plugin(s)`);
              }
            } else {
              const response = await withAgentConnection(info.ip, DEFAULT_AGENT_PORT, { tunnel: useTunnel }, (h, p) =>
                triggerAgentUpdate(h, p),
              );
              results.push({
                hostname: info.agent.hostname,
                success: response.success,
                message: response.message,
              });
              if (!options.json) {
                console.log(`\x1b[32m✓\x1b[0m ${response.previousVersion} → ${response.newVersion}`);
              }
            }

            // Brief pause between updates
            await new Promise(r => setTimeout(r, 2000));
          } catch (err) {
            results.push({
              hostname: info.agent.hostname,
              success: false,
              message: err instanceof Error ? err.message : String(err),
            });
            if (!options.json) {
              console.log(`\x1b[31m✗\x1b[0m ${err instanceof Error ? err.message : String(err)}`);
            }
          }
        }

        // Summary
        const successCount = results.filter(r => r.success).length;

        if (options.json) {
          output.json({
            updated: successCount,
            failed: results.length - successCount,
            results,
          });
        } else {
          console.log();
          console.log(`Updated ${successCount} of ${results.length} agent(s)`);
          if (successCount > 0) {
            console.log('\x1b[33mNote: Agents are restarting. Allow 30-60 seconds for them to come back online.\x1b[0m');
          }
        }
      } catch (err) {
        spinner.fail('Failed to fetch agents');
        output.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
      } finally {
        await mode.closeLocalClient();
      }
    });
}
