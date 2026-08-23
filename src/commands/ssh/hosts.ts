// Path: src/commands/ssh/hosts.ts

/**
 * SSH host discovery from registered agents
 */

import type { Command } from 'commander';

import { client } from '../../lib/client.js';
import * as output from '../../lib/output.js';

interface Agent {
  id: string;
  name: string;
  hostname?: string;
  ip?: string;
  status: 'online' | 'offline' | 'unknown';
  lastSeen?: string;
  version?: string;
  hostConfigId?: string;
  hostConfigName?: string;
  tags?: Record<string, string>;
}

interface AgentListResponse {
  items: Agent[];
  pagination: {
    total: number;
    limit: number;
    offset: number;
    hasMore: boolean;
  };
}

export function registerHostsCommand(parent: Command): void {
  parent
    .command('hosts')
    .description('List available hosts from registered agents')
    .option('--tenant <id>', 'Tenant ID (superadmin only)')
    .option('--online-only', 'Show only online agents')
    .option('--json', 'Output as JSON')
    .action(async (options: { tenant?: string; onlineOnly?: boolean; json?: boolean }) => {
      const spinner = output.spinner('Fetching hosts...').start();

      try {
        const params = new URLSearchParams();
        if (options.tenant) params.set('tenantId', options.tenant);
        params.set('limit', '100');

        const queryString = params.toString();
        const url = queryString ? '/v1/agents?' + queryString : '/v1/agents';
        const response = await client.get<AgentListResponse | Agent[]>(url);
        spinner.stop();

        // Handle both array and paginated response formats
        let agents: Agent[] = Array.isArray(response) ? response : response.items;

        // Filter online only if requested
        if (options.onlineOnly) {
          agents = agents.filter(a => a.status === 'online');
        }

        if (options.json) {
          output.json(agents.map(a => ({
            id: a.id,
            name: a.name,
            hostname: a.hostname,
            ip: a.ip,
            status: a.status,
            lastSeen: a.lastSeen,
            hostConfig: a.hostConfigName,
          })));
          return;
        }

        if (agents.length === 0) {
          output.info('No hosts found');
          if (options.onlineOnly) {
            output.info('Try without --online-only to see all hosts');
          }
          return;
        }

        output.section('Available Hosts');
        output.table(
          ['Name', 'Hostname', 'IP', 'Status', 'Last Seen', 'Config'],
          agents.map(a => [
            a.name,
            a.hostname ?? '-',
            a.ip ?? '-',
            a.status === 'online' ? '● Online' : a.status === 'offline' ? '○ Offline' : '? Unknown',
            a.lastSeen ? formatLastSeen(a.lastSeen) : '-',
            a.hostConfigName ?? '-',
          ])
        );

        output.info('Total: ' + agents.length + ' host(s)');
        
        // Show connection hint
        if (agents.some(a => a.ip)) {
          console.log();
          const firstWithIp = agents.find(a => a.ip);
          if (firstWithIp) {
            output.info('Connect: znvault ssh connect ' + firstWithIp.ip);
            output.info('Or add a bookmark: znvault ssh bookmark add ' + firstWithIp.name + ' ' + firstWithIp.ip);
          }
        }
      } catch (err) {
        spinner.fail('Failed to fetch hosts');
        output.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    });
}

function formatLastSeen(lastSeen: string): string {
  const date = new Date(lastSeen);
  const now = new Date();
  const diff = now.getTime() - date.getTime();

  const minutes = Math.floor(diff / (1000 * 60));
  const hours = Math.floor(diff / (1000 * 60 * 60));
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));

  if (minutes < 1) return 'just now';
  if (minutes < 60) return minutes + 'm ago';
  if (hours < 24) return hours + 'h ago';
  if (days < 7) return days + 'd ago';
  return date.toLocaleDateString();
}
