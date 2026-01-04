import { type Command } from 'commander';
import ora from 'ora';
import * as mode from '../lib/mode.js';
import * as output from '../lib/output.js';
import type {
  CertificateMetadata,
  CertificateListResponse,
  CertificateStats,
  DecryptedCertificate,
} from '../types/index.js';

// Option interfaces for each command
interface ListOptions {
  status?: string;
  kind?: string;
  expiring?: string;
  json?: boolean;
}

interface GetOptions {
  json?: boolean;
}

interface DecryptOptions {
  output?: string;
  purpose: string;
}

interface ExpiringOptions {
  days: string;
  json?: boolean;
}

interface StatsOptions {
  json?: boolean;
}

interface StoreOptions {
  file: string;
  clientId: string;
  kind: string;
  alias: string;
  type: string;
  purpose: string;
  passphrase?: string;
  clientName?: string;
  contact?: string;
  tags?: string;
}

interface RotateOptions {
  file: string;
  type: string;
  passphrase?: string;
  reason: string;
}

interface DeleteOptions {
  force?: boolean;
}

export function registerCertCommands(program: Command): void {
  const cert = program
    .command('cert')
    .description('Certificate management');

  // List certificates
  cert
    .command('list')
    .description('List certificates')
    .option('--status <status>', 'Filter by status (ACTIVE, EXPIRING_SOON, EXPIRED)')
    .option('--kind <kind>', 'Filter by kind (AEAT, FNMT, CUSTOM, etc.)')
    .option('--expiring <days>', 'Show certificates expiring within N days')
    .option('--json', 'Output as JSON')
    .action(async (options: ListOptions) => {
      const spinner = ora('Fetching certificates...').start();

      try {
        const params = new URLSearchParams();
        if (options.status) params.append('status', options.status);
        if (options.kind) params.append('kind', options.kind);

        let endpoint = '/v1/certificates';
        if (options.expiring) {
          endpoint = `/v1/certificates/expiring?days=${options.expiring}`;
        } else if (params.toString()) {
          endpoint += '?' + params.toString();
        }

        const result = await mode.apiGet<CertificateListResponse | CertificateMetadata[]>(endpoint);
        spinner.stop();

        if (options.json) {
          output.json(result);
          return;
        }

        const items = Array.isArray(result) ? result : result.items;

        if (items.length === 0) {
          console.log('No certificates found');
          return;
        }

        output.table(
          ['ID', 'Alias', 'Kind', 'Subject', 'Status', 'Key', 'Expires', 'Days Left'],
          items.map((cert) => [
            cert.id.substring(0, 8),
            cert.alias,
            cert.kind,
            cert.subjectCn.length > 25 ? cert.subjectCn.substring(0, 22) + '...' : cert.subjectCn,
            formatStatus(cert.status),
            cert.hasPrivateKey ? 'Yes' : 'No',
            new Date(cert.notAfter).toLocaleDateString(),
            formatDaysLeft(cert.daysUntilExpiry),
          ])
        );

        if (!Array.isArray(result) && result.total) {
          console.log(`\nTotal: ${result.total} certificate(s)`);
        }
      } catch (err) {
        spinner.fail('Failed to list certificates');
        output.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
      } finally {
        await mode.closeLocalClient();
      }
    });

  // Get certificate details
  cert
    .command('get <id>')
    .description('Get certificate details')
    .option('--json', 'Output as JSON')
    .action(async (id: string, options: GetOptions) => {
      const spinner = ora('Fetching certificate...').start();

      try {
        const result = await mode.apiGet<CertificateMetadata>(`/v1/certificates/${id}`);
        spinner.stop();

        if (options.json) {
          output.json(result);
          return;
        }

        console.log();
        console.log(`ID:          ${result.id}`);
        console.log(`Alias:       ${result.alias}`);
        console.log(`Kind:        ${result.kind}`);
        console.log(`Client ID:   ${result.clientId}`);
        console.log(`Client:      ${result.clientName}`);
        console.log();
        console.log('Certificate Details:');
        console.log(`  Subject:   ${result.subjectCn}`);
        console.log(`  Issuer:    ${result.issuerCn}`);
        console.log(`  Serial:    ${result.fingerprintSha256.substring(0, 32)}...`);
        console.log(`  Not Before: ${new Date(result.notBefore).toLocaleString()}`);
        console.log(`  Not After:  ${new Date(result.notAfter).toLocaleString()}`);
        console.log(`  Status:    ${formatStatus(result.status)}`);
        console.log(`  Days Left: ${formatDaysLeft(result.daysUntilExpiry)}`);
        console.log();
        console.log('Bundle Info:');
        console.log(`  Has Private Key: ${result.hasPrivateKey ? 'Yes' : 'No'}`);
        console.log(`  Lifecycle:       Enabled`);  // All certs in certificates table have lifecycle enabled
        console.log();
        console.log('Metadata:');
        console.log(`  Version:   ${result.version}`);
        console.log(`  Created:   ${new Date(result.createdAt).toLocaleString()}`);
        console.log(`  Updated:   ${new Date(result.updatedAt).toLocaleString()}`);
        if (result.lastAccessedAt) {
          console.log(`  Accessed:  ${new Date(result.lastAccessedAt).toLocaleString()}`);
        }
        console.log(`  Access Count: ${result.accessCount}`);
        if (result.tags.length > 0) {
          console.log(`  Tags:      ${result.tags.join(', ')}`);
        }
        console.log();
      } catch (err) {
        spinner.fail('Failed to get certificate');
        output.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
      } finally {
        await mode.closeLocalClient();
      }
    });

  // Decrypt certificate
  cert
    .command('decrypt <id>')
    .description('Decrypt and download certificate')
    .option('--output <file>', 'Write to file instead of stdout')
    .option('--purpose <purpose>', 'Purpose for access (required)', 'CLI access')
    .action(async (id: string, options: DecryptOptions) => {
      const spinner = ora('Decrypting certificate...').start();

      try {
        const result = await mode.apiPost<DecryptedCertificate>(`/v1/certificates/${id}/decrypt`, {
          purpose: options.purpose,
        });
        spinner.stop();

        const certData = Buffer.from(result.certificateData, 'base64').toString('utf-8');

        if (options.output) {
          const fs = await import('node:fs');
          fs.writeFileSync(options.output, certData);
          console.log(`Certificate written to ${options.output}`);
        } else {
          console.log(certData);
        }
      } catch (err) {
        spinner.fail('Failed to decrypt certificate');
        output.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
      } finally {
        await mode.closeLocalClient();
      }
    });

  // Get expiring certificates
  cert
    .command('expiring')
    .description('List certificates expiring soon')
    .option('--days <days>', 'Days until expiry (default: 30)', '30')
    .option('--json', 'Output as JSON')
    .action(async (options: ExpiringOptions) => {
      const spinner = ora('Checking expiring certificates...').start();

      try {
        const result = await mode.apiGet<CertificateMetadata[]>(`/v1/certificates/expiring?days=${options.days}`);
        spinner.stop();

        if (options.json) {
          output.json(result);
          return;
        }

        const items = Array.isArray(result) ? result : [];

        if (items.length === 0) {
          console.log(`No certificates expiring within ${options.days} days`);
          return;
        }

        console.log(`\nCertificates expiring within ${options.days} days:\n`);

        output.table(
          ['Alias', 'Subject', 'Expires', 'Days Left', 'Contact'],
          items.map((cert) => [
            cert.alias,
            cert.subjectCn.length > 25 ? cert.subjectCn.substring(0, 22) + '...' : cert.subjectCn,
            new Date(cert.notAfter).toLocaleDateString(),
            formatDaysLeft(cert.daysUntilExpiry),
            cert.contactEmail ?? '-',
          ])
        );
      } catch (err) {
        spinner.fail('Failed to check expiring certificates');
        output.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
      } finally {
        await mode.closeLocalClient();
      }
    });

  // Get statistics
  cert
    .command('stats')
    .description('Get certificate statistics')
    .option('--json', 'Output as JSON')
    .action(async (options: StatsOptions) => {
      const spinner = ora('Fetching statistics...').start();

      try {
        const result = await mode.apiGet<CertificateStats>('/v1/certificates/stats');
        spinner.stop();

        if (options.json) {
          output.json(result);
          return;
        }

        console.log();
        console.log(`Total Certificates: ${result.total}`);
        console.log();
        console.log('By Status:');
        for (const [status, count] of Object.entries(result.byStatus)) {
          console.log(`  ${status}: ${count}`);
        }
        console.log();
        console.log('By Kind:');
        for (const [kind, count] of Object.entries(result.byKind)) {
          console.log(`  ${kind}: ${count}`);
        }
        console.log();
        console.log('Expiring:');
        console.log(`  Within 7 days:  ${result.expiringIn7Days}`);
        console.log(`  Within 30 days: ${result.expiringIn30Days}`);
        console.log();
      } catch (err) {
        spinner.fail('Failed to get statistics');
        output.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
      } finally {
        await mode.closeLocalClient();
      }
    });

  // Store certificate (upload)
  cert
    .command('store')
    .description('Store a new certificate')
    .requiredOption('--file <path>', 'Certificate file path')
    .requiredOption('--client-id <id>', 'Client identifier (e.g., NIF/CIF)')
    .requiredOption('--kind <kind>', 'Certificate kind (AEAT, FNMT, CUSTOM, etc.)')
    .requiredOption('--alias <alias>', 'Human-readable alias')
    .option('--type <type>', 'Certificate type (PEM, P12, DER)', 'PEM')
    .option('--purpose <purpose>', 'Purpose (SIGNING, AUTHENTICATION, ENCRYPTION)', 'SIGNING')
    .option('--passphrase <pass>', 'Passphrase for P12 certificates')
    .option('--client-name <name>', 'Client display name')
    .option('--contact <email>', 'Contact email for notifications')
    .option('--tags <tags>', 'Comma-separated tags')
    .action(async (options: StoreOptions) => {
      const spinner = ora('Storing certificate...').start();

      try {
        const fs = await import('node:fs');

        if (!fs.existsSync(options.file)) {
          throw new Error(`File not found: ${options.file}`);
        }

        const fileData = fs.readFileSync(options.file);
        const base64Data = fileData.toString('base64');

        const body: Record<string, unknown> = {
          clientId: options.clientId,
          kind: options.kind,
          alias: options.alias,
          certificateData: base64Data,
          certificateType: options.type,
          purpose: options.purpose,
        };

        if (options.passphrase) body.passphrase = options.passphrase;
        if (options.clientName) body.clientName = options.clientName;
        if (options.contact) body.contactEmail = options.contact;
        if (options.tags) body.tags = options.tags.split(',').map((t) => t.trim());

        const result = await mode.apiPost<CertificateMetadata>('/v1/certificates', body);
        spinner.stop();

        console.log();
        console.log(`Certificate stored successfully!`);
        console.log();
        console.log(`  ID:       ${result.id}`);
        console.log(`  Alias:    ${result.alias}`);
        console.log(`  Subject:  ${result.subjectCn}`);
        console.log(`  Issuer:   ${result.issuerCn}`);
        console.log(`  Expires:  ${new Date(result.notAfter).toLocaleDateString()}`);
        console.log();
      } catch (err) {
        spinner.fail('Failed to store certificate');
        output.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
      } finally {
        await mode.closeLocalClient();
      }
    });

  // Rotate certificate
  cert
    .command('rotate <id>')
    .description('Rotate/renew a certificate')
    .requiredOption('--file <path>', 'New certificate file path')
    .option('--type <type>', 'Certificate type (PEM, P12, DER)', 'PEM')
    .option('--passphrase <pass>', 'Passphrase for P12 certificates')
    .option('--reason <reason>', 'Reason for rotation', 'Certificate renewal')
    .action(async (id: string, options: RotateOptions) => {
      const spinner = ora('Rotating certificate...').start();

      try {
        const fs = await import('node:fs');

        if (!fs.existsSync(options.file)) {
          throw new Error(`File not found: ${options.file}`);
        }

        const fileData = fs.readFileSync(options.file);
        const base64Data = fileData.toString('base64');

        const body: Record<string, unknown> = {
          certificateData: base64Data,
          certificateType: options.type,
          reason: options.reason,
        };

        if (options.passphrase) body.passphrase = options.passphrase;

        const result = await mode.apiPost<CertificateMetadata>(`/v1/certificates/${id}/rotate`, body);
        spinner.stop();

        console.log();
        console.log(`Certificate rotated successfully!`);
        console.log();
        console.log(`  ID:       ${result.id}`);
        console.log(`  Version:  ${result.version}`);
        console.log(`  Subject:  ${result.subjectCn}`);
        console.log(`  Expires:  ${new Date(result.notAfter).toLocaleDateString()}`);
        console.log();
      } catch (err) {
        spinner.fail('Failed to rotate certificate');
        output.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
      } finally {
        await mode.closeLocalClient();
      }
    });

  // Delete certificate
  cert
    .command('delete <id>')
    .description('Delete a certificate')
    .option('--force', 'Skip confirmation')
    .action(async (id: string, options: DeleteOptions) => {
      try {
        if (!options.force) {
          const readline = await import('node:readline');
          const rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout,
          });

          const answer = await new Promise<string>((resolve) => {
            rl.question(`Are you sure you want to delete certificate ${id}? [y/N] `, resolve);
          });
          rl.close();

          if (answer.toLowerCase() !== 'y') {
            console.log('Cancelled');
            return;
          }
        }

        const spinner = ora('Deleting certificate...').start();

        await mode.apiDelete(`/v1/certificates/${id}`);
        spinner.stop();

        console.log('Certificate deleted successfully');
      } catch (err) {
        output.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
      } finally {
        await mode.closeLocalClient();
      }
    });
}

function formatStatus(status: string): string {
  switch (status) {
    case 'ACTIVE':
      return output.formatStatus('ok');
    case 'EXPIRING_SOON':
      return output.formatStatus('warning');
    case 'EXPIRED':
      return output.formatStatus('error');
    case 'REVOKED':
      return output.formatStatus('error');
    default:
      return status;
  }
}

function formatDaysLeft(days: number): string {
  if (days < 0) {
    return output.formatStatus('error') + ` (${Math.abs(days)}d ago)`;
  }
  if (days < 7) {
    return output.formatStatus('error') + ` ${days}d`;
  }
  if (days < 30) {
    return output.formatStatus('warning') + ` ${days}d`;
  }
  return `${days}d`;
}
