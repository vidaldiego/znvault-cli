// Path: src/commands/apikey/helpers.ts

/**
 * Helper functions for API key commands
 */

import type { ApiKeyConditions } from './types.js';

// Re-export common formatters from centralized location
export { formatDate, formatSecondsToHuman } from '../../lib/format-helpers.js';

/**
 * Detect whether the currently-invoked apikey handler lives under the
 * `superadmin` namespace by walking the Commander parent chain.
 *
 * Commander passes the Command instance as the last argument to action
 * callbacks; handlers call this with that instance (typed loosely to
 * avoid coupling to commander internals).
 *
 * This is the runtime equivalent to `isSuperadminContext()` and avoids
 * the registration-vs-invocation timing gap that bit kms/sso.
 */
interface CommanderLike {
  name(): string;
  parent: CommanderLike | null;
}

export function apiKeyAsSuperadmin(cmd: CommanderLike | null | undefined): boolean {
  let node: CommanderLike | null | undefined = cmd;
  while (node) {
    if (node.name() === 'superadmin') return true;
    node = node.parent;
  }
  return false;
}

export function getDaysUntilExpiry(expiresAt: string): number {
  const expires = new Date(expiresAt);
  const now = new Date();
  return Math.ceil((expires.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
}

export function formatExpiry(expiresAt: string): string {
  const days = getDaysUntilExpiry(expiresAt);
  if (days < 0) return `Expired ${Math.abs(days)} days ago`;
  if (days === 0) return 'Expires today';
  if (days === 1) return 'Expires tomorrow';
  if (days <= 7) return `Expires in ${days} days (!)`;
  if (days <= 30) return `Expires in ${days} days`;
  return `Expires in ${days} days`;
}

export function formatPermissions(permissions: string[]): string {
  if (permissions.length === 0) return 'None';
  if (permissions.length <= 3) return permissions.join(', ');
  return `${permissions.slice(0, 2).join(', ')} +${permissions.length - 2} more`;
}

export function formatConditionsSummary(conditions?: ApiKeyConditions): string {
  if (!conditions || Object.keys(conditions).length === 0) return '-';

  const parts: string[] = [];
  if (conditions.ip) parts.push('IP');
  if (conditions.timeRange) parts.push('Time');
  if (conditions.methods) parts.push('Methods');
  if (conditions.resources) parts.push('Resources');
  if (conditions.aliases) parts.push('Aliases');
  if (conditions.resourceTags) parts.push('Tags');

  if (parts.length === 0) return '-';
  if (parts.length <= 2) return parts.join(', ');
  return `${parts.slice(0, 2).join(', ')} +${parts.length - 2}`;
}

export function displayConditions(cond: ApiKeyConditions): void {
  if (cond.ip) console.log(`  - IP Allowlist: ${cond.ip.join(', ')}`);
  if (cond.timeRange) {
    const tr = cond.timeRange;
    console.log(`  - Time Range: ${tr.start}-${tr.end} ${tr.timezone ?? 'UTC'}`);
  }
  if (cond.methods) console.log(`  - Methods: ${cond.methods.join(', ')}`);
  if (cond.resources) console.log(`  - Resources: ${JSON.stringify(cond.resources)}`);
  if (cond.aliases) console.log(`  - Aliases: ${cond.aliases.join(', ')}`);
  if (cond.resourceTags) console.log(`  - Tags: ${JSON.stringify(cond.resourceTags)}`);
}

/**
 * Parse conditions from command options into ApiKeyConditions object
 */
export function parseConditionsFromOptions(options: {
  ip?: string;
  timeRange?: string;
  methods?: string;
  resources?: string;
  aliases?: string;
  tags?: string;
}): ApiKeyConditions {
  const conditions: ApiKeyConditions = {};

  // IP condition
  if (options.ip && options.ip !== 'clear') {
    conditions.ip = options.ip.split(',').map((ip) => ip.trim());
  }

  // Time range condition
  if (options.timeRange && options.timeRange !== 'clear') {
    const match = /^(\d{2}:\d{2})-(\d{2}:\d{2})(?:\s+(.+))?$/.exec(options.timeRange);
    if (match) {
      conditions.timeRange = {
        start: match[1],
        end: match[2],
        timezone: match[3] || 'UTC',
      };
    }
  }

  // HTTP methods condition
  if (options.methods && options.methods !== 'clear') {
    conditions.methods = options.methods.split(',').map((m) => m.trim().toUpperCase());
  }

  // Resource IDs condition
  if (options.resources && options.resources !== 'clear') {
    const resources: Record<string, string[]> = {};
    for (const part of options.resources.split(',')) {
      const [type, id] = part.split(':');
      if (type && id) {
        resources[type] = resources[type] ?? [];
        resources[type].push(id);
      }
    }
    if (Object.keys(resources).length > 0) {
      conditions.resources = resources;
    }
  }

  // Alias patterns condition
  if (options.aliases && options.aliases !== 'clear') {
    conditions.aliases = options.aliases.split(',').map((a) => a.trim());
  }

  // Resource tags condition
  if (options.tags && options.tags !== 'clear') {
    const tags: Record<string, string> = {};
    for (const part of options.tags.split(',')) {
      const [key, value] = part.split('=');
      if (key && value) {
        tags[key.trim()] = value.trim();
      }
    }
    if (Object.keys(tags).length > 0) {
      conditions.resourceTags = tags;
    }
  }

  return conditions;
}
