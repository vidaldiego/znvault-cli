// Path: znvault-cli/src/tui/components/List.tsx
/**
 * TUI List Component
 *
 * Beautiful list rendering with Ink for key-value pairs and item lists.
 */

import React from 'react';
import { Box, Text } from 'ink';

export interface ListItem {
  label: string;
  value: string | number | boolean | null | undefined;
  color?: string;
  indent?: number;
}

export interface ListProps {
  items: ListItem[];
  title?: string;
  bordered?: boolean;
  borderColor?: string;
  labelColor?: string;
  labelWidth?: number;
}

/**
 * Format value for display
 */
function formatValue(value: string | number | boolean | null | undefined): string {
  if (value === null || value === undefined) {
    return '-';
  }
  if (typeof value === 'boolean') {
    return value ? 'yes' : 'no';
  }
  if (typeof value === 'number') {
    return value.toLocaleString();
  }
  return value;
}

/**
 * Get color for value
 */
function getValueColor(value: unknown, explicitColor?: string): string | undefined {
  if (explicitColor) return explicitColor;

  if (typeof value === 'boolean') {
    return value ? 'green' : 'red';
  }

  if (typeof value === 'string') {
    const lower = value.toLowerCase();
    if (['active', 'ok', 'healthy', 'normal', 'enabled', 'yes', 'true', 'connected'].includes(lower)) {
      return 'green';
    }
    if (['disabled', 'suspended', 'alert', 'warning', 'restrict', 'pending'].includes(lower)) {
      return 'yellow';
    }
    if (['locked', 'error', 'lockdown', 'panic', 'failed', 'no', 'false', 'disconnected'].includes(lower)) {
      return 'red';
    }
  }

  return undefined;
}

export function List({
  items,
  title,
  bordered = false,
  borderColor = 'gray',
  labelColor = 'gray',
  labelWidth,
}: ListProps): React.ReactElement {
  // Calculate label width if not specified
  const calcLabelWidth = labelWidth ?? Math.max(...items.map(item => item.label.length)) + 2;

  const content = (
    <Box flexDirection="column">
      {items.map((item, index) => (
        <Box key={index} paddingLeft={item.indent ?? 0}>
          <Box width={calcLabelWidth - (item.indent ?? 0)}>
            <Text color={labelColor}>{item.label}:</Text>
          </Box>
          <Text color={getValueColor(item.value, item.color)}>
            {formatValue(item.value)}
          </Text>
        </Box>
      ))}
    </Box>
  );

  if (bordered) {
    return (
      <Box
        flexDirection="column"
        borderStyle="round"
        borderColor={borderColor}
        paddingX={2}
        paddingY={1}
        marginY={1}
      >
        {title && (
          <Box marginBottom={1}>
            <Text bold color="white">{title}</Text>
          </Box>
        )}
        {content}
      </Box>
    );
  }

  return (
    <Box flexDirection="column" marginY={1}>
      {title && (
        <Box marginBottom={1}>
          <Text bold color="white">{title}</Text>
        </Box>
      )}
      {content}
    </Box>
  );
}

/**
 * Status indicator with icon
 */
export interface StatusIndicatorProps {
  status: 'success' | 'warning' | 'error' | 'info' | 'pending';
  label: string;
  detail?: string;
}

export function StatusIndicator({ status, label, detail }: StatusIndicatorProps): React.ReactElement {
  const icons: Record<string, string> = {
    success: '●',
    warning: '●',
    error: '●',
    info: '●',
    pending: '○',
  };

  const colors: Record<string, string> = {
    success: 'green',
    warning: 'yellow',
    error: 'red',
    info: 'blue',
    pending: 'gray',
  };

  return (
    <Box gap={1}>
      <Text color={colors[status]}>{icons[status]}</Text>
      <Text>{label}</Text>
      {detail && <Text color="gray">({detail})</Text>}
    </Box>
  );
}

/**
 * Progress bar component
 */
export interface ProgressBarProps {
  value: number;
  max?: number;
  width?: number;
  showPercentage?: boolean;
  label?: string;
}

export function ProgressBar({
  value,
  max = 100,
  width = 20,
  showPercentage = true,
  label,
}: ProgressBarProps): React.ReactElement {
  const percentage = Math.min(100, Math.max(0, (value / max) * 100));
  const filled = Math.round((percentage / 100) * width);
  const empty = width - filled;

  // Color based on percentage
  let color = 'green';
  if (percentage > 80) color = 'red';
  else if (percentage > 60) color = 'yellow';

  return (
    <Box gap={1}>
      {label && <Text color="gray">{label}</Text>}
      <Text color={color}>{'█'.repeat(filled)}</Text>
      <Text color="gray">{'░'.repeat(empty)}</Text>
      {showPercentage && <Text color="gray">{percentage.toFixed(0)}%</Text>}
    </Box>
  );
}

/**
 * Badge component for tags/labels
 */
export interface BadgeProps {
  text: string;
  color?: string;
  bgColor?: string;
}

export function Badge({ text, color = 'white', bgColor }: BadgeProps): React.ReactElement {
  return (
    <Text color={color} backgroundColor={bgColor}>
      [{text}]
    </Text>
  );
}

/**
 * Card component for grouped information
 */
export interface CardProps {
  title: string;
  children: React.ReactNode;
  borderColor?: string;
  width?: number;
}

export function Card({
  title,
  children,
  borderColor = 'gray',
  width,
}: CardProps): React.ReactElement {
  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor={borderColor}
      paddingX={2}
      paddingY={1}
      marginY={1}
      width={width}
    >
      <Box marginBottom={1} justifyContent="center">
        <Text bold color="white">{title}</Text>
      </Box>
      {children}
    </Box>
  );
}
