import { Command } from 'commander';
import ora from 'ora';
import * as mode from '../lib/mode.js';
import * as output from '../lib/output.js';

export function registerHealthCommands(program: Command): void {
  // Health command
  program
    .command('health')
    .description('Check vault server health')
    .option('--leader', 'Check leader node health')
    .option('--json', 'Output as JSON')
    .action(async (options) => {
      const spinner = ora('Checking health...').start();

      try {
        const health = options.leader
          ? await mode.leaderHealth()
          : await mode.health();

        spinner.stop();

        if (options.json) {
          output.json(health);
          return;
        }

        const statusColor = health.status === 'ok'
          ? output.formatStatus('ok')
          : output.formatStatus(health.status);

        console.log();
        // Show mode indicator
        console.log(`Mode:      ${mode.getModeDescription()}`);
        console.log();
        console.log(`Status:    ${statusColor}`);
        console.log(`Version:   ${health.version}`);
        if (health.uptime !== undefined) {
          console.log(`Uptime:    ${formatUptime(health.uptime)}`);
        }
        console.log(`Timestamp: ${health.timestamp}`);

        // Infrastructure section
        console.log();
        console.log('Infrastructure:');

        if (health.database) {
          const db = health.database as { status: string; role?: string; replicationLag?: number };
          let dbInfo = output.formatStatus(db.status);
          if (db.role) {
            dbInfo += ` (${db.role})`;
          }
          if (db.replicationLag !== undefined && db.replicationLag > 0) {
            dbInfo += ` - lag: ${formatBytes(db.replicationLag)}`;
          }
          console.log(`  PostgreSQL: ${dbInfo}`);
        }

        if (health.redis) {
          const redis = health.redis as { status: string; sentinelNodes?: number; master?: string };
          let redisInfo = output.formatStatus(redis.status);
          if (redis.sentinelNodes !== undefined) {
            redisInfo += ` (${redis.sentinelNodes}/3 sentinels)`;
          }
          if (redis.master) {
            redisInfo += ` - master: ${redis.master}`;
          }
          console.log(`  Redis:      ${redisInfo}`);
        }

        if (health.ha) {
          console.log();
          console.log('HA Cluster:');
          console.log(`  Enabled:  ${output.formatBool(health.ha.enabled)}`);
          console.log(`  Node ID:  ${health.ha.nodeId}`);
          console.log(`  Leader:   ${output.formatBool(health.ha.isLeader)}`);
          if (health.ha.clusterSize) {
            console.log(`  Nodes:    ${health.ha.clusterSize}`);
          }
        }

        console.log();
      } catch (err) {
        spinner.fail('Health check failed');
        output.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
      } finally {
        await mode.closeLocalClient();
      }
    });

  // Status command (comprehensive)
  program
    .command('status')
    .description('Show comprehensive system status')
    .option('--json', 'Output as JSON')
    .action(async (options) => {
      const spinner = ora('Gathering status...').start();

      try {
        const [health, cluster, lockdown] = await Promise.allSettled([
          mode.health(),
          mode.clusterStatus(),
          mode.getLockdownStatus(),
        ]);

        spinner.stop();

        const statusData = {
          mode: mode.getMode(),
          health: health.status === 'fulfilled' ? health.value : null,
          cluster: cluster.status === 'fulfilled' ? cluster.value : null,
          lockdown: lockdown.status === 'fulfilled' ? lockdown.value : null,
        };

        if (options.json) {
          output.json(statusData);
          return;
        }

        // Mode section
        console.log();
        console.log(`Mode: ${mode.getModeDescription()}`);

        // Health section
        output.section('Health');
        if (health.status === 'fulfilled') {
          const h = health.value;
          console.log(`  Status:    ${output.formatStatus(h.status)}`);
          console.log(`  Version:   ${h.version}`);
          if (h.uptime !== undefined) {
            console.log(`  Uptime:    ${formatUptime(h.uptime)}`);
          }
        } else {
          output.error('Failed to get health status');
        }

        // Cluster section
        output.section('Cluster');
        if (cluster.status === 'fulfilled') {
          const c = cluster.value;
          console.log(`  Enabled:   ${output.formatBool(c.enabled)}`);
          console.log(`  Node ID:   ${c.nodeId}`);
          console.log(`  Is Leader: ${output.formatBool(c.isLeader)}`);
          console.log(`  Leader:    ${c.leaderNodeId || 'None'}`);

          if (c.nodes && c.nodes.length > 0) {
            console.log('  Nodes:');
            for (const node of c.nodes) {
              const status = node.isHealthy ? 'healthy' : 'unhealthy';
              const leader = node.isLeader ? ' (leader)' : '';
              console.log(`    - ${node.nodeId}: ${output.formatStatus(status)}${leader}`);
            }
          }
        } else {
          console.log('  Status: Not available');
        }

        // Lockdown section
        output.section('Security');
        if (lockdown.status === 'fulfilled') {
          const l = lockdown.value;
          console.log(`  Lockdown:  ${output.formatStatus(l.status)}`);
          if (l.reason) {
            console.log(`  Reason:    ${l.reason}`);
          }
          if (l.triggeredAt) {
            console.log(`  Since:     ${output.formatDate(l.triggeredAt)}`);
          }
        } else {
          console.log('  Status: Not available');
        }

        console.log();
      } catch (err) {
        spinner.fail('Status check failed');
        output.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
      } finally {
        await mode.closeLocalClient();
      }
    });
}

function formatUptime(seconds: number): string {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);

  if (days > 0) {
    return `${days}d ${hours}h ${minutes}m`;
  }
  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  return `${minutes}m`;
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}
