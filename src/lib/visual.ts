// Path: znvault-cli/src/lib/visual.ts
import boxen, { type Options as BoxenOptions } from 'boxen';
import figlet from 'figlet';
import gradient from 'gradient-string';
import chalk from 'chalk';
import { isPlainMode } from './output-mode.js';

/**
 * Visual enhancement utilities for CLI output
 * Supports both TUI (rich) and plain text modes
 */

// Custom gradient for ZnVault branding
const vaultGradient = gradient(['#00d4ff', '#0066ff', '#9933ff']);
const successGradient = gradient(['#00ff88', '#00d4ff']);
const warningGradient = gradient(['#ffcc00', '#ff6600']);
const dangerGradient = gradient(['#ff6600', '#ff0033']);

/**
 * Generate ASCII art banner
 */
export function banner(text: string, subtitle?: string): string {
  if (isPlainMode()) {
    const line = '='.repeat(text.length + 4);
    const result = `${line}\n  ${text}  \n${line}`;
    return subtitle ? `${result}\n${subtitle}` : result;
  }

  const art = figlet.textSync(text, {
    font: 'Small',
    horizontalLayout: 'default',
  });

  const gradientArt = vaultGradient(art);

  if (subtitle) {
    return `${gradientArt}\n${chalk.dim(subtitle)}`;
  }

  return gradientArt;
}

/**
 * Create a bordered box with optional title
 */
export function box(
  content: string,
  options?: {
    title?: string;
    titleAlignment?: 'left' | 'center' | 'right';
    borderColor?: string;
    padding?: number;
    borderStyle?: BoxenOptions['borderStyle'];
  }
): string {
  if (isPlainMode()) {
    const lines = content.split('\n');
    const maxWidth = Math.max(...lines.map(l => l.length), (options?.title?.length ?? 0) + 4);
    const border = '-'.repeat(maxWidth + 4);

    let result = border + '\n';
    if (options?.title) {
      result += `| ${options.title.padEnd(maxWidth + 1)}|\n`;
      result += `|${'-'.repeat(maxWidth + 2)}|\n`;
    }
    for (const line of lines) {
      result += `| ${line.padEnd(maxWidth + 1)}|\n`;
    }
    result += border;
    return result;
  }

  const boxOptions: BoxenOptions = {
    padding: options?.padding ?? 1,
    margin: { top: 0, bottom: 0, left: 0, right: 0 },
    borderStyle: options?.borderStyle ?? 'round',
    borderColor: options?.borderColor ?? 'cyan',
    title: options?.title,
    titleAlignment: options?.titleAlignment ?? 'center',
  };

  return boxen(content, boxOptions);
}

/**
 * Create a status indicator with colored dot
 */
export function statusIndicator(
  status: string,
  type: 'success' | 'warning' | 'error' | 'info' = 'info'
): string {
  if (isPlainMode()) {
    const symbols = {
      success: '[OK]',
      warning: '[WARN]',
      error: '[ERR]',
      info: '[INFO]',
    };
    return `${symbols[type]} ${status}`;
  }

  const colors = {
    success: chalk.green('●'),
    warning: chalk.yellow('●'),
    error: chalk.red('●'),
    info: chalk.blue('●'),
  };

  return `${colors[type]} ${status}`;
}

/**
 * Create a status box with key-value pairs
 */
export function statusBox(
  title: string,
  data: Record<string, { value: string; status?: 'success' | 'warning' | 'error' | 'info' }>
): string {
  const maxKeyLength = Math.max(...Object.keys(data).map(k => k.length));

  if (isPlainMode()) {
    let result = `[${title}]\n`;
    for (const [key, { value, status }] of Object.entries(data)) {
      const paddedKey = key.padEnd(maxKeyLength);
      const statusText = status ? `[${status.toUpperCase()}]` : '';
      result += `  ${paddedKey}: ${value} ${statusText}\n`;
    }
    return result.trimEnd();
  }

  const lines = Object.entries(data).map(([key, { value, status }]) => {
    const paddedKey = key.padEnd(maxKeyLength);
    const indicator = status ? statusIndicator(value, status) : value;
    return `  ${chalk.dim(paddedKey)}  ${indicator}`;
  });

  return box(lines.join('\n'), {
    title,
    borderColor: 'cyan',
    titleAlignment: 'center',
  });
}

/**
 * Create a multi-column layout
 */
export function columns(cols: string[], gap = 4): string {
  const lines: string[][] = cols.map(col => col.split('\n'));
  const maxLines = Math.max(...lines.map(l => l.length));

  // Pad each column to have the same number of lines
  const paddedLines = lines.map(colLines => {
    const maxWidth = Math.max(...colLines.map(l => stripAnsi(l).length));
    while (colLines.length < maxLines) {
      colLines.push(' '.repeat(maxWidth));
    }
    return colLines.map(l => l.padEnd(maxWidth + (maxWidth - stripAnsi(l).length)));
  });

  // Join columns horizontally
  const result: string[] = [];
  for (let i = 0; i < maxLines; i++) {
    result.push(paddedLines.map(col => col[i]).join(' '.repeat(gap)));
  }

  return result.join('\n');
}

/**
 * Strip ANSI codes for length calculations
 */
function stripAnsi(str: string): string {
  // eslint-disable-next-line no-control-regex
  return str.replace(/\x1B\[[0-9;]*[a-zA-Z]/g, '');
}

/**
 * Create a section header
 */
export function sectionHeader(title: string): string {
  if (isPlainMode()) {
    return `\n=== ${title} ${'='.repeat(Math.max(0, 50 - title.length))}\n`;
  }
  return `\n${chalk.bold.cyan('━'.repeat(3))} ${chalk.bold(title)} ${chalk.bold.cyan('━'.repeat(50 - title.length))}\n`;
}

/**
 * Create a horizontal rule
 */
export function hr(char = '─', length = 60): string {
  if (isPlainMode()) {
    return '-'.repeat(length);
  }
  return chalk.dim(char.repeat(length));
}

/**
 * Apply gradient to text based on type
 */
export function gradientText(
  text: string,
  type: 'brand' | 'success' | 'warning' | 'danger' = 'brand'
): string {
  if (isPlainMode()) {
    return text;
  }

  const gradients = {
    brand: vaultGradient,
    success: successGradient,
    warning: warningGradient,
    danger: dangerGradient,
  };

  return gradients[type](text);
}

/**
 * Create a node status display for cluster view
 */
export function nodeStatus(
  nodes: Array<{
    id: string;
    role: string;
    status: string;
    isLeader?: boolean;
  }>
): string {
  if (isPlainMode()) {
    let result = '[CLUSTER NODES]\n';
    for (const node of nodes) {
      const leaderMark = node.isLeader ? '*' : ' ';
      result += `  ${leaderMark} ${node.id.padEnd(12)} ${node.role.padEnd(10)} ${node.status.toUpperCase()}\n`;
    }
    return result.trimEnd();
  }

  const lines = nodes.map(node => {
    const statusColor =
      node.status === 'ok' || node.status === 'healthy'
        ? chalk.green
        : node.status === 'warning'
          ? chalk.yellow
          : chalk.red;

    const roleIndicator = node.isLeader
      ? chalk.yellow.bold('★')
      : chalk.dim('○');

    const statusDot = statusColor('●');

    return `  ${roleIndicator} ${chalk.bold(node.id.padEnd(12))} ${node.role.padEnd(10)} ${statusDot} ${node.status.toUpperCase()}`;
  });

  return box(lines.join('\n'), {
    title: 'CLUSTER NODES',
    borderColor: 'blue',
  });
}

/**
 * Create a threat level indicator
 */
export function threatLevel(
  level: number,
  mode: string
): string {
  if (isPlainMode()) {
    const levelBar = '#'.repeat(Math.min(level, 10)) + '-'.repeat(10 - Math.min(level, 10));
    return `${mode.toUpperCase()} [${levelBar}] ${level}/10`;
  }

  const modeColors: Record<string, typeof chalk> = {
    normal: chalk.green,
    alert: chalk.yellow,
    restrict: chalk.hex('#ff8800'),
    lockdown: chalk.red,
    panic: chalk.bgRed.white,
  };

  const colorFn = modeColors[mode.toLowerCase()] ?? chalk.white;
  const levelBar = '█'.repeat(Math.min(level, 10)) + '░'.repeat(10 - Math.min(level, 10));

  return `${colorFn.bold(mode.toUpperCase())} [${colorFn(levelBar)}] ${level}/10`;
}

/**
 * Create a progress bar
 */
export function progressBar(
  current: number,
  total: number,
  width = 30,
  options?: { showPercent?: boolean; color?: string }
): string {
  const percent = Math.min(Math.round((current / total) * 100), 100);
  const filled = Math.round((percent / 100) * width);
  const empty = width - filled;

  if (isPlainMode()) {
    const bar = '#'.repeat(filled) + '-'.repeat(empty);
    if (options?.showPercent !== false) {
      return `[${bar}] ${percent}%`;
    }
    return `[${bar}]`;
  }

  const colorFn = options?.color ? chalk.hex(options.color) : chalk.cyan;
  const bar = colorFn('█'.repeat(filled)) + chalk.dim('░'.repeat(empty));

  if (options?.showPercent !== false) {
    return `${bar} ${percent}%`;
  }

  return bar;
}

/**
 * Create the main CLI banner shown on startup
 */
export function cliBanner(version: string): string {
  if (isPlainMode()) {
    const line = '='.repeat(50);
    return `\n${line}\n  ZN-VAULT  v${version}\n  Enterprise Secrets Management CLI\n${line}\n`;
  }

  const art = figlet.textSync('ZN-VAULT', {
    font: 'Small',
    horizontalLayout: 'default',
  });

  const gradientArt = vaultGradient(art);
  const subtitle = chalk.dim(`  Enterprise Secrets Management CLI  v${version}`);
  const separator = chalk.cyan('─'.repeat(50));

  return `\n${gradientArt}\n${subtitle}\n${separator}\n`;
}

/**
 * Show a quick help hint
 */
export function helpHint(): string {
  if (isPlainMode()) {
    return '\nRun "znvault --help" for available commands\n';
  }
  return chalk.dim('\nRun ') + chalk.cyan('znvault --help') + chalk.dim(' for available commands\n');
}
