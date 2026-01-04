import { type Command } from 'commander';
import ora from 'ora';
import * as mode from '../lib/mode.js';
import * as output from '../lib/output.js';
import * as visual from '../lib/visual.js';

interface HealthOptions {
  leader?: boolean;
  json?: boolean;
}

interface StatusOptions {
  json?: boolean;
}

export function registerHealthCommands(program: Command): void {
  // Health command
  program
    .command('health')
    .description('Check vault server health')
    .option('--leader', 'Check leader node health')
    .option('--json', 'Output as JSON')
    .action(async (options: HealthOptions) => {
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

        // Build status box data
        const statusType = health.status === 'ok' ? 'success' :
                          health.status === 'degraded' ? 'warning' : 'error';

        const healthData: Record<string, { value: string; status?: 'success' | 'warning' | 'error' | 'info' }> = {
          'Status': { value: health.status.toUpperCase(), status: statusType },
          'Version': { value: health.version },
          'Uptime': { value: formatUptime(health.uptime) },
          'Mode': { value: mode.getModeDescription() },
        };

        // Add infrastructure status
        if (health.database) {
          const db = health.database as { status: string; role?: string; replicationLag?: number };
          const dbStatus = db.status === 'connected' ? 'success' : 'error';
          let dbValue = db.status === 'connected' ? 'Connected' : db.status;
          if (db.role) dbValue += ` (${db.role})`;
          healthData['PostgreSQL'] = { value: dbValue, status: dbStatus };
        }

        if (health.redis) {
          const redis = health.redis as { status: string; sentinelNodes?: number; master?: string };
          const redisStatus = redis.status === 'connected' ? 'success' : 'error';
          let redisValue = redis.status === 'connected' ? 'Connected' : redis.status;
          if (redis.sentinelNodes !== undefined) redisValue += ` (${redis.sentinelNodes}/3)`;
          healthData['Redis'] = { value: redisValue, status: redisStatus };
        }

        // Add HA info if available
        if (health.ha) {
          healthData['HA Enabled'] = {
            value: health.ha.enabled ? 'Yes' : 'No',
            status: health.ha.enabled ? 'success' : 'info'
          };
          if (health.ha.enabled) {
            healthData['Node ID'] = { value: health.ha.nodeId };
            healthData['Is Leader'] = {
              value: health.ha.isLeader ? 'Yes' : 'No',
              status: health.ha.isLeader ? 'success' : 'info'
            };
            if (health.ha.clusterSize) {
              healthData['Cluster Size'] = { value: String(health.ha.clusterSize) };
            }
          }
        }

        console.log();
        console.log(visual.statusBox('SERVER HEALTH', healthData));
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
    .action(async (options: StatusOptions) => {
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

        console.log();

        // Health box
        if (health.status === 'fulfilled') {
          const h = health.value;
          const healthType = h.status === 'ok' ? 'success' : h.status === 'degraded' ? 'warning' : 'error';
          console.log(visual.statusBox('HEALTH', {
            'Status': { value: h.status.toUpperCase(), status: healthType },
            'Version': { value: h.version },
            'Uptime': { value: formatUptime(h.uptime) },
            'Mode': { value: mode.getModeDescription() },
          }));
        } else {
          console.log(visual.box('Health status unavailable', { title: 'HEALTH', borderColor: 'red' }));
        }

        console.log();

        // Cluster box
        if (cluster.status === 'fulfilled') {
          const c = cluster.value;
          if (c.enabled && c.nodes.length > 0) {
            const nodes = c.nodes.map(n => ({
              id: n.nodeId,
              role: n.isLeader ? 'LEADER' : 'FOLLOWER',
              status: n.isHealthy ? 'healthy' : 'unhealthy',
              isLeader: n.isLeader,
            }));
            console.log(visual.nodeStatus(nodes));
          } else {
            console.log(visual.statusBox('CLUSTER', {
              'Enabled': { value: c.enabled ? 'Yes' : 'No', status: c.enabled ? 'success' : 'info' },
              'Node ID': { value: c.nodeId },
              'Is Leader': { value: c.isLeader ? 'Yes' : 'No', status: c.isLeader ? 'success' : 'info' },
            }));
          }
        } else {
          console.log(visual.box('Cluster status unavailable', { title: 'CLUSTER', borderColor: 'yellow' }));
        }

        console.log();

        // Security box
        if (lockdown.status === 'fulfilled') {
          const l = lockdown.value;
          const securityStatus = l.status === 'NORMAL' ? 'success' :
                                l.status === 'LOCKDOWN' || l.status === 'PANIC' ? 'error' : 'warning';
          const securityData: Record<string, { value: string; status?: 'success' | 'warning' | 'error' | 'info' }> = {
            'Mode': { value: l.status, status: securityStatus },
          };
          if (l.reason) {
            securityData['Reason'] = { value: l.reason };
          }
          if (l.triggeredAt) {
            securityData['Since'] = { value: output.formatDate(l.triggeredAt) ?? 'Unknown' };
          }
          console.log(visual.statusBox('SECURITY', securityData));
        } else {
          console.log(visual.box('Security status unavailable', { title: 'SECURITY', borderColor: 'yellow' }));
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

