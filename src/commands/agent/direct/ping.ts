// Path: src/commands/agent/direct/ping.ts

/**
 * Agent ping command - check agent health directly via HTTP
 */

import type { Command } from 'commander';

import * as output from '../../../lib/output.js';
import type { DirectCommandOptions } from '../types.js';
import { resolveHostPort, fetchAgentHealth, formatUptime } from '../helpers.js';
import { withAgentConnection } from '../../../lib/ssh-tunnel.js';

export function registerPingCommand(parentCmd: Command): void {
  parentCmd
    .command('ping [hostPort]')
    .description('Check agent health directly via HTTP (format: host:port or host, or select from list)')
    .option('--json', 'Output as JSON')
    .option('--no-tunnel', 'Connect directly to host:port instead of via an SSH-CA tunnel')
    .action(async (hostPort: string | undefined, options: DirectCommandOptions) => {
      const resolved = await resolveHostPort(hostPort);
      if (!resolved) {
        process.exit(1);
      }
      const { host, port } = resolved;
      const spinner = output.spinner(`Checking agent at ${host}:${port}...`).start();

      try {
        const health = await withAgentConnection(host, port, { tunnel: options.tunnel !== false }, (h, p) =>
          fetchAgentHealth(h, p),
        );
        spinner.stop();

        if (options.json) {
          output.json(health);
          return;
        }

        const statusColor = health.status === 'healthy' ? '\x1b[32m' :
                           health.status === 'degraded' ? '\x1b[33m' : '\x1b[31m';
        const reset = '\x1b[0m';
        const statusIcon = health.status === 'healthy' ? '●' :
                          health.status === 'degraded' ? '◐' : '○';

        console.log();
        console.log(`Agent: ${host}:${port}`);
        console.log('═'.repeat(40));
        console.log(`  Status:  ${statusColor}${statusIcon} ${health.status}${reset}`);
        console.log(`  Version: v${health.version}`);
        console.log(`  Uptime:  ${formatUptime(health.uptime)}`);

        if (health.plugins && health.plugins.length > 0) {
          console.log();
          console.log('Plugins:');
          for (const plugin of health.plugins) {
            const pluginIcon = plugin.healthy ? '\x1b[32m●\x1b[0m' : '\x1b[31m○\x1b[0m';
            console.log(`  ${pluginIcon} ${plugin.name} v${plugin.version}`);
          }
        }

        console.log();
      } catch (err) {
        spinner.fail(`Failed to reach agent at ${host}:${port}`);
        output.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    });
}
