// Path: znvault-cli/src/tui/screens/Dashboard.tsx
import React from 'react';
import { Box, Text } from 'ink';
import { Header } from '../components/Header.js';
import { StatusCard, NodeStatusCard, SecurityStatus } from '../components/StatusCard.js';
import type { DashboardData } from '../hooks/useApi.js';

interface DashboardProps {
  data: DashboardData;
  onRefresh: () => Promise<void>;
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

export function Dashboard({ data }: DashboardProps): React.ReactElement {
  const { health, cluster, lockdown, loading, error, lastUpdated } = data;

  if (loading && !health) {
    return (
      <Box flexDirection="column">
        <Header lastUpdated={lastUpdated} />
        <Box justifyContent="center" padding={2}>
          <Text color="yellow">Loading dashboard data...</Text>
        </Box>
      </Box>
    );
  }

  if (error && !health) {
    return (
      <Box flexDirection="column">
        <Header lastUpdated={lastUpdated} />
        <Box
          borderStyle="round"
          borderColor="red"
          padding={1}
          justifyContent="center"
        >
          <Text color="red">Error: {error}</Text>
        </Box>
      </Box>
    );
  }

  // Build health items
  const healthItems: Array<{ label: string; value: string; status?: 'success' | 'warning' | 'error' | 'info' }> = [];

  if (health) {
    const healthStatus = health.status === 'ok' ? 'success' : health.status === 'degraded' ? 'warning' : 'error';
    healthItems.push(
      { label: 'Status', value: health.status.toUpperCase(), status: healthStatus },
      { label: 'Version', value: health.version },
      { label: 'Uptime', value: formatUptime(health.uptime) },
    );

    if (health.database) {
      const dbStatus = health.database.status === 'connected' ? 'success' : 'error';
      healthItems.push({
        label: 'Database',
        value: health.database.status === 'connected' ? 'Connected' : health.database.status,
        status: dbStatus,
      });
    }

    if (health.redis) {
      const redisStatus = health.redis.status === 'connected' ? 'success' : 'error';
      healthItems.push({
        label: 'Redis',
        value: health.redis.status === 'connected' ? 'Connected' : health.redis.status,
        status: redisStatus,
      });
    }
  }

  // Build cluster nodes (nodes may be undefined when cluster is not HA-enabled)
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
  const clusterNodes = cluster?.nodes?.map(n => ({
    id: n.nodeId,
    role: n.isLeader ? 'LEADER' : 'FOLLOWER',
    status: n.isHealthy ? 'healthy' : 'unhealthy',
    isLeader: n.isLeader,
  })) ?? [];

  // Security data
  const securityMode = lockdown?.status ?? 'UNKNOWN';
  const threatLevel = lockdown?.escalationCount ?? 0;

  return (
    <Box flexDirection="column">
      <Header
        version={health?.version}
        lastUpdated={lastUpdated}
      />

      {/* Main content area */}
      <Box gap={1}>
        {/* Left column: Health */}
        <Box flexDirection="column" flexGrow={1}>
          <StatusCard
            title="SERVER HEALTH"
            items={healthItems}
          />
        </Box>

        {/* Right column: Cluster + Security */}
        <Box flexDirection="column" flexGrow={1} gap={1}>
          {cluster?.enabled && clusterNodes.length > 0 ? (
            <NodeStatusCard nodes={clusterNodes} />
          ) : (
            <StatusCard
              title="CLUSTER"
              items={[
                {
                  label: 'Enabled',
                  value: cluster?.enabled ? 'Yes' : 'No',
                  status: cluster?.enabled ? 'success' : 'info',
                },
                { label: 'Node ID', value: cluster?.nodeId ?? 'N/A' },
              ]}
            />
          )}

          <SecurityStatus
            mode={securityMode}
            threatLevel={threatLevel}
            reason={lockdown?.reason}
          />
        </Box>
      </Box>

      {/* Footer with loading indicator */}
      {loading && (
        <Box marginTop={1}>
          <Text color="gray" dimColor>Refreshing...</Text>
        </Box>
      )}
    </Box>
  );
}
