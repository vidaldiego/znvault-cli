// Path: znvault-cli/src/tui/components/Table.tsx
/**
 * TUI Table Component
 *
 * Beautiful table rendering with Ink for interactive terminals.
 */

import React from 'react';
import { Box, Text } from 'ink';

export interface TableColumn {
  header: string;
  key: string;
  width?: number;
  align?: 'left' | 'center' | 'right';
  color?: string;
  format?: (value: unknown) => string;
}

export interface TableProps {
  columns: TableColumn[];
  data: Array<Record<string, unknown>>;
  title?: string;
  borderColor?: string;
  headerColor?: string;
  maxRows?: number;
  emptyMessage?: string;
}

/**
 * Format cell value for display
 */
function formatCellValue(value: unknown, format?: (v: unknown) => string): string {
  if (format) {
    return format(value);
  }
  if (value === null || value === undefined) {
    return '-';
  }
  if (typeof value === 'boolean') {
    return value ? 'yes' : 'no';
  }
  if (typeof value === 'number') {
    return value.toLocaleString();
  }
  if (Array.isArray(value)) {
    return value.map(v => (typeof v === 'object' ? JSON.stringify(v) : String(v))).join(', ');
  }
  if (typeof value === 'object') {
    return JSON.stringify(value);
  }
  if (typeof value === 'string') {
    return value;
  }
  // For any other primitive types
  return JSON.stringify(value);
}

/**
 * Get color for cell based on value
 */
function getCellColor(value: unknown, column: TableColumn): string | undefined {
  if (column.color) {
    return column.color;
  }

  // Auto-color for boolean values
  if (typeof value === 'boolean') {
    return value ? 'green' : 'red';
  }

  // Auto-color for status-like strings
  if (typeof value === 'string') {
    const lower = value.toLowerCase();
    if (['active', 'ok', 'healthy', 'normal', 'enabled', 'success', 'connected'].includes(lower)) {
      return 'green';
    }
    if (['disabled', 'suspended', 'alert', 'warning', 'restrict', 'pending'].includes(lower)) {
      return 'yellow';
    }
    if (['locked', 'error', 'lockdown', 'panic', 'failed', 'disconnected', 'expired'].includes(lower)) {
      return 'red';
    }
  }

  return undefined;
}

/**
 * Truncate text to fit width
 */
function truncate(text: string, width: number): string {
  if (text.length <= width) {
    return text;
  }
  return text.slice(0, width - 1) + '…';
}

/**
 * Pad text based on alignment
 */
function padText(text: string, width: number, align: 'left' | 'center' | 'right' = 'left'): string {
  const truncated = truncate(text, width);
  const padding = width - truncated.length;

  if (padding <= 0) return truncated;

  switch (align) {
    case 'right':
      return ' '.repeat(padding) + truncated;
    case 'center': {
      const leftPad = Math.floor(padding / 2);
      const rightPad = padding - leftPad;
      return ' '.repeat(leftPad) + truncated + ' '.repeat(rightPad);
    }
    default:
      return truncated + ' '.repeat(padding);
  }
}

export function Table({
  columns,
  data,
  title,
  borderColor = 'gray',
  headerColor = 'cyan',
  maxRows,
  emptyMessage = 'No data',
}: TableProps): React.ReactElement {
  // Calculate column widths
  const colWidths = columns.map(col => {
    if (col.width) return col.width;

    // Auto-calculate based on content
    const headerLen = col.header.length;
    const maxDataLen = data.reduce((max, row) => {
      const val = formatCellValue(row[col.key], col.format);
      return Math.max(max, val.length);
    }, 0);

    return Math.min(Math.max(headerLen, maxDataLen) + 2, 40);
  });

  const totalWidth = colWidths.reduce((sum, w) => sum + w, 0) + columns.length + 1;

  // Render horizontal border
  const renderBorder = (char: string, left: string, mid: string, right: string): React.ReactElement => (
    <Text color={borderColor}>
      {left}
      {colWidths.map((w, i) => char.repeat(w) + (i < colWidths.length - 1 ? mid : '')).join('')}
      {right}
    </Text>
  );

  const displayData = maxRows !== undefined && maxRows > 0 ? data.slice(0, maxRows) : data;
  const remainingCount = maxRows !== undefined ? data.length - maxRows : 0;
  const hasMore = remainingCount > 0;

  return (
    <Box flexDirection="column" marginY={1}>
      {/* Title */}
      {title && (
        <Box marginBottom={1}>
          <Text bold color="white">{title}</Text>
        </Box>
      )}

      {/* Top border */}
      {renderBorder('─', '┌', '┬', '┐')}

      {/* Header row */}
      <Box>
        <Text color={borderColor}>│</Text>
        {columns.map((col, i) => (
          <React.Fragment key={col.key}>
            <Text bold color={headerColor}>
              {padText(col.header, colWidths[i], col.align)}
            </Text>
            <Text color={borderColor}>│</Text>
          </React.Fragment>
        ))}
      </Box>

      {/* Header separator */}
      {renderBorder('─', '├', '┼', '┤')}

      {/* Data rows */}
      {displayData.length === 0 ? (
        <Box>
          <Text color={borderColor}>│</Text>
          <Text color="gray">{padText(emptyMessage, totalWidth - 2, 'center')}</Text>
          <Text color={borderColor}>│</Text>
        </Box>
      ) : (
        displayData.map((row, rowIndex) => (
          <Box key={rowIndex}>
            <Text color={borderColor}>│</Text>
            {columns.map((col, colIndex) => {
              const value = row[col.key];
              const formatted = formatCellValue(value, col.format);
              const color = getCellColor(value, col);

              return (
                <React.Fragment key={col.key}>
                  <Text color={color}>
                    {padText(formatted, colWidths[colIndex], col.align)}
                  </Text>
                  <Text color={borderColor}>│</Text>
                </React.Fragment>
              );
            })}
          </Box>
        ))
      )}

      {/* Bottom border */}
      {renderBorder('─', '└', '┴', '┘')}

      {/* More indicator */}
      {hasMore && (
        <Text color="gray" dimColor>
          ... and {remainingCount} more
        </Text>
      )}
    </Box>
  );
}

/**
 * Simple table without borders for compact display
 */
export function SimpleTable({
  columns,
  data,
  maxRows,
}: Omit<TableProps, 'borderColor' | 'title'>): React.ReactElement {
  const displayData = maxRows ? data.slice(0, maxRows) : data;

  return (
    <Box flexDirection="column">
      {/* Header */}
      <Box gap={2}>
        {columns.map(col => (
          <Text key={col.key} bold color="cyan">
            {col.header}
          </Text>
        ))}
      </Box>

      {/* Data */}
      {displayData.map((row, i) => (
        <Box key={i} gap={2}>
          {columns.map(col => {
            const value = row[col.key];
            const formatted = formatCellValue(value, col.format);
            const color = getCellColor(value, col);

            return (
              <Text key={col.key} color={color}>
                {formatted}
              </Text>
            );
          })}
        </Box>
      ))}
    </Box>
  );
}
