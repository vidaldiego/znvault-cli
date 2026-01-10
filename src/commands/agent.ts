// Path: znvault-cli/src/commands/agent.ts

import { type Command } from 'commander';
import ora from 'ora';
import * as mode from '../lib/mode.js';
import * as output from '../lib/output.js';

/**
 * Format relative time for display
 */
function formatRelativeTime(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffMins < 1) return 'just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  return `${diffDays}d ago`;
}

/**
 * Format connection state with color coding
 */
function formatConnectionState(state: string): string {
  const green = '\x1b[32m';
  const yellow = '\x1b[33m';
  const red = '\x1b[31m';
  const cyan = '\x1b[36m';
  const reset = '\x1b[0m';

  switch (state) {
    case 'healthy':
      return `${green}● healthy${reset}`;
    case 'degraded':
      return `${yellow}◐ degraded${reset}`;
    case 'recovering':
      return `${cyan}↻ recovering${reset}`;
    case 'reprovisioning':
      return `${cyan}⟳ reprovisioning${reset}`;
    case 'unknown':
    default:
      return `${red}○ ${state || 'unknown'}${reset}`;
  }
}

// Remote agent types
interface RemoteAgent {
  id: string;
  tenantId: string;
  hostname: string;
  version: string | null;
  platform: string | null;
  status: 'online' | 'offline';
  lastSeen: string;
  alertOnDisconnect: boolean;
  disconnectThresholdSeconds: number;
  lastIpAddress: string | null;
  subscriptions: {
    certificates: string[];
    secrets: string[];
    updates: string | null;
  };
}

interface RemoteAgentConnection {
  agentId: string;
  hostname: string;
  tenantId: string;
  version: string;
  platform: string;
  connectedAt: string;
}

// Command options interfaces
interface RemoteListOptions {
  status?: string;
  tenant?: string;
  json?: boolean;
}

interface ConnectionsOptions {
  tenant?: string;
  json?: boolean;
}

interface AlertsOptions {
  enable?: boolean;
  disable?: boolean;
  threshold?: string;
}

interface DeleteOptions {
  yes?: boolean;
}

interface ReprovisionOptions {
  reason?: string;
  expiresIn?: string;
}

interface ReprovisionResponse {
  token: string;
  agentId: string;
  tenantId: string;
  expiresAt: string;
  reason: string | null;
  newApiKeyId: string;
}

interface ReprovisionStatusResponse {
  agentId: string;
  hostname: string;
  connectionState: string;
  hasPendingToken: boolean;
  pendingToken?: {
    id: string;
    expiresAt: string;
    createdAt: string;
    createdBy: string | null;
    reason: string | null;
  };
  lastHealthyAt: string | null;
  lastDegradedAt: string | null;
  degradedReason: string | null;
}

interface AgentDetailResponse {
  id: string;
  tenantId: string;
  hostname: string;
  version: string | null;
  platform: string | null;
  status: 'online' | 'offline';
  connectionState: string;
  lastSeen: string;
  lastConnectedAt: string | null;
  lastDisconnectedAt: string | null;
  disconnectReason: string | null;
  lastHealthyAt: string | null;
  lastDegradedAt: string | null;
  degradedReason: string | null;
  alertOnDisconnect: boolean;
  disconnectThresholdSeconds: number;
  totalConnections: number;
  totalEventsReceived: number;
  lastIpAddress: string | null;
  subscriptions: {
    certificates: string[];
    secrets: string[];
    updates: string | null;
  };
  createdAt: string;
  updatedAt: string;
}

export function registerAgentCommands(program: Command): void {
  const agent = program
    .command('agent')
    .description('Manage remote agents and registration tokens');

  // ===== Remote Agent Management Commands =====

  const remote = agent
    .command('remote')
    .description('Manage agents registered with the vault');

  // List remote agents
  remote
    .command('list')
    .description('List agents registered with the vault')
    .option('--status <status>', 'Filter by status (online, offline)')
    .option('--tenant <tenantId>', 'Filter by tenant (superadmin only)')
    .option('--json', 'Output as JSON')
    .action(async (options: RemoteListOptions) => {
      const spinner = ora('Fetching agents...').start();

      try {
        const params = new URLSearchParams();
        if (options.status) params.set('status', options.status);
        if (options.tenant) params.set('tenantId', options.tenant);
        params.set('pageSize', '100');

        const query = params.toString();
        const response = await mode.apiGet<{
          agents: RemoteAgent[];
          pagination: { totalItems: number };
        }>(`/v1/agents${query ? `?${query}` : ''}`);

        spinner.stop();

        if (options.json) {
          output.json(response);
          return;
        }

        if (response.agents.length === 0) {
          console.log('No agents registered');
          return;
        }

        console.log(`Total agents: ${response.pagination.totalItems}`);
        console.log();

        output.table(
          ['Hostname', 'Status', 'Last Seen', 'IP Address', 'Platform', 'Alerts'],
          response.agents.map(a => [
            a.hostname,
            a.status === 'online' ? '● online' : '○ offline',
            formatRelativeTime(a.lastSeen),
            a.lastIpAddress ?? '-',
            a.platform ?? '-',
            a.alertOnDisconnect ? 'enabled' : 'disabled',
          ])
        );
      } catch (err) {
        spinner.fail('Failed to fetch agents');
        output.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
      } finally {
        await mode.closeLocalClient();
      }
    });

  // Show active connections
  remote
    .command('connections')
    .description('Show active WebSocket connections')
    .option('--tenant <tenantId>', 'Filter by tenant (superadmin only)')
    .option('--json', 'Output as JSON')
    .action(async (options: ConnectionsOptions) => {
      const spinner = ora('Fetching connections...').start();

      try {
        const query = options.tenant ? `?tenantId=${encodeURIComponent(options.tenant)}` : '';
        const response = await mode.apiGet<{
          connections: RemoteAgentConnection[];
          totalConnections: number;
        }>(`/v1/agents/connections${query}`);

        spinner.stop();

        if (options.json) {
          output.json(response);
          return;
        }

        if (response.connections.length === 0) {
          console.log('No active connections');
          return;
        }

        console.log(`Active connections: ${response.totalConnections}`);
        console.log();

        output.table(
          ['Hostname', 'Tenant', 'Version', 'Platform', 'Connected'],
          response.connections.map(c => [
            c.hostname,
            c.tenantId,
            c.version,
            c.platform,
            formatRelativeTime(c.connectedAt),
          ])
        );
      } catch (err) {
        spinner.fail('Failed to fetch connections');
        output.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
      } finally {
        await mode.closeLocalClient();
      }
    });

  // Get agent status/details
  remote
    .command('status <agent-id>')
    .description('Show detailed status of an agent including connection state')
    .option('--json', 'Output as JSON')
    .action(async (agentId: string, options: { json?: boolean }) => {
      const spinner = ora('Fetching agent status...').start();

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
        console.log(`  Platform:    ${agent.platform || 'Unknown'}`);
        console.log(`  Version:     ${agent.version ? `v${agent.version}` : 'Unknown'}`);
        console.log(`  IP Address:  ${agent.lastIpAddress || 'Unknown'}`);
        console.log();

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
        const certCount = agent.subscriptions?.certificates?.length ?? 0;
        const secretCount = agent.subscriptions?.secrets?.length ?? 0;
        console.log('Subscriptions:');
        console.log(`  Certificates: ${certCount}`);
        console.log(`  Secrets:      ${secretCount}`);
        if (agent.subscriptions?.updates) {
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

  // Configure agent alerts
  remote
    .command('alerts <agent-id>')
    .description('Configure disconnect alerts for an agent')
    .option('--enable', 'Enable disconnect alerts')
    .option('--disable', 'Disable disconnect alerts')
    .option('--threshold <seconds>', 'Set disconnect threshold in seconds', '600')
    .action(async (agentId: string, options: AlertsOptions) => {
      if (!options.enable && !options.disable) {
        output.error('Specify --enable or --disable');
        process.exit(1);
      }

      const spinner = ora('Updating agent alerts...').start();

      try {
        const payload: { alertOnDisconnect?: boolean; disconnectThresholdSeconds?: number } = {};

        if (options.enable) payload.alertOnDisconnect = true;
        if (options.disable) payload.alertOnDisconnect = false;
        if (options.threshold) payload.disconnectThresholdSeconds = parseInt(options.threshold, 10);

        const remoteAgent = await mode.apiPatch<RemoteAgent>(
          `/v1/agents/${encodeURIComponent(agentId)}/alerts`,
          payload
        );

        spinner.succeed(`Alerts ${remoteAgent.alertOnDisconnect ? 'enabled' : 'disabled'} for ${remoteAgent.hostname}`);

        if (remoteAgent.alertOnDisconnect) {
          console.log(`  Threshold: ${remoteAgent.disconnectThresholdSeconds} seconds`);
        }
      } catch (err) {
        spinner.fail('Failed to update alerts');
        output.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
      } finally {
        await mode.closeLocalClient();
      }
    });

  // Delete agent
  remote
    .command('delete <agent-id>')
    .description('Remove an agent from the vault')
    .option('-y, --yes', 'Skip confirmation')
    .action(async (agentId: string, options: DeleteOptions) => {
      if (!options.yes) {
        const readline = await import('readline');
        const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
        const answer = await new Promise<string>(resolve => {
          rl.question(`Delete agent ${agentId}? This will remove all activity history. [y/N] `, resolve);
        });
        rl.close();

        if (answer.toLowerCase() !== 'y') {
          console.log('Cancelled');
          return;
        }
      }

      const spinner = ora('Deleting agent...').start();

      try {
        await mode.apiDelete(`/v1/agents/${encodeURIComponent(agentId)}`);
        spinner.succeed('Agent deleted');
      } catch (err) {
        spinner.fail('Failed to delete agent');
        output.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
      } finally {
        await mode.closeLocalClient();
      }
    });

  // ===== Agent Reprovision Commands =====

  // Initiate reprovision
  remote
    .command('reprovision <agent-id>')
    .description('Generate a one-time token to reprovision an agent with new credentials')
    .option('-r, --reason <reason>', 'Reason for reprovisioning (for audit trail)')
    .option('-e, --expires-in <duration>', 'Token expiration (default: 15m)', '15m')
    .action(async (agentId: string, options: ReprovisionOptions) => {
      const spinner = ora('Generating reprovision token...').start();

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

  // Check reprovision status
  remote
    .command('reprovision-status <agent-id>')
    .description('Check reprovision status and pending tokens for an agent')
    .option('--json', 'Output as JSON')
    .action(async (agentId: string, options: { json?: boolean }) => {
      const spinner = ora('Fetching reprovision status...').start();

      try {
        const response = await mode.apiGet<ReprovisionStatusResponse>(
          `/v1/agents/${encodeURIComponent(agentId)}/reprovision/status`
        );

        spinner.stop();

        if (options.json) {
          output.json(response);
          return;
        }

        console.log(`Agent: ${response.hostname} (${response.agentId})`);
        console.log();
        console.log('Connection State:');
        console.log(`  Current state: ${response.connectionState}`);
        if (response.lastHealthyAt) {
          console.log(`  Last healthy:  ${formatRelativeTime(response.lastHealthyAt)}`);
        }
        if (response.lastDegradedAt) {
          console.log(`  Last degraded: ${formatRelativeTime(response.lastDegradedAt)}`);
        }
        if (response.degradedReason) {
          console.log(`  Degraded reason: ${response.degradedReason}`);
        }
        console.log();

        if (response.hasPendingToken && response.pendingToken) {
          console.log('Pending Reprovision Token:');
          console.log(`  Token ID:   ${response.pendingToken.id}`);
          console.log(`  Created:    ${formatRelativeTime(response.pendingToken.createdAt)}`);
          console.log(`  Expires:    ${new Date(response.pendingToken.expiresAt).toLocaleString()}`);
          if (response.pendingToken.createdBy) {
            console.log(`  Created by: ${response.pendingToken.createdBy}`);
          }
          if (response.pendingToken.reason) {
            console.log(`  Reason:     ${response.pendingToken.reason}`);
          }
        } else {
          console.log('No pending reprovision token');
        }
      } catch (err) {
        spinner.fail('Failed to fetch reprovision status');
        output.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
      } finally {
        await mode.closeLocalClient();
      }
    });

  // Cancel reprovision
  remote
    .command('cancel-reprovision <agent-id>')
    .description('Cancel a pending reprovision token')
    .option('-y, --yes', 'Skip confirmation')
    .action(async (agentId: string, options: { yes?: boolean }) => {
      if (!options.yes) {
        const readline = await import('readline');
        const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
        const answer = await new Promise<string>(resolve => {
          rl.question('Cancel the pending reprovision token? [y/N] ', resolve);
        });
        rl.close();

        if (answer.toLowerCase() !== 'y') {
          console.log('Cancelled');
          return;
        }
      }

      const spinner = ora('Cancelling reprovision token...').start();

      try {
        await mode.apiDelete(`/v1/agents/${encodeURIComponent(agentId)}/reprovision`);
        spinner.succeed('Reprovision token cancelled');
        console.log('The agent will need a new token to be reprovisioned.');
      } catch (err) {
        spinner.fail('Failed to cancel reprovision token');
        output.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
      } finally {
        await mode.closeLocalClient();
      }
    });

  // ===== Registration Token Commands =====

  const token = agent
    .command('token')
    .description('Manage registration tokens for agent bootstrapping');

  // Create registration token
  token
    .command('create')
    .description('Create a one-time registration token for managed key binding')
    .requiredOption('-k, --managed-key <name>', 'Name of the managed key to bind')
    .option('-e, --expires <duration>', 'Token expiration (e.g., "1h", "24h")', '1h')
    .option('-d, --description <text>', 'Optional description for audit trail')
    .option('--tenant <tenantId>', 'Target tenant ID (superadmin only)')
    .action(async (options: {
      managedKey: string;
      expires: string;
      description?: string;
      tenant?: string;
    }) => {
      const spinner = ora('Creating registration token...').start();

      try {
        const tenantQuery = options.tenant ? `?tenantId=${encodeURIComponent(options.tenant)}` : '';

        const response = await mode.apiPost<{
          token: string;
          prefix: string;
          id: string;
          managedKeyName: string;
          tenantId: string;
          expiresAt: string;
          description: string | null;
        }>(
          `/auth/api-keys/managed/${encodeURIComponent(options.managedKey)}/registration-tokens${tenantQuery}`,
          {
            expiresIn: options.expires,
            description: options.description,
          }
        );

        spinner.succeed('Registration token created');
        console.log();
        console.log('Token (save this - shown only once!):');
        console.log(`  ${response.token}`);
        console.log();
        console.log('Details:');
        console.log(`  Prefix: ${response.prefix}`);
        console.log(`  Managed Key: ${response.managedKeyName}`);
        console.log(`  Tenant: ${response.tenantId}`);
        console.log(`  Expires: ${new Date(response.expiresAt).toLocaleString()}`);
        if (response.description) {
          console.log(`  Description: ${response.description}`);
        }
        console.log();
        console.log('Usage:');
        console.log(`  curl -sSL https://vault.example.com/agent/bootstrap.sh | ZNVAULT_TOKEN=${response.token} bash`);
        console.log();
        console.log('Or manually:');
        console.log(`  curl -X POST https://vault.example.com/agent/bootstrap \\`);
        console.log(`    -H "Content-Type: application/json" \\`);
        console.log(`    -d '{"token": "${response.token}"}'`);
      } catch (err) {
        spinner.fail('Failed to create registration token');
        output.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
      } finally {
        await mode.closeLocalClient();
      }
    });

  // List registration tokens
  token
    .command('list')
    .description('List registration tokens for a managed key')
    .requiredOption('-k, --managed-key <name>', 'Name of the managed key')
    .option('--include-used', 'Include already-used tokens')
    .option('--tenant <tenantId>', 'Target tenant ID (superadmin only)')
    .option('--json', 'Output as JSON')
    .action(async (options: {
      managedKey: string;
      includeUsed?: boolean;
      tenant?: string;
      json?: boolean;
    }) => {
      const spinner = ora('Fetching registration tokens...').start();

      try {
        const params = new URLSearchParams();
        if (options.tenant) params.set('tenantId', options.tenant);
        if (options.includeUsed) params.set('includeUsed', 'true');

        const query = params.toString();
        const response = await mode.apiGet<{
          tokens: Array<{
            id: string;
            prefix: string;
            managedKeyName: string;
            tenantId: string;
            createdBy: string;
            createdAt: string;
            expiresAt: string;
            usedAt: string | null;
            usedByIp: string | null;
            revokedAt: string | null;
            description: string | null;
            status: 'active' | 'used' | 'expired' | 'revoked';
          }>;
        }>(`/auth/api-keys/managed/${encodeURIComponent(options.managedKey)}/registration-tokens${query ? `?${query}` : ''}`);

        spinner.stop();

        if (options.json) {
          output.json(response);
          return;
        }

        if (response.tokens.length === 0) {
          console.log('No registration tokens found');
          return;
        }

        console.log(`Registration tokens for ${options.managedKey}:`);
        console.log();

        output.table(
          ['Prefix', 'Status', 'Created', 'Expires', 'Description'],
          response.tokens.map(t => [
            t.prefix,
            t.status === 'active' ? '● active' :
              t.status === 'used' ? '○ used' :
              t.status === 'expired' ? '○ expired' : '○ revoked',
            formatRelativeTime(t.createdAt),
            formatRelativeTime(t.expiresAt),
            t.description?.substring(0, 30) ?? '-',
          ])
        );
      } catch (err) {
        spinner.fail('Failed to fetch registration tokens');
        output.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
      } finally {
        await mode.closeLocalClient();
      }
    });

  // Revoke registration token
  token
    .command('revoke <token-id>')
    .description('Revoke a registration token (prevents future use)')
    .requiredOption('-k, --managed-key <name>', 'Name of the managed key')
    .option('--tenant <tenantId>', 'Target tenant ID (superadmin only)')
    .option('-y, --yes', 'Skip confirmation prompt')
    .action(async (tokenId: string, options: {
      managedKey: string;
      tenant?: string;
      yes?: boolean;
    }) => {
      if (!options.yes) {
        const readline = await import('readline');
        const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
        const answer = await new Promise<string>(resolve => {
          rl.question(`Revoke token ${tokenId}? This cannot be undone. [y/N] `, resolve);
        });
        rl.close();

        if (answer.toLowerCase() !== 'y') {
          console.log('Cancelled');
          return;
        }
      }

      const spinner = ora('Revoking registration token...').start();

      try {
        const tenantQuery = options.tenant ? `?tenantId=${encodeURIComponent(options.tenant)}` : '';

        await mode.apiDelete(
          `/auth/api-keys/managed/${encodeURIComponent(options.managedKey)}/registration-tokens/${encodeURIComponent(tokenId)}${tenantQuery}`
        );

        spinner.succeed('Registration token revoked');
      } catch (err) {
        spinner.fail('Failed to revoke registration token');
        output.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
      } finally {
        await mode.closeLocalClient();
      }
    });

  // Help text pointing to zn-vault-agent
  agent
    .command('help-local')
    .description('Show help for local agent operations')
    .action(() => {
      console.log('Local Agent Operations');
      console.log('======================');
      console.log();
      console.log('For local agent configuration and sync operations, use the standalone agent:');
      console.log();
      console.log('  zn-vault-agent login      # Authenticate with vault');
      console.log('  zn-vault-agent setup      # Interactive setup');
      console.log('  zn-vault-agent sync       # Sync secrets/certificates');
      console.log('  zn-vault-agent start      # Start agent daemon');
      console.log('  zn-vault-agent status     # Show agent status');
      console.log('  zn-vault-agent exec       # Execute with secrets injected');
      console.log();
      console.log('Install the standalone agent:');
      console.log('  npm install -g @zincapp/zn-vault-agent');
      console.log();
      console.log('For more information:');
      console.log('  zn-vault-agent --help');
    });
}
