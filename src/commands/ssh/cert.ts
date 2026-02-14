// Path: src/commands/ssh/cert.ts

/**
 * SSH certificate management commands
 */

import type { Command } from 'commander';

import { client } from '../../lib/client.js';
import { promptConfirm } from '../../lib/prompts.js';
import * as output from '../../lib/output.js';
import { getCurrentProfile } from '../../lib/config.js';
import type { Certificate, SignResult, SignOptions, CertListOptions, GetOptions } from './types.js';
import {
  parseTtl,
  isExpired,
  buildTenantQuery,
  getDefaultKeyPath,
  getCertificatePath,
  parseCertificateInfo,
  formatRemainingTime,
} from './helpers.js';

export function registerCertCommands(parent: Command): void {
  const cert = parent
    .command('cert')
    .description('SSH certificate management');

  // Local Certificate Status
  cert
    .command('status')
    .description('Show local certificate status')
    .option('-i, --identity <file>', 'Path to SSH private key')
    .option('--json', 'Output as JSON')
    .action(async (options: { identity?: string; json?: boolean }) => {
      const fs = await import('fs');
      const path = await import('path');
      const profile = getCurrentProfile();

      try {
        // Find key
        let keyPath: string;
        if (options.identity) {
          keyPath = path.resolve(options.identity.replace(/^~/, process.env.HOME ?? ''));
        } else if (profile.sshIdentity && fs.existsSync(profile.sshIdentity)) {
          keyPath = profile.sshIdentity;
        } else {
          const defaultKey = await getDefaultKeyPath();
          if (!defaultKey) {
            output.error('No SSH key found');
            output.info('Generate one with: ssh-keygen -t ed25519');
            process.exit(1);
          }
          keyPath = defaultKey;
        }

        const certPath = await getCertificatePath(keyPath);
        const certExists = fs.existsSync(certPath);

        if (!certExists) {
          if (options.json) {
            output.json({ exists: false, path: certPath, keyPath });
            return;
          }

          output.section('Certificate Status');
          output.keyValue({
            'Key': keyPath,
            'Certificate': certPath,
            'Status': '✗ No certificate',
          });
          console.log();
          output.info('Sign your key: znvault ssh connect <host> --force-sign');
          output.info('Or: znvault ssh cert sign ~/.ssh/id_ed25519.pub -o ~/.ssh/id_ed25519-cert.pub');
          return;
        }

        // Parse certificate details
        const info = await parseCertificateInfo(certPath);

        if (options.json) {
          output.json({
            exists: true,
            path: certPath,
            keyPath,
            valid: info.valid,
            principals: info.principals,
            validAfter: info.validAfter?.toISOString(),
            validBefore: info.validBefore?.toISOString(),
            fingerprint: info.fingerprint,
            keyId: info.keyId,
            serial: info.serial,
            remainingTime: info.validBefore ? formatRemainingTime(info.validBefore) : null,
          });
          return;
        }

        output.section('Certificate Status');
        output.keyValue({
          'Key': keyPath,
          'Certificate': certPath,
          'Status': info.valid ? '✓ Valid' : '✗ Expired',
          'Principals': info.principals.length > 0 ? info.principals.join(', ') : '-',
          'Valid From': info.validAfter ? output.formatDate(info.validAfter.toISOString()) : '-',
          'Valid Until': info.validBefore ? output.formatDate(info.validBefore.toISOString()) : '-',
          'Remaining': info.validBefore ? formatRemainingTime(info.validBefore) : '-',
          'Fingerprint': info.fingerprint ?? '-',
          'Key ID': info.keyId ?? '-',
          'Serial': info.serial ?? '-',
        });

        if (!info.valid) {
          console.log();
          output.warn('Certificate is expired or expiring soon');
          output.info('Re-sign with: znvault ssh connect <host> --force-sign');
        }
      } catch (err) {
        output.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    });

  // Sign Public Key
  cert
    .command('sign <publicKeyFile>')
    .description('Sign SSH public key to create certificate')
    .option('--tenant <id>', 'Tenant ID (superadmin only)')
    .option('--ttl <ttl>', 'Certificate TTL (e.g., 8h, 1d)')
    .option('-o, --output <file>', 'Output certificate to file')
    .option('--json', 'Output as JSON')
    .action(async (publicKeyFile: string, options: SignOptions) => {
      const spinner = output.spinner('Signing certificate...').start();

      try {
        const fs = await import('fs');
        const path = await import('path');

        // Read public key
        const publicKeyPath = path.resolve(publicKeyFile);
        if (!fs.existsSync(publicKeyPath)) {
          spinner.fail('Public key file not found');
          output.error(`File not found: ${publicKeyPath}`);
          process.exit(1);
        }

        const publicKey = fs.readFileSync(publicKeyPath, 'utf8').trim();
        const query = buildTenantQuery(options.tenant);

        const body: { publicKey: string; ttlSeconds?: number } = { publicKey };
        if (options.ttl) {
          body.ttlSeconds = parseTtl(options.ttl);
        }

        const result = await client.post<SignResult>(`/v1/ssh/sign${query}`, body);
        spinner.succeed('Certificate signed successfully');

        // Write certificate to file if requested
        if (options.output) {
          const outputPath = path.resolve(options.output);
          fs.writeFileSync(outputPath, result.certificate + '\n');
          output.success(`Certificate written to ${outputPath}`);
        }

        if (options.json) {
          output.json(result);
          return;
        }

        output.section('Certificate Details');
        output.keyValue({
          'Serial': result.serial,
          'Fingerprint': result.fingerprint,
          'Principals': result.principals.join(', '),
          'Valid From': output.formatDate(result.validAfter),
          'Valid Until': output.formatDate(result.validBefore),
        });

        if (!options.output) {
          output.section('Certificate');
          console.log(result.certificate);
          console.log();
          output.info('Save this certificate alongside your private key (e.g., id_ed25519-cert.pub)');
        }
      } catch (err) {
        spinner.fail('Failed to sign certificate');
        output.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    });

  // List Certificates
  cert
    .command('list')
    .description('List issued certificates')
    .option('--tenant <id>', 'Tenant ID (superadmin only)')
    .option('--limit <n>', 'Maximum number of results', '50')
    .option('--offset <n>', 'Offset for pagination', '0')
    .option('--active-only', 'Show only non-expired certificates')
    .option('--revoked', 'Show only revoked certificates')
    .option('--user-id <id>', 'Filter by user ID')
    .option('--json', 'Output as JSON')
    .action(async (options: CertListOptions) => {
      const spinner = output.spinner('Fetching certificates...').start();

      try {
        const params = new URLSearchParams();
        if (options.tenant) params.set('tenantId', options.tenant);
        if (options.limit) params.set('limit', options.limit);
        if (options.offset) params.set('offset', options.offset);
        if (options.activeOnly) params.set('activeOnly', 'true');
        if (options.revoked !== undefined) params.set('revoked', String(options.revoked));
        if (options.userId) params.set('userId', options.userId);

        const queryString = params.toString();
        const response = await client.get<{ items: Certificate[]; pagination: { total: number; hasMore: boolean } }>(
          `/v1/ssh/certificates${queryString ? `?${queryString}` : ''}`
        );
        spinner.stop();

        if (options.json) {
          output.json(response);
          return;
        }

        if (response.items.length === 0) {
          output.info('No certificates found');
          return;
        }

        output.table(
          ['Serial', 'User', 'Principals', 'Valid Until', 'Status'],
          response.items.map(certItem => [
            certItem.serial.substring(0, 16) + (certItem.serial.length > 16 ? '...' : ''),
            certItem.username ?? certItem.userId.substring(0, 8),
            certItem.principals.slice(0, 3).join(', ') + (certItem.principals.length > 3 ? '...' : ''),
            output.formatDate(certItem.validBefore),
            certItem.revoked
              ? '✗ Revoked'
              : isExpired(certItem.validBefore)
                ? '○ Expired'
                : '✓ Active',
          ])
        );

        output.info(`Total: ${response.pagination.total} certificate(s)`);
        if (response.pagination.hasMore) {
          output.info(`Use --offset to see more results`);
        }
      } catch (err) {
        spinner.fail('Failed to list certificates');
        output.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    });

  // Get Certificate
  cert
    .command('get <id>')
    .description('Get certificate details')
    .option('--tenant <id>', 'Tenant ID (superadmin only)')
    .option('--json', 'Output as JSON')
    .action(async (id: string, options: GetOptions) => {
      const spinner = output.spinner('Fetching certificate...').start();

      try {
        const query = buildTenantQuery(options.tenant);
        const certItem = await client.get<Certificate>(`/v1/ssh/certificates/${encodeURIComponent(id)}${query}`);
        spinner.stop();

        if (options.json) {
          output.json(certItem);
          return;
        }

        output.section('Certificate Details');
        output.keyValue({
          'ID': certItem.id,
          'Serial': certItem.serial,
          'User ID': certItem.userId,
          'Fingerprint': certItem.fingerprint,
          'Principals': certItem.principals.join(', '),
          'Extensions': certItem.extensions?.join(', ') ?? '-',
          'Valid From': output.formatDate(certItem.validAfter),
          'Valid Until': output.formatDate(certItem.validBefore),
          'Status': certItem.revoked
            ? '✗ Revoked'
            : isExpired(certItem.validBefore)
              ? '○ Expired'
              : '✓ Active',
          'Request IP': certItem.requestIp ?? '-',
          'Created': output.formatDate(certItem.createdAt),
        });

        if (certItem.revoked) {
          output.section('Revocation');
          output.keyValue({
            'Revoked At': certItem.revokedAt ? output.formatDate(certItem.revokedAt) : '-',
            'Revoked By': certItem.revokedBy ?? '-',
            'Reason': certItem.revocationReason ?? '-',
          });
        }
      } catch (err) {
        spinner.fail('Failed to get certificate');
        output.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    });

  // Revoke Certificate
  cert
    .command('revoke <id>')
    .description('Revoke a certificate')
    .option('--tenant <id>', 'Tenant ID (superadmin only)')
    .option('--reason <reason>', 'Revocation reason')
    .option('-y, --yes', 'Skip confirmation')
    .action(async (id: string, options: { tenant?: string; reason?: string; yes?: boolean }) => {
      try {
        const query = buildTenantQuery(options.tenant);

        if (!options.yes) {
          const confirmed = await promptConfirm(`Revoke certificate ${id}?`);
          if (!confirmed) {
            output.info('Revoke cancelled');
            return;
          }
        }

        const spinner = output.spinner('Revoking certificate...').start();

        try {
          await client.post(`/v1/ssh/certificates/${encodeURIComponent(id)}/revoke${query}`, {
            reason: options.reason,
          });
          spinner.succeed('Certificate revoked successfully');
        } catch (err) {
          spinner.fail('Failed to revoke certificate');
          throw err;
        }
      } catch (err) {
        output.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    });
}
