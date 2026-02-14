// Path: src/commands/agent/remote/status.ts

/**
 * Agent status command - show detailed status of an agent
 */

import type { Command } from 'commander';

import * as mode from '../../../lib/mode.js';
import * as output from '../../../lib/output.js';
import type { StatusOptions, AgentDetailResponse, ReprovisionStatusResponse } from '../types.js';
import { formatRelativeTime, formatConnectionState, formatSecondsToHuman } from '../helpers.js';

export function registerStatusCommand(parentCmd: Command): void {
  parentCmd
    .command('status <agent-id>')
    .description('Show detailed status of an agent including connection state')
    .option('--json', 'Output as JSON')
    .action(async (agentId: string, options: StatusOptions) => {
      const spinner = output.spinner('Fetching agent status...').start();

      try {
        // Fetch both agent details and reprovision status in parallel
        const [agentResponse, reprovisionResponse] = await Promise.all([
          mode.apiGet<AgentDetailResponse>(`/v1/agents/${encodeURIComponent(agentId)}`),
          mode.apiGet<ReprovisionStatusResponse>(`/v1/agents/${encodeURIComponent(agentId)}/reprovision/status`).catch(() => null),
        ]);

        spinner.stop();

        if (options.json) {
          output.json({ agent: agentResponse, reprovision: reprovisionResponse });
          return;
        }

        const agent = agentResponse;
        const statusIcon = agent.status === 'online' ? '●' : '○';
        const statusColor = agent.status === 'online' ? '\x1b[32m' : '\x1b[31m';
        const reset = '\x1b[0m';

        console.log();
        console.log(`Agent: ${agent.hostname}`);
        console.log('═'.repeat(50));
        console.log();

        // Basic Info
        console.log('Basic Information:');
        console.log(`  ID:          ${agent.id}`);
        console.log(`  Tenant:      ${agent.tenantId}`);
        console.log(`  Platform:    ${agent.platform ?? 'Unknown'}`);
        console.log(`  Version:     ${agent.version ? `v${agent.version}` : 'Unknown'}`);
        console.log(`  IP Address:  ${agent.lastIpAddress ?? 'Unknown'}`);
        console.log();

        // API Key Info
        if (agent.apiKey) {
          console.log('API Key:');
          console.log(`  Name:        ${agent.apiKey.name}`);
          console.log(`  Prefix:      ${agent.apiKey.prefix}`);
          console.log(`  Type:        ${agent.apiKey.isManaged ? 'Managed' : 'Static'}`);
          if (agent.apiKey.isManaged && agent.apiKey.rotationMode) {
            console.log(`  Rotation:    ${agent.apiKey.rotationMode.replace('on-', '')} (${formatSecondsToHuman(agent.apiKey.rotationIntervalSeconds ?? 0)})`);
          }
          console.log();
        }

        // Connection Status
        console.log('Connection Status:');
        console.log(`  Status:           ${statusColor}${statusIcon} ${agent.status}${reset}`);
        console.log(`  Connection State: ${formatConnectionState(agent.connectionState)}`);
        console.log(`  Last Seen:        ${formatRelativeTime(agent.lastSeen)}`);
        if (agent.lastConnectedAt) {
          console.log(`  Last Connected:   ${formatRelativeTime(agent.lastConnectedAt)}`);
        }
        if (agent.lastDisconnectedAt) {
          console.log(`  Last Disconnected: ${formatRelativeTime(agent.lastDisconnectedAt)}`);
          if (agent.disconnectReason) {
            console.log(`  Disconnect Reason: ${agent.disconnectReason}`);
          }
        }
        console.log();

        // Degraded State Info (if applicable)
        if (agent.connectionState === 'degraded' || agent.lastDegradedAt || agent.degradedReason) {
          console.log('Degraded State:');
          if (agent.lastHealthyAt) {
            console.log(`  Last Healthy:    ${formatRelativeTime(agent.lastHealthyAt)}`);
          }
          if (agent.lastDegradedAt) {
            console.log(`  Degraded Since:  ${formatRelativeTime(agent.lastDegradedAt)}`);
          }
          if (agent.degradedReason) {
            console.log(`  Reason:          ${agent.degradedReason}`);
          }
          console.log();
        }

        // Reprovision Status
        if (reprovisionResponse) {
          if (reprovisionResponse.hasPendingToken && reprovisionResponse.pendingToken) {
            console.log('Pending Reprovision:');
            console.log(`  Token Created:   ${formatRelativeTime(reprovisionResponse.pendingToken.createdAt)}`);
            console.log(`  Token Expires:   ${new Date(reprovisionResponse.pendingToken.expiresAt).toLocaleString()}`);
            if (reprovisionResponse.pendingToken.reason) {
              console.log(`  Reason:          ${reprovisionResponse.pendingToken.reason}`);
            }
            console.log();
          }
        }

        // Alerts Configuration
        console.log('Alert Configuration:');
        console.log(`  Disconnect Alerts: ${agent.alertOnDisconnect ? 'Enabled' : 'Disabled'}`);
        if (agent.alertOnDisconnect) {
          console.log(`  Threshold:         ${agent.disconnectThresholdSeconds}s`);
        }
        console.log();

        // Subscriptions
        const certCount = agent.subscriptions.certificates.length;
        const secretCount = agent.subscriptions.secrets.length;
        console.log('Subscriptions:');
        console.log(`  Certificates: ${certCount}`);
        console.log(`  Secrets:      ${secretCount}`);
        if (agent.subscriptions.updates) {
          console.log(`  Updates:      ${agent.subscriptions.updates}`);
        }
        console.log();

        // Stats
        console.log('Statistics:');
        console.log(`  Total Connections:    ${agent.totalConnections}`);
        console.log(`  Events Received:      ${agent.totalEventsReceived}`);
        console.log(`  Registered:           ${formatRelativeTime(agent.createdAt)}`);
        console.log();
      } catch (err) {
        spinner.fail('Failed to fetch agent status');
        output.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
      } finally {
        await mode.closeLocalClient();
      }
    });
}
