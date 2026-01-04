import { Command } from 'commander';
import ora from 'ora';
import { client } from '../lib/client.js';
import * as mode from '../lib/mode.js';
import { promptConfirm } from '../lib/prompts.js';
import * as output from '../lib/output.js';

export function registerClusterCommands(program: Command): void {
  const cluster = program
    .command('cluster')
    .description('Cluster management commands');

  // Cluster status
  cluster
    .command('status')
    .description('Show cluster status')
    .option('--json', 'Output as JSON')
    .action(async (options) => {
      const spinner = ora('Getting cluster status...').start();

      try {
        const status = await mode.clusterStatus();
        spinner.stop();

        if (options.json) {
          output.json(status);
          return;
        }

        output.section('Cluster Status');

        output.keyValue({
          'Mode': mode.getModeDescription(),
          'Enabled': status.enabled,
          'Node ID': status.nodeId,
          'Is Leader': status.isLeader,
          'Leader Node': status.leaderNodeId || 'None',
        });

        if (status.nodes && status.nodes.length > 0) {
          output.section('Nodes');
          output.table(
            ['Node ID', 'Host', 'Port', 'Leader', 'Status', 'Last Heartbeat'],
            status.nodes.map(node => [
              node.nodeId,
              node.host,
              node.port,
              node.isLeader,
              node.isHealthy ? 'healthy' : 'unhealthy',
              node.lastHeartbeat ? output.formatRelativeTime(node.lastHeartbeat) : '-',
            ])
          );
        }

        if (status.infrastructure) {
          output.section('Infrastructure');
          if (status.infrastructure.postgres) {
            console.log(`  PostgreSQL: ${output.formatStatus(status.infrastructure.postgres.status)}`);
            if (status.infrastructure.postgres.primary) {
              console.log(`    Primary: ${status.infrastructure.postgres.primary}`);
            }
          }
          if (status.infrastructure.redis) {
            console.log(`  Redis: ${output.formatStatus(status.infrastructure.redis.status)}`);
          }
          if (status.infrastructure.etcd) {
            console.log(`  etcd: ${output.formatStatus(status.infrastructure.etcd.status)}`);
          }
        }

        console.log();
      } catch (err) {
        spinner.fail('Failed to get cluster status');
        output.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
      } finally {
        await mode.closeLocalClient();
      }
    });

  // Cluster takeover (API only)
  cluster
    .command('takeover')
    .description('Force this node to become cluster leader')
    .option('-y, --yes', 'Skip confirmation')
    .action(async (options) => {
      if (mode.getMode() === 'local') {
        output.error('Cluster takeover requires API mode with authentication');
        output.info('Use: znvault login first, or set ZNVAULT_API_KEY');
        process.exit(1);
      }

      try {
        if (!options.yes) {
          const confirmed = await promptConfirm(
            'Are you sure you want to force a leadership takeover?'
          );
          if (!confirmed) {
            output.info('Takeover cancelled');
            return;
          }
        }

        const spinner = ora('Taking over leadership...').start();

        try {
          const result = await client.clusterTakeover();
          spinner.succeed('Leadership takeover successful');
          output.keyValue({
            'Success': result.success,
            'Message': result.message,
            'Node ID': result.nodeId,
          });
        } catch (err) {
          spinner.fail('Takeover failed');
          throw err;
        }
      } catch (err) {
        output.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    });

  // Cluster promote (API only)
  cluster
    .command('promote <nodeId>')
    .description('Promote a specific node to become leader')
    .option('-y, --yes', 'Skip confirmation')
    .action(async (nodeId, options) => {
      if (mode.getMode() === 'local') {
        output.error('Cluster promote requires API mode with authentication');
        output.info('Use: znvault login first, or set ZNVAULT_API_KEY');
        process.exit(1);
      }

      try {
        if (!options.yes) {
          const confirmed = await promptConfirm(
            `Are you sure you want to promote node '${nodeId}' to leader?`
          );
          if (!confirmed) {
            output.info('Promotion cancelled');
            return;
          }
        }

        const spinner = ora(`Promoting node ${nodeId}...`).start();

        try {
          const result = await client.clusterPromote(nodeId);
          spinner.succeed('Node promoted successfully');
          output.keyValue({
            'Success': result.success,
            'Message': result.message,
          });
        } catch (err) {
          spinner.fail('Promotion failed');
          throw err;
        }
      } catch (err) {
        output.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    });

  // Cluster release (API only)
  cluster
    .command('release')
    .description('Release leadership from this node')
    .option('-y, --yes', 'Skip confirmation')
    .action(async (options) => {
      if (mode.getMode() === 'local') {
        output.error('Cluster release requires API mode with authentication');
        output.info('Use: znvault login first, or set ZNVAULT_API_KEY');
        process.exit(1);
      }

      try {
        if (!options.yes) {
          const confirmed = await promptConfirm(
            'Are you sure you want to release leadership?'
          );
          if (!confirmed) {
            output.info('Release cancelled');
            return;
          }
        }

        const spinner = ora('Releasing leadership...').start();

        try {
          const result = await client.clusterRelease();
          spinner.succeed('Leadership released');
          output.keyValue({
            'Success': result.success,
            'Message': result.message,
          });
        } catch (err) {
          spinner.fail('Release failed');
          throw err;
        }
      } catch (err) {
        output.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    });

  // Cluster maintenance (API only)
  cluster
    .command('maintenance <action>')
    .description('Enable or disable maintenance mode (enable|disable)')
    .option('-y, --yes', 'Skip confirmation')
    .action(async (action, options) => {
      if (mode.getMode() === 'local') {
        output.error('Cluster maintenance requires API mode with authentication');
        output.info('Use: znvault login first, or set ZNVAULT_API_KEY');
        process.exit(1);
      }

      try {
        if (!['enable', 'disable'].includes(action)) {
          output.error('Action must be "enable" or "disable"');
          process.exit(1);
        }

        const enable = action === 'enable';

        if (!options.yes) {
          const confirmed = await promptConfirm(
            `Are you sure you want to ${action} maintenance mode?`
          );
          if (!confirmed) {
            output.info('Cancelled');
            return;
          }
        }

        const spinner = ora(`${enable ? 'Enabling' : 'Disabling'} maintenance mode...`).start();

        try {
          const result = await client.clusterMaintenance(enable);
          spinner.succeed(`Maintenance mode ${enable ? 'enabled' : 'disabled'}`);
          output.keyValue({
            'Success': result.success,
            'Maintenance Mode': result.maintenanceMode,
          });
        } catch (err) {
          spinner.fail(`Failed to ${action} maintenance mode`);
          throw err;
        }
      } catch (err) {
        output.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    });
}
