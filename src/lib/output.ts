// Path: znvault-cli/src/lib/output.ts
/**
 * Output Module
 *
 * Mode-aware output functions that render TUI components for interactive
 * terminals and plain text for CI/automation environments.
 */

import chalk from 'chalk';
import Table from 'cli-table3';
import React from 'react';
import { render } from 'ink';
import type { OutputFormat } from '../types/index.js';
import { isPlainMode } from './output-mode.js';
import {
  Table as TuiTable,
  type TableColumn,
} from '../tui/components/Table.js';
import {
  List as TuiList,
  type ListItem,
  Card,
  StatusIndicator,
  ProgressBar,
} from '../tui/components/List.js';

/**
 * Print success message
 */
export function success(message: string): void {
  if (isPlainMode()) {
    console.log(`[OK] ${message}`);
  } else {
    console.log(chalk.green('✓'), message);
  }
}

/**
 * Print error message
 */
export function error(message: string): void {
  if (isPlainMode()) {
    console.error(`[ERROR] ${message}`);
  } else {
    console.error(chalk.red('✗'), message);
  }
}

/**
 * Print warning message
 */
export function warn(message: string): void {
  if (isPlainMode()) {
    console.warn(`[WARN] ${message}`);
  } else {
    console.warn(chalk.yellow('⚠'), message);
  }
}

/**
 * Print info message
 */
export function info(message: string): void {
  if (isPlainMode()) {
    console.log(`[INFO] ${message}`);
  } else {
    console.log(chalk.blue('ℹ'), message);
  }
}

/**
 * Print data as JSON
 */
export function json(data: unknown): void {
  console.log(JSON.stringify(data, null, 2));
}

/**
 * Type for cell values in tables
 */
type CellValue = string | number | boolean | null | undefined;

/**
 * Format an array value to string safely
 */
function formatArrayValue(arr: unknown[]): string {
  return arr
    .map(item => {
      if (item === null || item === undefined) {
        return '-';
      }
      if (typeof item === 'object') {
        return JSON.stringify(item);
      }
      if (typeof item === 'string') {
        return item;
      }
      if (typeof item === 'number' || typeof item === 'boolean' || typeof item === 'bigint') {
        return String(item);
      }
      return JSON.stringify(item);
    })
    .join(', ');
}

/**
 * Format a cell value for table display
 */
function formatCell(value: CellValue, plain = false): string {
  if (value === null || value === undefined) {
    return plain ? '-' : chalk.dim('-');
  }
  if (typeof value === 'boolean') {
    if (plain) return value ? 'yes' : 'no';
    return value ? chalk.green('yes') : chalk.red('no');
  }
  if (typeof value === 'number') {
    return value.toLocaleString();
  }
  return value;
}

/**
 * Print data as a table (plain text version)
 */
function tablePlain(headers: string[], rows: CellValue[][]): void {
  // Calculate column widths
  const widths = headers.map((h, i) => {
    const dataWidth = rows.reduce((max, row) => {
      const val = formatCell(row[i], true);
      return Math.max(max, val.length);
    }, 0);
    return Math.max(h.length, dataWidth);
  });

  // Print header
  const headerLine = headers.map((h, i) => h.padEnd(widths[i])).join('  ');
  console.log(headerLine);
  console.log('-'.repeat(headerLine.length));

  // Print rows
  for (const row of rows) {
    const line = row.map((cell, i) => formatCell(cell, true).padEnd(widths[i])).join('  ');
    console.log(line);
  }
}

/**
 * Print data as a table (TUI version using cli-table3 with colors)
 */
function tableStyled(headers: string[], rows: CellValue[][]): void {
  const t = new Table({
    head: headers.map(h => chalk.cyan(h)),
    style: { head: [], border: [] },
  });

  for (const row of rows) {
    t.push(row.map(cell => formatCell(cell)));
  }

  console.log(t.toString());
}

/**
 * Print data as a table
 */
export function table(headers: string[], rows: CellValue[][]): void {
  if (isPlainMode()) {
    tablePlain(headers, rows);
  } else {
    tableStyled(headers, rows);
  }
}

/**
 * Print data as a rich TUI table using Ink
 * Use this for important data displays
 */
export function richTable(
  columns: TableColumn[],
  data: Array<Record<string, unknown>>,
  options: { title?: string; maxRows?: number } = {}
): void {
  if (isPlainMode()) {
    // Convert to plain table format
    const headers = columns.map(c => c.header);
    const rows = data.map(row =>
      columns.map(c => {
        const val = row[c.key];
        if (c.format) return c.format(val);
        if (val === null || val === undefined) return '-';
        if (typeof val === 'object') return JSON.stringify(val);
        if (typeof val === 'string') return val;
        return JSON.stringify(val);
      })
    );
    tablePlain(headers, rows as CellValue[][]);
    return;
  }

  // Use Ink TUI table
  const { unmount } = render(
    React.createElement(TuiTable, {
      columns,
      data,
      title: options.title,
      maxRows: options.maxRows,
    })
  );
  unmount();
}

/**
 * Format a value for key-value display
 */
function formatValue(value: unknown, plain = false): string {
  if (typeof value === 'boolean') {
    if (plain) return value ? 'yes' : 'no';
    return value ? chalk.green('yes') : chalk.red('no');
  }
  if (typeof value === 'number') {
    return plain ? value.toLocaleString() : chalk.yellow(value.toLocaleString());
  }
  return String(value);
}

/**
 * Print key-value pairs (plain text version)
 */
function keyValuePlain(data: Record<string, unknown>, indent: number = 0): void {
  const prefix = '  '.repeat(indent);
  for (const [key, value] of Object.entries(data)) {
    if (value === null || value === undefined) {
      console.log(`${prefix}${key}: -`);
    } else if (typeof value === 'object' && !Array.isArray(value)) {
      console.log(`${prefix}${key}:`);
      keyValuePlain(value as Record<string, unknown>, indent + 1);
    } else if (Array.isArray(value)) {
      console.log(`${prefix}${key}: ${formatArrayValue(value)}`);
    } else {
      console.log(`${prefix}${key}: ${formatValue(value, true)}`);
    }
  }
}

/**
 * Print key-value pairs (styled version)
 */
function keyValueStyled(data: Record<string, unknown>, indent: number = 0): void {
  const prefix = '  '.repeat(indent);
  for (const [key, value] of Object.entries(data)) {
    if (value === null || value === undefined) {
      console.log(`${prefix}${chalk.gray(key)}: ${chalk.dim('-')}`);
    } else if (typeof value === 'object' && !Array.isArray(value)) {
      console.log(`${prefix}${chalk.gray(key)}:`);
      keyValueStyled(value as Record<string, unknown>, indent + 1);
    } else if (Array.isArray(value)) {
      console.log(`${prefix}${chalk.gray(key)}: ${formatArrayValue(value)}`);
    } else {
      console.log(`${prefix}${chalk.gray(key)}: ${formatValue(value)}`);
    }
  }
}

/**
 * Print key-value pairs
 */
export function keyValue(data: Record<string, unknown>, indent: number = 0): void {
  if (isPlainMode()) {
    keyValuePlain(data, indent);
  } else {
    keyValueStyled(data, indent);
  }
}

/**
 * Print a rich list using Ink TUI
 */
export function richList(
  items: ListItem[],
  options: { title?: string; bordered?: boolean } = {}
): void {
  if (isPlainMode()) {
    // Convert to plain key-value format
    if (options.title) {
      console.log(options.title);
      console.log('-'.repeat(options.title.length));
    }
    for (const item of items) {
      const prefix = '  '.repeat(item.indent ?? 0);
      const value = item.value === null || item.value === undefined ? '-' : String(item.value);
      console.log(`${prefix}${item.label}: ${value}`);
    }
    return;
  }

  // Use Ink TUI list
  const { unmount } = render(
    React.createElement(TuiList, {
      items,
      title: options.title,
      bordered: options.bordered,
    })
  );
  unmount();
}

/**
 * Print a status card with title and data
 */
export function statusCard(
  title: string,
  items: ListItem[],
  borderColor?: string
): void {
  if (isPlainMode()) {
    console.log(`[${title}]`);
    for (const item of items) {
      const value = item.value === null || item.value === undefined ? '-' : String(item.value);
      console.log(`  ${item.label}: ${value}`);
    }
    return;
  }

  // Use Ink Card component with children
  const listElement = React.createElement(TuiList, { items });
  const { unmount } = render(
    React.createElement(Card, { title, borderColor, children: listElement })
  );
  unmount();
}

/**
 * Print a status indicator
 */
export function status(
  statusType: 'success' | 'warning' | 'error' | 'info' | 'pending',
  label: string,
  detail?: string
): void {
  if (isPlainMode()) {
    const statusText = statusType.toUpperCase();
    const detailPart = detail ? ` (${detail})` : '';
    console.log(`[${statusText}] ${label}${detailPart}`);
    return;
  }

  const { unmount } = render(
    React.createElement(StatusIndicator, { status: statusType, label, detail })
  );
  unmount();
}

/**
 * Print a progress bar
 */
export function progress(
  value: number,
  max = 100,
  label?: string
): void {
  if (isPlainMode()) {
    const percentage = Math.round((value / max) * 100);
    const labelPart = label ? `${label}: ` : '';
    console.log(`${labelPart}${value}/${max} (${percentage}%)`);
    return;
  }

  const { unmount } = render(
    React.createElement(ProgressBar, { value, max, label })
  );
  unmount();
}

/**
 * Format status with color
 */
export function formatStatus(status: string): string {
  if (isPlainMode()) {
    return status;
  }

  const statusLower = status.toLowerCase();
  if (['active', 'ok', 'healthy', 'normal', 'enabled'].includes(statusLower)) {
    return chalk.green(status);
  }
  if (['disabled', 'suspended', 'alert', 'restrict'].includes(statusLower)) {
    return chalk.yellow(status);
  }
  if (['locked', 'error', 'lockdown', 'panic', 'archived'].includes(statusLower)) {
    return chalk.red(status);
  }
  return status;
}

/**
 * Format boolean as yes/no
 */
export function formatBool(value: boolean): string {
  if (isPlainMode()) {
    return value ? 'yes' : 'no';
  }
  return value ? chalk.green('yes') : chalk.red('no');
}

/**
 * Format date/time
 */
export function formatDate(date: string | Date | undefined | null): string {
  if (date === null || date === undefined) {
    return isPlainMode() ? '-' : chalk.dim('-');
  }
  const d = typeof date === 'string' ? new Date(date) : date;
  return d.toLocaleString();
}

/**
 * Format relative time
 */
export function formatRelativeTime(date: string | Date): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHour = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHour / 24);

  if (diffSec < 60) return `${diffSec}s ago`;
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffHour < 24) return `${diffHour}h ago`;
  return `${diffDay}d ago`;
}

/**
 * Table configuration for printData function
 */
interface TableConfig {
  headers: string[];
  getRow: (item: unknown) => CellValue[];
}

/**
 * Print data in the specified format
 */
export function printData(
  data: unknown,
  format: OutputFormat,
  tableConfig?: TableConfig
): void {
  if (format === 'json') {
    json(data);
    return;
  }

  if (format === 'yaml') {
    // Simple YAML-like output
    if (Array.isArray(data)) {
      for (const item of data) {
        console.log('---');
        keyValue(item as Record<string, unknown>);
      }
    } else {
      keyValue(data as Record<string, unknown>);
    }
    return;
  }

  // Table format
  if (tableConfig && Array.isArray(data)) {
    table(tableConfig.headers, data.map(tableConfig.getRow));
  } else if (typeof data === 'object' && data !== null) {
    keyValue(data as Record<string, unknown>);
  } else {
    console.log(data);
  }
}

/**
 * Print a section header
 */
export function section(title: string): void {
  console.log();
  if (isPlainMode()) {
    console.log(title);
    console.log('='.repeat(title.length));
  } else {
    console.log(chalk.bold.underline(title));
  }
  console.log();
}

/**
 * Print a horizontal rule
 */
export function hr(): void {
  if (isPlainMode()) {
    console.log('-'.repeat(60));
  } else {
    console.log(chalk.gray('─'.repeat(60)));
  }
}

/**
 * Print an empty line
 */
export function newline(): void {
  console.log();
}

/**
 * Print the current profile indicator
 * Shows at the start of each command to indicate which profile is active
 */
export function profileIndicator(profileName: string, url: string): void {
  if (isPlainMode()) {
    console.log(`[profile: ${profileName} -> ${url}]`);
  } else {
    console.log(chalk.dim(`Using profile ${chalk.cyan(profileName)} → ${chalk.gray(url)}`));
  }
}

// Re-export mode detection for convenience
export { isPlainMode } from './output-mode.js';
export type { TableColumn } from '../tui/components/Table.js';
export type { ListItem } from '../tui/components/List.js';
