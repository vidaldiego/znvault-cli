// Path: znvault-cli/src/commands/ssh.ts
// SSH Certificate Authority commands

import { type Command } from 'commander';
import ora from 'ora';
import { client } from '../lib/client.js';
import { promptConfirm } from '../lib/prompts.js';
import * as output from '../lib/output.js';

// ============================================================================
// Types
// ============================================================================

interface CAStatus {
  initialized: boolean;
  publicKey?: string;
  fingerprint?: string;
  keyType?: string;
  defaultTtlSeconds?: number;
  maxTtlSeconds?: number;
  allowedExtensions?: string[];
  totalCertificates?: number;
  activeCertificates?: number;
  createdAt?: string;
}

interface CA {
  id: string;
  publicKey: string;
  fingerprint: string;
  keyType: string;
  defaultTtlSeconds: number;
  maxTtlSeconds: number;
  allowedExtensions: string[];
  createdAt: string;
}

interface Certificate {
  id: string;
  serial: string;
  userId: string;
  username?: string;
  fingerprint: string;
  principals: string[];
  extensions?: string[];
  validAfter: string;
  validBefore: string;
  revoked: boolean;
  revokedAt?: string;
  revokedBy?: string;
  revocationReason?: string;
  requestIp?: string;
  createdAt: string;
}

interface PrincipalMapping {
  id: string;
  groupId: string;
  groupName?: string;
  groupDisplayName?: string;
  principals: string[];
  createdAt: string;
  createdBy?: string;
}

interface ServerGroup {
  id: string;
  name: string;
  description?: string;
  accessRules?: Array<{
    linuxUser: string;
    allowedPrincipals: string[];
  }>;
  createdAt: string;
  createdBy?: string;
}

interface SignResult {
  certificate: string;
  serial: string;
  principals: string[];
  validAfter: string;
  validBefore: string;
  fingerprint: string;
}

interface ListOptions {
  tenant?: string;
  json?: boolean;
}

interface CertListOptions extends ListOptions {
  limit?: string;
  offset?: string;
  activeOnly?: boolean;
  revoked?: boolean;
  userId?: string;
}

interface InitOptions {
  tenant?: string;
  keyType?: string;
  defaultTtl?: string;
  maxTtl?: string;
  extension?: string[];
  json?: boolean;
}

interface SignOptions {
  tenant?: string;
  ttl?: string;
  output?: string;
  json?: boolean;
}

interface CreateMappingOptions {
  tenant?: string;
  json?: boolean;
}

interface CreateServerGroupOptions {
  tenant?: string;
  description?: string;
  json?: boolean;
}

interface SetAccessOptions {
  tenant?: string;
  json?: boolean;
}

interface DeleteOptions {
  tenant?: string;
  yes?: boolean;
}

interface GetOptions {
  tenant?: string;
  json?: boolean;
}

// ============================================================================
// Helper Functions
// ============================================================================

function formatTtl(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`;
  return `${Math.floor(seconds / 86400)}d`;
}

function parseTtl(ttl: string): number {
  const match = ttl.match(/^(\d+)([smhd])?$/i);
  if (!match) {
    throw new Error(`Invalid TTL format: ${ttl}. Use format like 8h, 30m, 1d, or 3600`);
  }
  const value = parseInt(match[1]);
  const unit = match[2]?.toLowerCase() ?? 's';
  switch (unit) {
    case 's': return value;
    case 'm': return value * 60;
    case 'h': return value * 3600;
    case 'd': return value * 86400;
    default: return value;
  }
}

function isExpired(validBefore: string): boolean {
  return new Date(validBefore) < new Date();
}

// ============================================================================
// Commands
// ============================================================================

export function registerSSHCommands(program: Command): void {
  const ssh = program
    .command('ssh')
    .description('SSH Certificate Authority management');

  // ===========================================================================
  // CA Management
  // ===========================================================================

  const ca = ssh
    .command('ca')
    .description('SSH CA management');

  // ---------------------------------------------------------------------------
  // Get CA Status
  // ---------------------------------------------------------------------------
  ca
    .command('status')
    .description('Get SSH CA status for current tenant')
    .option('--tenant <id>', 'Tenant ID (superadmin only)')
    .option('--json', 'Output as JSON')
    .action(async (options: ListOptions) => {
      const spinner = ora('Fetching CA status...').start();

      try {
        const query = options.tenant ? `?tenantId=${encodeURIComponent(options.tenant)}` : '';
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

  // ---------------------------------------------------------------------------
  // Initialize CA
  // ---------------------------------------------------------------------------
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
      const spinner = ora('Initializing SSH CA...').start();

      try {
        const query = options.tenant ? `?tenantId=${encodeURIComponent(options.tenant)}` : '';
        const body = {
          keyType: options.keyType,
          defaultTtlSeconds: options.defaultTtl ? parseTtl(options.defaultTtl) : undefined,
          maxTtlSeconds: options.maxTtl ? parseTtl(options.maxTtl) : undefined,
          allowedExtensions: options.extension,
        };

        const ca = await client.post<CA>(`/v1/ssh/ca${query}`, body);
        spinner.succeed('SSH CA initialized successfully');

        if (options.json) {
          output.json(ca);
          return;
        }

        output.section('CA Configuration');
        output.keyValue({
          'ID': ca.id,
          'Key Type': ca.keyType,
          'Fingerprint': ca.fingerprint,
          'Default TTL': formatTtl(ca.defaultTtlSeconds),
          'Max TTL': formatTtl(ca.maxTtlSeconds),
          'Extensions': ca.allowedExtensions.join(', '),
          'Created': output.formatDate(ca.createdAt),
        });

        output.section('CA Public Key');
        console.log(ca.publicKey);

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

  // ---------------------------------------------------------------------------
  // Delete CA
  // ---------------------------------------------------------------------------
  ca
    .command('delete')
    .description('Delete SSH CA (DESTRUCTIVE)')
    .option('--tenant <id>', 'Tenant ID (superadmin only)')
    .option('-y, --yes', 'Skip confirmation')
    .action(async (options: DeleteOptions) => {
      try {
        const query = options.tenant ? `?tenantId=${encodeURIComponent(options.tenant)}` : '';

        if (!options.yes) {
          output.warn('This will permanently delete the SSH CA and invalidate all issued certificates!');
          const confirmed = await promptConfirm('Are you sure you want to delete the SSH CA?');
          if (!confirmed) {
            output.info('Delete cancelled');
            return;
          }
        }

        const spinner = ora('Deleting SSH CA...').start();

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

  // ---------------------------------------------------------------------------
  // Get CA Public Key
  // ---------------------------------------------------------------------------
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

  // ===========================================================================
  // Certificate Management
  // ===========================================================================

  const cert = ssh
    .command('cert')
    .description('SSH certificate management');

  // ---------------------------------------------------------------------------
  // Sign Public Key
  // ---------------------------------------------------------------------------
  cert
    .command('sign <publicKeyFile>')
    .description('Sign SSH public key to create certificate')
    .option('--tenant <id>', 'Tenant ID (superadmin only)')
    .option('--ttl <ttl>', 'Certificate TTL (e.g., 8h, 1d)')
    .option('-o, --output <file>', 'Output certificate to file')
    .option('--json', 'Output as JSON')
    .action(async (publicKeyFile: string, options: SignOptions) => {
      const spinner = ora('Signing certificate...').start();

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
        const query = options.tenant ? `?tenantId=${encodeURIComponent(options.tenant)}` : '';

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

  // ---------------------------------------------------------------------------
  // List Certificates
  // ---------------------------------------------------------------------------
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
      const spinner = ora('Fetching certificates...').start();

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
          response.items.map(cert => [
            cert.serial.substring(0, 16) + (cert.serial.length > 16 ? '...' : ''),
            cert.username ?? cert.userId.substring(0, 8),
            cert.principals.slice(0, 3).join(', ') + (cert.principals.length > 3 ? '...' : ''),
            output.formatDate(cert.validBefore),
            cert.revoked
              ? '✗ Revoked'
              : isExpired(cert.validBefore)
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

  // ---------------------------------------------------------------------------
  // Get Certificate
  // ---------------------------------------------------------------------------
  cert
    .command('get <id>')
    .description('Get certificate details')
    .option('--tenant <id>', 'Tenant ID (superadmin only)')
    .option('--json', 'Output as JSON')
    .action(async (id: string, options: GetOptions) => {
      const spinner = ora('Fetching certificate...').start();

      try {
        const query = options.tenant ? `?tenantId=${encodeURIComponent(options.tenant)}` : '';
        const cert = await client.get<Certificate>(`/v1/ssh/certificates/${encodeURIComponent(id)}${query}`);
        spinner.stop();

        if (options.json) {
          output.json(cert);
          return;
        }

        output.section('Certificate Details');
        output.keyValue({
          'ID': cert.id,
          'Serial': cert.serial,
          'User ID': cert.userId,
          'Fingerprint': cert.fingerprint,
          'Principals': cert.principals.join(', '),
          'Extensions': cert.extensions?.join(', ') ?? '-',
          'Valid From': output.formatDate(cert.validAfter),
          'Valid Until': output.formatDate(cert.validBefore),
          'Status': cert.revoked
            ? '✗ Revoked'
            : isExpired(cert.validBefore)
              ? '○ Expired'
              : '✓ Active',
          'Request IP': cert.requestIp ?? '-',
          'Created': output.formatDate(cert.createdAt),
        });

        if (cert.revoked) {
          output.section('Revocation');
          output.keyValue({
            'Revoked At': cert.revokedAt ? output.formatDate(cert.revokedAt) : '-',
            'Revoked By': cert.revokedBy ?? '-',
            'Reason': cert.revocationReason ?? '-',
          });
        }
      } catch (err) {
        spinner.fail('Failed to get certificate');
        output.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    });

  // ---------------------------------------------------------------------------
  // Revoke Certificate
  // ---------------------------------------------------------------------------
  cert
    .command('revoke <id>')
    .description('Revoke a certificate')
    .option('--tenant <id>', 'Tenant ID (superadmin only)')
    .option('--reason <reason>', 'Revocation reason')
    .option('-y, --yes', 'Skip confirmation')
    .action(async (id: string, options: { tenant?: string; reason?: string; yes?: boolean }) => {
      try {
        const query = options.tenant ? `?tenantId=${encodeURIComponent(options.tenant)}` : '';

        if (!options.yes) {
          const confirmed = await promptConfirm(`Revoke certificate ${id}?`);
          if (!confirmed) {
            output.info('Revoke cancelled');
            return;
          }
        }

        const spinner = ora('Revoking certificate...').start();

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

  // ===========================================================================
  // Principal Mappings
  // ===========================================================================

  const mapping = ssh
    .command('mapping')
    .description('SSH principal mapping management (SSO groups → SSH principals)');

  // ---------------------------------------------------------------------------
  // List Mappings
  // ---------------------------------------------------------------------------
  mapping
    .command('list')
    .description('List principal mappings')
    .option('--tenant <id>', 'Tenant ID (superadmin only)')
    .option('--json', 'Output as JSON')
    .action(async (options: ListOptions) => {
      const spinner = ora('Fetching mappings...').start();

      try {
        const query = options.tenant ? `?tenantId=${encodeURIComponent(options.tenant)}` : '';
        const response = await client.get<{ items: PrincipalMapping[] }>(`/v1/ssh/principal-mappings${query}`);
        spinner.stop();

        if (options.json) {
          output.json(response.items);
          return;
        }

        if (response.items.length === 0) {
          output.info('No principal mappings found');
          output.info('Use "znvault ssh mapping create" to create a mapping');
          return;
        }

        output.table(
          ['ID', 'Group', 'Principals', 'Created'],
          response.items.map(m => [
            m.id.substring(0, 8) + '...',
            m.groupDisplayName ?? m.groupName ?? m.groupId.substring(0, 8),
            m.principals.join(', '),
            output.formatDate(m.createdAt),
          ])
        );

        output.info(`Total: ${response.items.length} mapping(s)`);
      } catch (err) {
        spinner.fail('Failed to list mappings');
        output.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    });

  // ---------------------------------------------------------------------------
  // Create Mapping
  // ---------------------------------------------------------------------------
  mapping
    .command('create <groupId> <principals...>')
    .description('Create principal mapping (SSO group → SSH principals)')
    .option('--tenant <id>', 'Tenant ID (superadmin only)')
    .option('--json', 'Output as JSON')
    .action(async (groupId: string, principals: string[], options: CreateMappingOptions) => {
      const spinner = ora('Creating mapping...').start();

      try {
        const query = options.tenant ? `?tenantId=${encodeURIComponent(options.tenant)}` : '';
        const mapping = await client.post<PrincipalMapping>(`/v1/ssh/principal-mappings${query}`, {
          groupId,
          principals,
        });
        spinner.succeed('Mapping created successfully');

        if (options.json) {
          output.json(mapping);
          return;
        }

        output.keyValue({
          'ID': mapping.id,
          'Group ID': mapping.groupId,
          'Principals': mapping.principals.join(', '),
          'Created': output.formatDate(mapping.createdAt),
        });
      } catch (err) {
        spinner.fail('Failed to create mapping');
        output.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    });

  // ---------------------------------------------------------------------------
  // Update Mapping
  // ---------------------------------------------------------------------------
  mapping
    .command('update <mappingId> <principals...>')
    .description('Update principal mapping')
    .option('--tenant <id>', 'Tenant ID (superadmin only)')
    .action(async (mappingId: string, principals: string[], options: { tenant?: string }) => {
      const spinner = ora('Updating mapping...').start();

      try {
        const query = options.tenant ? `?tenantId=${encodeURIComponent(options.tenant)}` : '';
        await client.put(`/v1/ssh/principal-mappings/${encodeURIComponent(mappingId)}${query}`, {
          principals,
        });
        spinner.succeed('Mapping updated successfully');
      } catch (err) {
        spinner.fail('Failed to update mapping');
        output.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    });

  // ---------------------------------------------------------------------------
  // Delete Mapping
  // ---------------------------------------------------------------------------
  mapping
    .command('delete <mappingId>')
    .description('Delete principal mapping')
    .option('--tenant <id>', 'Tenant ID (superadmin only)')
    .option('-y, --yes', 'Skip confirmation')
    .action(async (mappingId: string, options: DeleteOptions) => {
      try {
        const query = options.tenant ? `?tenantId=${encodeURIComponent(options.tenant)}` : '';

        if (!options.yes) {
          const confirmed = await promptConfirm('Delete this mapping?');
          if (!confirmed) {
            output.info('Delete cancelled');
            return;
          }
        }

        const spinner = ora('Deleting mapping...').start();

        try {
          await client.delete(`/v1/ssh/principal-mappings/${encodeURIComponent(mappingId)}${query}`);
          spinner.succeed('Mapping deleted successfully');
        } catch (err) {
          spinner.fail('Failed to delete mapping');
          throw err;
        }
      } catch (err) {
        output.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    });

  // ===========================================================================
  // Server Groups
  // ===========================================================================

  const group = ssh
    .command('server-group')
    .description('SSH server group management');

  // ---------------------------------------------------------------------------
  // List Server Groups
  // ---------------------------------------------------------------------------
  group
    .command('list')
    .description('List server groups')
    .option('--tenant <id>', 'Tenant ID (superadmin only)')
    .option('--json', 'Output as JSON')
    .action(async (options: ListOptions) => {
      const spinner = ora('Fetching server groups...').start();

      try {
        const query = options.tenant ? `?tenantId=${encodeURIComponent(options.tenant)}` : '';
        const response = await client.get<{ items: ServerGroup[] }>(`/v1/ssh/server-groups${query}`);
        spinner.stop();

        if (options.json) {
          output.json(response.items);
          return;
        }

        if (response.items.length === 0) {
          output.info('No server groups found');
          output.info('Use "znvault ssh server-group create" to create a group');
          return;
        }

        output.table(
          ['ID', 'Name', 'Description', 'Created'],
          response.items.map(g => [
            g.id.substring(0, 8) + '...',
            g.name,
            (g.description ?? '-').substring(0, 30),
            output.formatDate(g.createdAt),
          ])
        );

        output.info(`Total: ${response.items.length} server group(s)`);
      } catch (err) {
        spinner.fail('Failed to list server groups');
        output.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    });

  // ---------------------------------------------------------------------------
  // Create Server Group
  // ---------------------------------------------------------------------------
  group
    .command('create <name>')
    .description('Create server group')
    .option('--tenant <id>', 'Tenant ID (superadmin only)')
    .option('-d, --description <text>', 'Group description')
    .option('--json', 'Output as JSON')
    .action(async (name: string, options: CreateServerGroupOptions) => {
      const spinner = ora('Creating server group...').start();

      try {
        const query = options.tenant ? `?tenantId=${encodeURIComponent(options.tenant)}` : '';
        const group = await client.post<ServerGroup>(`/v1/ssh/server-groups${query}`, {
          name,
          description: options.description,
        });
        spinner.succeed('Server group created successfully');

        if (options.json) {
          output.json(group);
          return;
        }

        output.keyValue({
          'ID': group.id,
          'Name': group.name,
          'Description': group.description ?? '-',
          'Created': output.formatDate(group.createdAt),
        });
      } catch (err) {
        spinner.fail('Failed to create server group');
        output.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    });

  // ---------------------------------------------------------------------------
  // Get Server Group
  // ---------------------------------------------------------------------------
  group
    .command('get <id>')
    .description('Get server group details')
    .option('--tenant <id>', 'Tenant ID (superadmin only)')
    .option('--json', 'Output as JSON')
    .action(async (id: string, options: GetOptions) => {
      const spinner = ora('Fetching server group...').start();

      try {
        const query = options.tenant ? `?tenantId=${encodeURIComponent(options.tenant)}` : '';
        const group = await client.get<ServerGroup>(`/v1/ssh/server-groups/${encodeURIComponent(id)}${query}`);
        spinner.stop();

        if (options.json) {
          output.json(group);
          return;
        }

        output.section('Server Group');
        output.keyValue({
          'ID': group.id,
          'Name': group.name,
          'Description': group.description ?? '-',
          'Created': output.formatDate(group.createdAt),
        });

        if (group.accessRules && group.accessRules.length > 0) {
          output.section('Access Rules');
          output.table(
            ['Linux User', 'Allowed Principals'],
            group.accessRules.map(r => [
              r.linuxUser,
              r.allowedPrincipals.join(', '),
            ])
          );
        } else {
          output.section('Access Rules');
          output.info('No access rules defined');
          output.info('Use "znvault ssh server-group set-access" to add rules');
        }
      } catch (err) {
        spinner.fail('Failed to get server group');
        output.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    });

  // ---------------------------------------------------------------------------
  // Delete Server Group
  // ---------------------------------------------------------------------------
  group
    .command('delete <id>')
    .description('Delete server group')
    .option('--tenant <id>', 'Tenant ID (superadmin only)')
    .option('-y, --yes', 'Skip confirmation')
    .action(async (id: string, options: DeleteOptions) => {
      try {
        const query = options.tenant ? `?tenantId=${encodeURIComponent(options.tenant)}` : '';

        if (!options.yes) {
          const confirmed = await promptConfirm('Delete this server group?');
          if (!confirmed) {
            output.info('Delete cancelled');
            return;
          }
        }

        const spinner = ora('Deleting server group...').start();

        try {
          await client.delete(`/v1/ssh/server-groups/${encodeURIComponent(id)}${query}`);
          spinner.succeed('Server group deleted successfully');
        } catch (err) {
          spinner.fail('Failed to delete server group');
          throw err;
        }
      } catch (err) {
        output.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    });

  // ---------------------------------------------------------------------------
  // Set Access Rule
  // ---------------------------------------------------------------------------
  group
    .command('set-access <groupId> <linuxUser> <principals...>')
    .description('Set access rule for server group (which principals can access which Linux user)')
    .option('--tenant <id>', 'Tenant ID (superadmin only)')
    .option('--json', 'Output as JSON')
    .action(async (groupId: string, linuxUser: string, principals: string[], options: SetAccessOptions) => {
      const spinner = ora('Setting access rule...').start();

      try {
        const query = options.tenant ? `?tenantId=${encodeURIComponent(options.tenant)}` : '';
        const access = await client.put<{ linuxUser: string; allowedPrincipals: string[] }>(
          `/v1/ssh/server-groups/${encodeURIComponent(groupId)}/access${query}`,
          { linuxUser, allowedPrincipals: principals }
        );
        spinner.succeed('Access rule set successfully');

        if (options.json) {
          output.json(access);
          return;
        }

        output.keyValue({
          'Linux User': access.linuxUser,
          'Allowed Principals': access.allowedPrincipals.join(', '),
        });
      } catch (err) {
        spinner.fail('Failed to set access rule');
        output.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    });

  // ---------------------------------------------------------------------------
  // Delete Access Rule
  // ---------------------------------------------------------------------------
  group
    .command('delete-access <groupId> <linuxUser>')
    .description('Delete access rule from server group')
    .option('--tenant <id>', 'Tenant ID (superadmin only)')
    .option('-y, --yes', 'Skip confirmation')
    .action(async (groupId: string, linuxUser: string, options: DeleteOptions) => {
      try {
        const query = options.tenant ? `?tenantId=${encodeURIComponent(options.tenant)}` : '';

        if (!options.yes) {
          const confirmed = await promptConfirm(`Delete access rule for Linux user "${linuxUser}"?`);
          if (!confirmed) {
            output.info('Delete cancelled');
            return;
          }
        }

        const spinner = ora('Deleting access rule...').start();

        try {
          await client.delete(
            `/v1/ssh/server-groups/${encodeURIComponent(groupId)}/access/${encodeURIComponent(linuxUser)}${query}`
          );
          spinner.succeed('Access rule deleted successfully');
        } catch (err) {
          spinner.fail('Failed to delete access rule');
          throw err;
        }
      } catch (err) {
        output.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    });

  // ---------------------------------------------------------------------------
  // Get Authorized Principals
  // ---------------------------------------------------------------------------
  group
    .command('authorized-principals <groupId>')
    .description('Get AuthorizedPrincipalsFile content for a server group')
    .option('--tenant <id>', 'Tenant ID (superadmin only)')
    .option('--output <file>', 'Output to file')
    .action(async (groupId: string, options: { tenant?: string; output?: string }) => {
      const spinner = ora('Generating authorized principals...').start();

      try {
        const query = options.tenant ? `?tenantId=${encodeURIComponent(options.tenant)}` : '';
        const response = await client.get<Record<string, string[]>>(
          `/v1/ssh/server-groups/${encodeURIComponent(groupId)}/authorized-principals${query}`
        );
        spinner.stop();

        // Format as AuthorizedPrincipalsFile content
        const lines: string[] = [];
        for (const [linuxUser, principals] of Object.entries(response)) {
          lines.push(`# Linux user: ${linuxUser}`);
          for (const principal of principals) {
            lines.push(principal);
          }
          lines.push('');
        }

        const content = lines.join('\n');

        if (options.output) {
          const fs = await import('fs');
          const path = await import('path');
          fs.writeFileSync(path.resolve(options.output), content);
          output.success(`Written to ${options.output}`);
        } else {
          console.log(content);
        }
      } catch (err) {
        spinner.fail('Failed to get authorized principals');
        output.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    });
}
