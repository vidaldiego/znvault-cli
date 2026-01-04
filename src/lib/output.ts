import chalk from 'chalk';
import Table from 'cli-table3';
import type { OutputFormat } from '../types/index.js';

/**
 * Print success message
 */
export function success(message: string): void {
  console.log(chalk.green('✓'), message);
}

/**
 * Print error message
 */
export function error(message: string): void {
  console.error(chalk.red('✗'), message);
}

/**
 * Print warning message
 */
export function warn(message: string): void {
  console.warn(chalk.yellow('⚠'), message);
}

/**
 * Print info message
 */
export function info(message: string): void {
  console.log(chalk.blue('ℹ'), message);
}

/**
 * Print data as JSON
 */
export function json(data: unknown): void {
  console.log(JSON.stringify(data, null, 2));
}

/**
 * Print data as a table
 */
export function table(headers: string[], rows: (string | number | boolean | null | undefined)[][]): void {
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
 * Print key-value pairs
 */
export function keyValue(data: Record<string, unknown>, indent = 0): void {
  const prefix = '  '.repeat(indent);
  for (const [key, value] of Object.entries(data)) {
    if (value === null || value === undefined) {
      console.log(`${prefix}${chalk.gray(key)}: ${chalk.dim('-')}`);
    } else if (typeof value === 'object' && !Array.isArray(value)) {
      console.log(`${prefix}${chalk.gray(key)}:`);
      keyValue(value as Record<string, unknown>, indent + 1);
    } else if (Array.isArray(value)) {
      console.log(`${prefix}${chalk.gray(key)}: ${value.join(', ')}`);
    } else {
      console.log(`${prefix}${chalk.gray(key)}: ${formatValue(value)}`);
    }
  }
}

/**
 * Format a cell value for table display
 */
function formatCell(value: unknown): string {
  if (value === null || value === undefined) {
    return chalk.dim('-');
  }
  if (typeof value === 'boolean') {
    return value ? chalk.green('yes') : chalk.red('no');
  }
  if (typeof value === 'number') {
    return value.toLocaleString();
  }
  return String(value);
}

/**
 * Format a value for key-value display
 */
function formatValue(value: unknown): string {
  if (typeof value === 'boolean') {
    return value ? chalk.green('yes') : chalk.red('no');
  }
  if (typeof value === 'number') {
    return chalk.yellow(value.toLocaleString());
  }
  return String(value);
}

/**
 * Format status with color
 */
export function formatStatus(status: string): string {
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
  return value ? chalk.green('yes') : chalk.red('no');
}

/**
 * Format date/time
 */
export function formatDate(date: string | Date | undefined | null): string {
  if (!date) return chalk.dim('-');
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
 * Print data in the specified format
 */
export function printData(
  data: unknown,
  format: OutputFormat,
  tableConfig?: { headers: string[]; getRow: (item: unknown) => (string | number | boolean | null | undefined)[] }
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
  console.log(chalk.bold.underline(title));
  console.log();
}

/**
 * Print a horizontal rule
 */
export function hr(): void {
  console.log(chalk.gray('─'.repeat(60)));
}
