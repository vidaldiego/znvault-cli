// Path: src/commands/dynamic-secrets/lease.ts

/**
 * Lease commands for dynamic secrets
 */


import Table from 'cli-table3';
import inquirer from 'inquirer';
import { client } from '../../lib/client.js';
import * as output from '../../lib/output.js';
import type { DbLease, RenewalResult, LeaseListOptions, LeaseRevokeOptions } from './types.js';
import { formatStatus, formatDate, formatDuration } from './helpers.js';

export async function listLeases(options: LeaseListOptions): Promise<void> {
  const spinner = output.spinner('Fetching leases...').start();

  try {
    const params = new URLSearchParams();
    if (options.role) params.append('roleId', options.role);
    if (options.status) params.append('status', options.status.toUpperCase());

    const paramString = params.toString();
    const url = `/v1/dynamic-secrets/leases${paramString ? '?' + paramString : ''}`;
    const response = await client.get<DbLease[]>(url);
    spinner.stop();

    if (options.json) {
      output.json(response);
      return;
    }

    if (response.length === 0) {
      output.info('No leases found.');
      return;
    }

    const table = new Table({
      head: ['Lease ID', 'Username', 'Role', 'Status', 'TTL Remaining', 'Renewals'],
      style: { head: ['cyan'] },
    });

    for (const lease of response) {
      table.push([
        lease.id.substring(0, 12),
        lease.username,
        lease.roleName ?? lease.roleId.substring(0, 8),
        formatStatus(lease.status),
        lease.status === 'ACTIVE' ? formatDuration(lease.ttlRemaining) : '-',
        String(lease.renewalCount),
      ]);
    }

    console.log(table.toString());
    output.info(`${response.length} lease(s) found`);
  } catch (err) {
    spinner.fail('Failed to list leases');
    output.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}

export async function getLease(leaseId: string, options: { json?: boolean }): Promise<void> {
  const spinner = output.spinner('Fetching lease...').start();

  try {
    const response = await client.get<DbLease>(`/v1/dynamic-secrets/leases/${leaseId}`);
    spinner.stop();

    if (options.json) {
      output.json(response);
      return;
    }

    output.keyValue({
      'Lease ID': response.id,
      'Username': response.username,
      'Role': response.roleName ?? response.roleId,
      'Connection': response.connectionName ?? response.connectionId,
      'Status': formatStatus(response.status),
      'TTL Remaining': response.status === 'ACTIVE' ? formatDuration(response.ttlRemaining) : '-',
      'Renewal Count': String(response.renewalCount),
      'Issued At': formatDate(response.issuedAt),
      'Expires At': formatDate(response.expiresAt),
      'Max Expires At': formatDate(response.maxExpiresAt),
      'Last Renewed': formatDate(response.lastRenewedAt),
      'Revoked At': formatDate(response.revokedAt),
      'Revoked By': response.revokedBy ?? '-',
      'Revoke Reason': response.revokeReason ?? '-',
    });
  } catch (err) {
    spinner.fail('Failed to get lease');
    output.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}

export async function renewLease(leaseId: string, options: {
  ttl?: string;
  json?: boolean;
}): Promise<void> {
  const spinner = output.spinner('Renewing lease...').start();

  try {
    const body: Record<string, unknown> = {};
    if (options.ttl) body.ttlSeconds = parseInt(options.ttl, 10);

    const response = await client.post<RenewalResult>(
      `/v1/dynamic-secrets/leases/${leaseId}/renew`,
      body
    );
    spinner.succeed('Lease renewed');

    if (options.json) {
      output.json(response);
    } else {
      output.success(`Lease renewed. New TTL: ${formatDuration(response.ttlSeconds)}, Renewal count: ${response.renewalCount}`);
    }
  } catch (err) {
    spinner.fail('Failed to renew lease');
    output.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}

export async function revokeLease(leaseId: string, options: LeaseRevokeOptions): Promise<void> {
  if (!options.force) {
    const { confirm } = await inquirer.prompt<{ confirm: boolean }>([{
      type: 'confirm',
      name: 'confirm',
      message: `Are you sure you want to revoke lease "${leaseId}"? This will immediately revoke the database credentials.`,
      default: false,
    }]);
    if (!confirm) {
      output.info('Cancelled');
      return;
    }
  }

  const spinner = output.spinner('Revoking lease...').start();

  try {
    const body: Record<string, unknown> = {};
    if (options.reason) body.reason = options.reason;

    await client.post(`/v1/dynamic-secrets/leases/${leaseId}/revoke`, body);
    spinner.succeed('Lease revoked');

    if (options.json) {
      output.json({ success: true, leaseId });
    }
  } catch (err) {
    spinner.fail('Failed to revoke lease');
    output.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}
