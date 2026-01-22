// Path: src/commands/secret/patch/diff.ts

/**
 * Diff generation for dry-run mode
 */

import chalk from 'chalk';
import type { DiffResult, DiffChange, AppliedOperation } from './types.js';
import { isPlainMode } from '../../../lib/output-mode.js';

// ============================================================================
// Diff Generation
// ============================================================================

/**
 * Generate a diff between two serialized values
 */
export function generateDiff(
  before: string,
  after: string,
  operations: AppliedOperation[]
): DiffResult {
  const changes: DiffChange[] = operations.map(op => {
    if (op.type === 'set') {
      if (op.previousValue === undefined) {
        return {
          type: 'add' as const,
          path: op.path,
          newValue: op.newValue,
        };
      }
      return {
        type: 'modify' as const,
        path: op.path,
        oldValue: op.previousValue,
        newValue: op.newValue,
      };
    } else {
      return {
        type: 'remove' as const,
        path: op.path,
        oldValue: op.previousValue,
      };
    }
  });

  return { before, after, changes };
}

// ============================================================================
// Diff Display
// ============================================================================

/**
 * Format a diff change for display
 */
function formatChange(change: DiffChange, plain: boolean): string {
  const formatValue = (val: unknown): string => {
    if (val === undefined) return 'undefined';
    if (val === null) return 'null';
    if (typeof val === 'string') return `"${val}"`;
    if (typeof val === 'object') return JSON.stringify(val);
    if (typeof val === 'number' || typeof val === 'boolean') return String(val);
    // For bigint, symbol, or other types
    return JSON.stringify(val);
  };

  switch (change.type) {
    case 'add':
      if (plain) {
        return `+ ${change.path} = ${formatValue(change.newValue)}`;
      }
      return chalk.green(`+ ${change.path} = ${formatValue(change.newValue)}`);

    case 'remove':
      if (plain) {
        return `- ${change.path} = ${formatValue(change.oldValue)}`;
      }
      return chalk.red(`- ${change.path} = ${formatValue(change.oldValue)}`);

    case 'modify':
      if (plain) {
        return `~ ${change.path}: ${formatValue(change.oldValue)} -> ${formatValue(change.newValue)}`;
      }
      return chalk.yellow(
        `~ ${change.path}: ` +
        chalk.red(formatValue(change.oldValue)) +
        chalk.gray(' -> ') +
        chalk.green(formatValue(change.newValue))
      );
  }
}

/**
 * Display a diff result
 */
export function displayDiff(diff: DiffResult): void {
  const plain = isPlainMode();

  console.log();
  if (plain) {
    console.log('=== Changes to be applied ===');
  } else {
    console.log(chalk.bold.cyan('Changes to be applied:'));
  }
  console.log();

  if (diff.changes.length === 0) {
    if (plain) {
      console.log('No changes detected');
    } else {
      console.log(chalk.dim('No changes detected'));
    }
    return;
  }

  for (const change of diff.changes) {
    console.log('  ' + formatChange(change, plain));
  }

  console.log();
  if (plain) {
    console.log('=== Before ===');
  } else {
    console.log(chalk.bold.dim('Before:'));
  }
  displayWithHighlight(diff.before, 'remove', plain);

  console.log();
  if (plain) {
    console.log('=== After ===');
  } else {
    console.log(chalk.bold.dim('After:'));
  }
  displayWithHighlight(diff.after, 'add', plain);
}

/**
 * Display content with syntax highlighting
 */
function displayWithHighlight(content: string, _type: 'add' | 'remove', plain: boolean): void {
  const lines = content.split('\n');

  for (const line of lines) {
    if (plain) {
      console.log(`  ${line}`);
    } else {
      // Simple syntax highlighting
      let highlighted = line;

      // Highlight keys
      highlighted = highlighted.replace(
        /^(\s*)("?[a-zA-Z_][a-zA-Z0-9_-]*"?)\s*:/,
        `$1${chalk.cyan('$2')}:`
      );

      // Highlight string values
      highlighted = highlighted.replace(
        /:\s*("(?:[^"\\]|\\.)*")/g,
        `: ${chalk.green('$1')}`
      );

      // Highlight numbers
      highlighted = highlighted.replace(
        /:\s*(-?\d+\.?\d*)/g,
        `: ${chalk.yellow('$1')}`
      );

      // Highlight booleans
      highlighted = highlighted.replace(
        /:\s*(true|false)/g,
        `: ${chalk.magenta('$1')}`
      );

      // Highlight null
      highlighted = highlighted.replace(
        /:\s*(null)/g,
        `: ${chalk.dim('$1')}`
      );

      console.log(`  ${highlighted}`);
    }
  }
}

// ============================================================================
// Summary Display
// ============================================================================

/**
 * Display a summary of operations to be applied
 */
export function displayOperationsSummary(operations: AppliedOperation[]): void {
  const plain = isPlainMode();
  const adds = operations.filter(o => o.type === 'set' && o.previousValue === undefined).length;
  const modifies = operations.filter(o => o.type === 'set' && o.previousValue !== undefined).length;
  const removes = operations.filter(o => o.type === 'unset').length;

  const parts: string[] = [];
  if (adds > 0) {
    parts.push(plain ? `${adds} add` : chalk.green(`${adds} add`));
  }
  if (modifies > 0) {
    parts.push(plain ? `${modifies} modify` : chalk.yellow(`${modifies} modify`));
  }
  if (removes > 0) {
    parts.push(plain ? `${removes} remove` : chalk.red(`${removes} remove`));
  }

  if (parts.length > 0) {
    console.log();
    if (plain) {
      console.log(`Summary: ${parts.join(', ')}`);
    } else {
      console.log(chalk.dim('Summary: ') + parts.join(chalk.dim(', ')));
    }
  }
}
