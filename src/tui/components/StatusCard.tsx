// Path: znvault-cli/src/tui/components/StatusCard.tsx
import React from 'react';
import { Box, Text } from 'ink';

type StatusType = 'success' | 'warning' | 'error' | 'info' | 'loading';

interface StatusCardProps {
  title: string;
  items: Array<{
    label: string;
    value: string;
    status?: StatusType;
  }>;
  width?: number;
}

function getStatusColor(status: StatusType): string {
  switch (status) {
    case 'success': return 'green';
    case 'warning': return 'yellow';
    case 'error': return 'red';
    case 'info': return 'blue';
    case 'loading': return 'gray';
    default: return 'white';
  }
}

function StatusIndicator({ status }: { status?: StatusType }): React.ReactElement {
  if (!status) return <Text> </Text>;

  const color = getStatusColor(status);
  return <Text color={color}>●</Text>;
}

export function StatusCard({ title, items, width }: StatusCardProps): React.ReactElement {
  const maxLabelLength = Math.max(...items.map(i => i.label.length));

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor="blue"
      paddingX={1}
      width={width}
    >
      <Box justifyContent="center" marginBottom={1}>
        <Text bold color="cyan">{title}</Text>
      </Box>

      {items.map((item, index) => (
        <Box key={index} justifyContent="space-between">
          <Text color="gray">{item.label.padEnd(maxLabelLength)}</Text>
          <Box>
            <StatusIndicator status={item.status} />
            <Text color={item.status ? getStatusColor(item.status) : 'white'}>
              {' '}{item.value}
            </Text>
          </Box>
        </Box>
      ))}
    </Box>
  );
}

interface NodeStatusCardProps {
  nodes: Array<{
    id: string;
    role: string;
    status: string;
    isLeader?: boolean;
  }>;
}

export function NodeStatusCard({ nodes }: NodeStatusCardProps): React.ReactElement {
  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor="blue"
      paddingX={1}
    >
      <Box justifyContent="center" marginBottom={1}>
        <Text bold color="cyan">CLUSTER NODES</Text>
      </Box>

      {nodes.map((node, index) => {
        const statusColor = node.status === 'healthy' || node.status === 'ok'
          ? 'green'
          : node.status === 'warning'
            ? 'yellow'
            : 'red';

        return (
          <Box key={index} gap={2}>
            <Text color={node.isLeader ? 'yellow' : 'gray'}>
              {node.isLeader ? '★' : '○'}
            </Text>
            <Text bold>{node.id.padEnd(12)}</Text>
            <Text color="gray">{node.role.padEnd(10)}</Text>
            <Text color={statusColor}>● {node.status.toUpperCase()}</Text>
          </Box>
        );
      })}
    </Box>
  );
}

interface SecurityStatusProps {
  mode: string;
  threatLevel?: number;
  reason?: string;
}

export function SecurityStatus({ mode, threatLevel = 0, reason }: SecurityStatusProps): React.ReactElement {
  const modeColor = mode === 'NORMAL'
    ? 'green'
    : mode === 'ALERT'
      ? 'yellow'
      : mode === 'RESTRICT'
        ? 'yellow'
        : 'red';

  const barLength = 10;
  const filledBars = Math.min(threatLevel, barLength);
  const emptyBars = barLength - filledBars;

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor={modeColor}
      paddingX={1}
    >
      <Box justifyContent="center" marginBottom={1}>
        <Text bold color="cyan">SECURITY STATUS</Text>
      </Box>

      <Box justifyContent="space-between">
        <Text color="gray">Mode</Text>
        <Text bold color={modeColor}>{mode}</Text>
      </Box>

      <Box justifyContent="space-between">
        <Text color="gray">Threat Level</Text>
        <Box>
          <Text color={modeColor}>{'█'.repeat(filledBars)}</Text>
          <Text color="gray">{'░'.repeat(emptyBars)}</Text>
          <Text color="gray"> {threatLevel}/10</Text>
        </Box>
      </Box>

      {reason && (
        <Box justifyContent="space-between">
          <Text color="gray">Reason</Text>
          <Text color="yellow">{reason}</Text>
        </Box>
      )}
    </Box>
  );
}
