// Path: src/commands/apikey/managed/helpers.ts

/**
 * Helper functions for managed API key commands
 */

import * as output from '../../../lib/output.js';
import type { ManagedAPIKey, RotationMode } from '../../../types/index.js';
import { formatDate, displayConditions } from '../helpers.js';

export function formatRotationMode(mode: RotationMode): string {
  switch (mode) {
    case 'scheduled': return 'Scheduled';
    case 'on-use': return 'On Use';
    case 'on-bind': return 'On Bind';
    default: return mode;
  }
}

export function formatTimeUntil(dateStr: string | undefined): string {
  if (!dateStr) return '-';
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = date.getTime() - now.getTime();
  if (diffMs <= 0) return 'Now';

  const diffMins = Math.floor(diffMs / 60000);
  if (diffMins < 60) return `${diffMins}m`;

  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ${diffMins % 60}m`;

  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays}d ${diffHours % 24}h`;
}

export function displayManagedKeyDetails(key: ManagedAPIKey): void {
  const statusIcon = key.enabled ? '\x1b[32m●\x1b[0m Active' : '\x1b[31m○\x1b[0m Disabled';

  output.keyValue({
    'Name': key.name,
    'Key ID': key.id,
    'Prefix': key.prefix,
    'Status': statusIcon,
    'Tenant': key.tenant_id,
    'Description': key.description ?? 'None',
    'Rotation Mode': formatRotationMode(key.rotation_mode),
    'Rotation Interval': key.rotation_interval ?? '-',
    'Grace Period': key.grace_period,
    'Next Rotation': key.next_rotation_at ? `${formatDate(key.next_rotation_at)} (${formatTimeUntil(key.next_rotation_at)})` : '-',
    'Last Bound': key.last_bound_at ? formatDate(key.last_bound_at) : 'Never',
    'Rotation Count': key.rotation_count,
    'Last Rotation': key.last_rotation ? formatDate(key.last_rotation) : 'Never',
    'Expires': formatDate(key.expires_at),
    'Created': formatDate(key.created_at),
    'Created By': key.created_by_username ?? key.created_by ?? 'Unknown',
  });

  if (key.notify_before) {
    console.log(`\nNotifications: ${key.notify_before} before rotation`);
  }
  if (key.webhook_url) {
    console.log(`Webhook: ${key.webhook_url}`);
  }

  if (key.permissions.length > 0) {
    console.log('\nPermissions:');
    for (const perm of key.permissions) {
      console.log(`  - ${perm}`);
    }
  }

  const keyConditions = key.conditions;
  if (keyConditions && Object.keys(keyConditions).length > 0) {
    console.log('\nConditions:');
    displayConditions(keyConditions);
  }
}
