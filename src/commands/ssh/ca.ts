// Path: src/commands/ssh/ca.ts

/**
 * SSH CA management commands
 */

import type { Command } from 'commander';

import { client } from '../../lib/client.js';
import { promptConfirm } from '../../lib/prompts.js';
import * as output from '../../lib/output.js';
import type { CAStatus, CA, ListOptions, InitOptions, DeleteOptions } from './types.js';
import { formatTtl, parseTtl, buildTenantQuery } from './helpers.js';

export function registerCACommands(parent: Command): void {
  const ca = parent
    .command('ca')
    .description('SSH CA management');

  // Get CA Status
  ca
    .command('status')
    .description('Get SSH CA status for current tenant')
    .option('--tenant <id>', 'Tenant ID (superadmin only)')
    .option('--json', 'Output as JSON')
    .action(async (options: ListOptions) => {
      const spinner = output.spinner('Fetching CA status...').start();

      try {
        const query = buildTenantQuery(options.tenant);
        const status = await client.get<CAStatus>(`/v1/ssh/ca${query}`);
        spinner.stop();

        if (options.json) {
          output.json(status);
          return;
        }

        if (!status.initialized) {
          output.warn('SSH CA is not initialized for this tenant');
          output.info('Use "znvault ssh ca init" to initialize');
          return;
        }

        output.section('SSH CA Status');
        output.keyValue({
          'Status': '✓ Initialized',
          'Key Type': status.keyType ?? '-',
          'Fingerprint': status.fingerprint ?? '-',
          'Default TTL': status.defaultTtlSeconds ? formatTtl(status.defaultTtlSeconds) : '-',
          'Max TTL': status.maxTtlSeconds ? formatTtl(status.maxTtlSeconds) : '-',
          'Extensions': status.allowedExtensions?.join(', ') ?? '-',
          'Total Certificates': status.totalCertificates ?? '-',
          'Active Certificates': status.activeCertificates ?? '-',
          'Created': status.createdAt ? output.formatDate(status.createdAt) : '-',
        });

        if (status.publicKey) {
          output.section('CA Public Key');
          console.log(status.publicKey);
        }
      } catch (err) {
        spinner.fail('Failed to fetch CA status');
        output.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    });

  // Initialize CA
  ca
    .command('init')
    .description('Initialize SSH CA for tenant')
    .option('--tenant <id>', 'Tenant ID (superadmin only)')
    .option('--key-type <type>', 'Key type (ed25519 or rsa-4096)', 'ed25519')
    .option('--default-ttl <ttl>', 'Default certificate TTL (e.g., 8h, 1d)', '8h')
    .option('--max-ttl <ttl>', 'Maximum certificate TTL (e.g., 24h, 7d)', '24h')
    .option('--extension <ext...>', 'Allowed extensions', ['permit-pty', 'permit-port-forwarding'])
    .option('--json', 'Output as JSON')
    .action(async (options: InitOptions) => {
      const spinner = output.spinner('Initializing SSH CA...').start();

      try {
        const query = buildTenantQuery(options.tenant);
        const body = {
          keyType: options.keyType,
          defaultTtlSeconds: options.defaultTtl ? parseTtl(options.defaultTtl) : undefined,
          maxTtlSeconds: options.maxTtl ? parseTtl(options.maxTtl) : undefined,
          allowedExtensions: options.extension,
        };

        const caResult = await client.post<CA>(`/v1/ssh/ca${query}`, body);
        spinner.succeed('SSH CA initialized successfully');

        if (options.json) {
          output.json(caResult);
          return;
        }

        output.section('CA Configuration');
        output.keyValue({
          'ID': caResult.id,
          'Key Type': caResult.keyType,
          'Fingerprint': caResult.fingerprint,
          'Default TTL': formatTtl(caResult.defaultTtlSeconds),
          'Max TTL': formatTtl(caResult.maxTtlSeconds),
          'Extensions': caResult.allowedExtensions.join(', '),
          'Created': output.formatDate(caResult.createdAt),
        });

        output.section('CA Public Key');
        console.log(caResult.publicKey);

        console.log();
        output.info('Add this public key to your servers\' TrustedUserCAKeys configuration.');
        output.info('Example sshd_config:');
        console.log('  TrustedUserCAKeys /etc/ssh/ca.pub');
      } catch (err) {
        spinner.fail('Failed to initialize SSH CA');
        output.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    });

  // Delete CA
  ca
    .command('delete')
    .description('Delete SSH CA (DESTRUCTIVE)')
    .option('--tenant <id>', 'Tenant ID (superadmin only)')
    .option('-y, --yes', 'Skip confirmation')
    .action(async (options: DeleteOptions) => {
      try {
        const query = buildTenantQuery(options.tenant);

        if (!options.yes) {
          output.warn('This will permanently delete the SSH CA and invalidate all issued certificates!');
          const confirmed = await promptConfirm('Are you sure you want to delete the SSH CA?');
          if (!confirmed) {
            output.info('Delete cancelled');
            return;
          }
        }

        const spinner = output.spinner('Deleting SSH CA...').start();

        try {
          await client.delete(`/v1/ssh/ca${query}`);
          spinner.succeed('SSH CA deleted successfully');
        } catch (err) {
          spinner.fail('Failed to delete SSH CA');
          throw err;
        }
      } catch (err) {
        output.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    });

  // Get CA Public Key
  ca
    .command('public-key <tenantId>')
    .description('Get CA public key (for server configuration)')
    .option('--raw', 'Output raw key only (no formatting)')
    .action(async (tenantId: string, options: { raw?: boolean }) => {
      try {
        const response = await client.get<{ publicKey: string; fingerprint: string }>(
          `/v1/ssh/ca/${encodeURIComponent(tenantId)}/public-key`
        );

        if (options.raw) {
          console.log(response.publicKey);
        } else {
          output.section('CA Public Key');
          output.keyValue({
            'Fingerprint': response.fingerprint,
          });
          console.log();
          console.log(response.publicKey);
        }
      } catch (err) {
        output.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    });
}
