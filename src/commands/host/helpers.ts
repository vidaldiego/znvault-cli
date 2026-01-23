// Path: src/commands/host/helpers.ts
// Helper functions for host management commands

import type { HostConfig, HostStatus } from './types.js';

/**
 * ANSI color codes
 */
const COLORS = {
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  gray: '\x1b[90m',
  reset: '\x1b[0m',
};

/**
 * Format host status with color
 */
export function formatStatus(status: HostStatus): string {
  switch (status) {
    case 'active':
      return `${COLORS.green}active${COLORS.reset}`;
    case 'disabled':
      return `${COLORS.red}disabled${COLORS.reset}`;
    case 'pending':
      return `${COLORS.yellow}pending${COLORS.reset}`;
    default:
      return status;
  }
}

/**
 * Format relative time (e.g., "5m ago", "2h ago", "3d ago")
 */
export function formatRelativeTime(dateString: string | undefined): string {
  if (!dateString) return '-';

  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffSecs = Math.floor(diffMs / 1000);
  const diffMins = Math.floor(diffSecs / 60);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffSecs < 60) return 'just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 30) return `${diffDays}d ago`;

  return date.toLocaleDateString();
}

/**
 * Format config summary for display
 */
export function formatConfigSummary(config: HostConfig['config']): string {
  const parts: string[] = [];

  const certCount = config.targets?.length ?? 0;
  const secretCount = config.secretTargets?.length ?? 0;
  const pluginCount = config.plugins?.filter((p) => p.enabled !== false).length ?? 0;

  if (certCount > 0) parts.push(`${certCount} cert(s)`);
  if (secretCount > 0) parts.push(`${secretCount} secret(s)`);
  if (pluginCount > 0) parts.push(`${pluginCount} plugin(s)`);
  if (config.exec) parts.push('exec mode');

  return parts.length > 0 ? parts.join(', ') : 'empty';
}

/**
 * Validate hostname format
 */
export function validateHostname(hostname: string): { valid: boolean; error?: string } {
  if (!hostname || hostname.length === 0) {
    return { valid: false, error: 'Hostname is required' };
  }

  // Basic hostname validation (RFC 1123)
  const hostnameRegex = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)*$/i;
  if (!hostnameRegex.test(hostname)) {
    return { valid: false, error: 'Invalid hostname format (must be valid DNS name)' };
  }

  if (hostname.length > 253) {
    return { valid: false, error: 'Hostname too long (max 253 characters)' };
  }

  return { valid: true };
}

/**
 * Parse duration string to ISO date (e.g., "1h", "24h", "7d")
 */
export function parseDuration(duration: string): Date {
  const match = duration.match(/^(\d+)([hmd])$/);
  if (!match) {
    throw new Error(`Invalid duration format: ${duration}. Use format like '1h', '24h', '7d'`);
  }

  const value = parseInt(match[1], 10);
  const unit = match[2];
  const now = new Date();

  switch (unit) {
    case 'h':
      now.setHours(now.getHours() + value);
      break;
    case 'd':
      now.setDate(now.getDate() + value);
      break;
    case 'm':
      now.setMinutes(now.getMinutes() + value);
      break;
    default:
      throw new Error(`Invalid duration unit: ${unit}`);
  }

  return now;
}

/**
 * Pretty print config as YAML-like format
 */
export function formatConfigYaml(config: HostConfig['config'], indent = 0): string {
  const lines: string[] = [];
  const prefix = '  '.repeat(indent);

  if (config.targets && config.targets.length > 0) {
    lines.push(`${prefix}targets:`);
    for (const target of config.targets) {
      lines.push(`${prefix}  - certId: ${target.certId}`);
      lines.push(`${prefix}    name: ${target.name}`);
      if (target.outputs.combined) {
        lines.push(`${prefix}    combined: ${target.outputs.combined}`);
      }
      if (target.outputs.cert) {
        lines.push(`${prefix}    cert: ${target.outputs.cert}`);
      }
      if (target.outputs.key) {
        lines.push(`${prefix}    key: ${target.outputs.key}`);
      }
    }
  }

  if (config.secretTargets && config.secretTargets.length > 0) {
    lines.push(`${prefix}secretTargets:`);
    for (const target of config.secretTargets) {
      lines.push(`${prefix}  - secretId: ${target.secretId}`);
      lines.push(`${prefix}    name: ${target.name}`);
      lines.push(`${prefix}    format: ${target.format}`);
      if (target.output) {
        lines.push(`${prefix}    output: ${target.output}`);
      }
    }
  }

  if (config.plugins && config.plugins.length > 0) {
    lines.push(`${prefix}plugins:`);
    for (const plugin of config.plugins) {
      const name = plugin.package ?? plugin.path ?? 'unknown';
      const enabled = plugin.enabled !== false ? 'enabled' : 'disabled';
      lines.push(`${prefix}  - ${name} (${enabled})`);
    }
  }

  if (config.exec) {
    lines.push(`${prefix}exec:`);
    lines.push(`${prefix}  command: ${config.exec.command.join(' ')}`);
    if (config.exec.secrets.length > 0) {
      lines.push(`${prefix}  secrets: ${config.exec.secrets.length} mapping(s)`);
    }
  }

  if (config.globalReloadCmd) {
    lines.push(`${prefix}globalReloadCmd: ${config.globalReloadCmd}`);
  }

  if (config.pollInterval) {
    lines.push(`${prefix}pollInterval: ${config.pollInterval}s`);
  }

  return lines.length > 0 ? lines.join('\n') : `${prefix}(empty config)`;
}

/**
 * Print host details in a formatted way
 */
export function printHostDetails(host: HostConfig): void {
  console.log();
  console.log(`${COLORS.cyan}Host: ${host.hostname}${COLORS.reset}`);
  console.log('─'.repeat(50));
  console.log(`  ID:          ${host.id}`);
  console.log(`  Status:      ${formatStatus(host.status)}`);
  console.log(`  Tenant:      ${host.tenantId}`);
  console.log(`  Version:     ${host.version}`);
  if (host.description) {
    console.log(`  Description: ${host.description}`);
  }
  if (host.managedKeyName) {
    console.log(`  Managed Key: ${host.managedKeyName}`);
  }
  console.log(`  Created:     ${formatRelativeTime(host.createdAt)} by ${host.createdBy}`);
  console.log(`  Updated:     ${formatRelativeTime(host.updatedAt)}${host.updatedBy ? ` by ${host.updatedBy}` : ''}`);
  console.log(`  Last Pull:   ${formatRelativeTime(host.lastPulledAt)}`);
  if (host.lastPulledByAgentId) {
    console.log(`  Pulled By:   ${host.lastPulledByAgentId.substring(0, 8)}...`);
  }
  console.log();
  console.log(`${COLORS.gray}Configuration:${COLORS.reset}`);
  console.log(formatConfigYaml(host.config, 1));
  console.log();
}
