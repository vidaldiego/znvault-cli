// Path: src/commands/agent/helpers.ts

/**
 * Helper functions for agent commands
 */


import inquirer from 'inquirer';
import * as mode from '../../lib/mode.js';
import * as output from '../../lib/output.js';
import { formatSecondsToHuman } from '../../lib/format-helpers.js';
import {
  DEFAULT_AGENT_PORT,
  AGENT_HEALTH_TIMEOUT_MS,
  AGENT_PLUGIN_UPDATE_TIMEOUT_MS,
  AGENT_UPDATE_TIMEOUT_MS,
  AGENT_RESTART_WAIT_MS,
} from '../../lib/constants.js';
import type {
  RemoteAgent,
  AgentHealthResponse,
  PluginVersionsResponse,
  PluginUpdateResponse,
  AgentVersionResponse,
  AgentUpdateResponse,
  AgentListResponse,
} from './types.js';

// Re-export common formatters from centralized location
export { formatSecondsToHuman } from '../../lib/format-helpers.js';

// ============================================================================
// Formatting Functions
// ============================================================================

/**
 * Format relative time for display (with "just now" for recent events)
 */
export function formatRelativeTime(dateStr: string): string {
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
export function formatConnectionState(state: string): string {
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

/**
 * Format key type for display
 */
export function formatKeyType(apiKey: RemoteAgent['apiKey']): string {
  if (!apiKey) return '-';
  if (!apiKey.isManaged) return 'Static';

  const rotationMode = apiKey.rotationMode?.replace('on-', '') ?? 'managed';
  const interval = apiKey.rotationIntervalSeconds
    ? formatSecondsToHuman(apiKey.rotationIntervalSeconds)
    : '';
  return interval ? `${rotationMode}/${interval}` : rotationMode;
}

/**
 * Format uptime seconds to human-readable string
 */
export function formatUptime(seconds: number): string {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const mins = Math.floor((seconds % 3600) / 60);

  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${mins}m`;
  return `${mins}m`;
}

// ============================================================================
// Host/Port Parsing
// ============================================================================

/**
 * Parse host:port string (defaults to DEFAULT_AGENT_PORT)
 */
export function parseHostPort(hostPort: string): { host: string; port: number } {
  if (hostPort.includes(':')) {
    const [host, portStr] = hostPort.split(':');
    const port = parseInt(portStr!, 10);
    if (isNaN(port) || port < 1 || port > 65535) {
      throw new Error(`Invalid port: ${portStr}`);
    }
    return { host: host!, port };
  }
  return { host: hostPort, port: DEFAULT_AGENT_PORT };
}

// ============================================================================
// Direct HTTP Communication Functions
// ============================================================================

/**
 * Fetch agent health via direct HTTP
 */
export async function fetchAgentHealth(host: string, port: number): Promise<AgentHealthResponse> {
  const url = `http://${host}:${port}/health`;
  const response = await fetch(url, {
    signal: AbortSignal.timeout(AGENT_HEALTH_TIMEOUT_MS),
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }

  return response.json() as Promise<AgentHealthResponse>;
}

/**
 * Fetch plugin versions via direct HTTP
 */
export async function fetchPluginVersions(host: string, port: number): Promise<PluginVersionsResponse> {
  const url = `http://${host}:${port}/plugins/versions`;
  const response = await fetch(url, {
    signal: AbortSignal.timeout(AGENT_HEALTH_TIMEOUT_MS),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`HTTP ${response.status}: ${text || response.statusText}`);
  }

  return response.json() as Promise<PluginVersionsResponse>;
}

/**
 * Trigger plugin update via direct HTTP
 */
export async function triggerPluginUpdate(host: string, port: number): Promise<PluginUpdateResponse> {
  const url = `http://${host}:${port}/plugins/update`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    // A JSON content-type with an empty body makes the agent's Fastify reject
    // with FST_ERR_CTP_EMPTY_JSON_BODY (HTTP 400). Send an explicit body.
    body: '{}',
    signal: AbortSignal.timeout(AGENT_PLUGIN_UPDATE_TIMEOUT_MS),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`HTTP ${response.status}: ${text || response.statusText}`);
  }

  return response.json() as Promise<PluginUpdateResponse>;
}

/**
 * Fetch agent version info via direct HTTP
 */
export async function fetchAgentVersion(host: string, port: number): Promise<AgentVersionResponse> {
  const url = `http://${host}:${port}/agent/version`;
  const response = await fetch(url, {
    signal: AbortSignal.timeout(AGENT_HEALTH_TIMEOUT_MS),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`HTTP ${response.status}: ${text || response.statusText}`);
  }

  return response.json() as Promise<AgentVersionResponse>;
}

/**
 * Trigger agent self-update via direct HTTP
 */
export async function triggerAgentUpdate(host: string, port: number, force = false): Promise<AgentUpdateResponse> {
  const url = `http://${host}:${port}/agent/update`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    // A JSON content-type with an empty body makes the agent's Fastify reject
    // with FST_ERR_CTP_EMPTY_JSON_BODY (HTTP 400). The agent's handler reads an
    // optional { force } — send it explicitly.
    body: JSON.stringify({ force }),
    signal: AbortSignal.timeout(AGENT_UPDATE_TIMEOUT_MS),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`HTTP ${response.status}: ${text || response.statusText}`);
  }

  return response.json() as Promise<AgentUpdateResponse>;
}

// ============================================================================
// Interactive Selection
// ============================================================================

/**
 * Fetch agents from vault and let user select one interactively
 * Returns the selected agent's host:port string
 */
export async function selectAgentInteractively(): Promise<{ host: string; port: number } | null> {
  // Check if we have an interactive terminal
  if (!process.stdin.isTTY) {
    output.error('Interactive selection requires a TTY. Specify host:port directly.');
    console.log('Usage: znvault agent ping <host:port>');
    console.log('Example: znvault agent ping 172.16.220.55:9100');
    return null;
  }

  const spinner = output.spinner('Fetching agents from vault...').start();

  try {
    const response = await mode.apiGet<AgentListResponse>('/v1/agents?pageSize=100');

    spinner.stop();

    if (response.agents.length === 0) {
      console.log('No agents registered with the vault');
      console.log('Use: znvault agent ping <host:port>');
      return null;
    }

    // Build list of agents with IP addresses
    const agentList: Array<{ hostname: string; ip: string; status: string; version: string }> = [];

    // Sort: online first, then by hostname
    const sortedAgents = [...response.agents].sort((a, b) => {
      if (a.status !== b.status) return a.status === 'online' ? -1 : 1;
      return a.hostname.localeCompare(b.hostname);
    });

    for (const a of sortedAgents) {
      if (!a.lastIpAddress) continue;
      // Strip ::ffff: prefix from IPv6-mapped IPv4 addresses
      const ip = a.lastIpAddress.replace(/^::ffff:/i, '');
      agentList.push({
        hostname: a.hostname,
        ip,
        status: a.status,
        version: a.version ? `v${a.version}` : 'unknown',
      });
    }

    if (agentList.length === 0) {
      console.log('No agents with reachable IP addresses');
      console.log('Use: znvault agent ping <host:port>');
      return null;
    }

    // Display numbered list
    console.log();
    console.log('Available agents:');
    agentList.forEach((a, i) => {
      const statusIcon = a.status === 'online' ? '●' : '○';
      console.log(`  ${i + 1}) ${statusIcon} ${a.hostname} (${a.ip}) - ${a.version}`);
    });
    console.log(`  0) Enter IP manually`);
    console.log();

    // Prompt for selection
    const { selection } = await inquirer.prompt<{ selection: string }>([
      {
        type: 'input',
        name: 'selection',
        message: `Select agent (1-${agentList.length}, or 0 for manual):`,
        validate: (input: string) => {
          const num = parseInt(input.trim(), 10);
          if (isNaN(num) || num < 0 || num > agentList.length) {
            return `Enter a number between 0 and ${agentList.length}`;
          }
          return true;
        },
      },
    ]);

    const selectedNum = parseInt(selection.trim(), 10);

    // Handle manual entry
    if (selectedNum === 0) {
      const { manualHost } = await inquirer.prompt<{ manualHost: string }>([
        {
          type: 'input',
          name: 'manualHost',
          message: 'Enter host:port (e.g., 192.168.1.100:9100):',
          validate: (input: string) => {
            if (!input.trim()) return 'Host is required';
            return true;
          },
        },
      ]);
      return parseHostPort(manualHost.trim());
    }

    const selected = agentList[selectedNum - 1]!;
    return { host: selected.ip, port: DEFAULT_AGENT_PORT };
  } catch (err) {
    spinner.stop();
    // If not authenticated or can't reach vault, return null
    output.error(`Failed to fetch agents: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  } finally {
    await mode.closeLocalClient();
  }
}

/**
 * Get host:port from argument or interactive selection
 */
export async function resolveHostPort(hostPort?: string): Promise<{ host: string; port: number } | null> {
  if (hostPort) {
    return parseHostPort(hostPort);
  }
  return selectAgentInteractively();
}

// ============================================================================
// Confirmation Helpers
// ============================================================================

/**
 * Prompt for confirmation
 */
export async function confirmAction(message: string): Promise<boolean> {
  const readline = await import('readline');
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const answer = await new Promise<string>(resolve => {
    rl.question(`${message} [y/N] `, resolve);
  });
  rl.close();
  return answer.toLowerCase() === 'y';
}

/**
 * Wait for agent restart and verify it's back online
 */
export async function waitForAgentRestart(host: string, port: number, waitSeconds: number = 25): Promise<void> {
  console.log('\x1b[33mAgent is restarting...\x1b[0m');

  for (let i = waitSeconds; i > 0; i--) {
    process.stdout.write(`\rWaiting for restart... ${i}s  `);
    await new Promise(r => setTimeout(r, 1000));
  }
  process.stdout.write('\r\x1b[K');

  // Verify agent is back
  try {
    const health = await fetchAgentHealth(host, port);
    console.log(`\x1b[32m✓\x1b[0m Agent back online (v${health.version})`);
  } catch {
    console.log('\x1b[33m⚠\x1b[0m Agent not responding yet. It may still be restarting.');
  }
}
