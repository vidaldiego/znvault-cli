// Path: src/commands/secret/get.ts

/**
 * Secret get command (metadata only)
 */

import type { Command } from 'commander';

import Table from 'cli-table3';
import { client } from '../../lib/client.js';
import * as output from '../../lib/output.js';
import type { GetOptions, SecretMetadata } from './types.js';
import { formatDate, formatType, formatBytes } from './helpers.js';
import { resolveSecretId } from './resolve.js';

/**
 * Derive the "References" table row purely from stored metadata (no decrypt).
 * Returns the display string, or null when the row should be omitted
 * (references off / plain secret). Mapping per the reference-metadata design:
 *   subType === 'link'                  → 'link secret'
 *   referencesEnabled && hasReferences  → 'enabled · has tokens'
 *   referencesEnabled && !hasReferences → 'enabled · no tokens yet'
 *   hasReferences                       → 'has tokens'   (link-only edge; rare)
 *   otherwise                           → null           (off → omit)
 */
function referencesRowValue(secret: SecretMetadata): string | null {
  if (secret.subType === 'link') return 'link secret';
  if (secret.referencesEnabled === true && secret.hasReferences === true) {
    return 'enabled · has tokens';
  }
  if (secret.referencesEnabled === true && secret.hasReferences !== true) {
    return 'enabled · no tokens yet';
  }
  if (secret.hasReferences === true) return 'has tokens';
  return null;
}

export function registerGetCommand(secretCmd: Command): void {
  secretCmd
    .command('get <id-or-alias>')
    .description('Get secret metadata (supports UUID or tenant/alias format)')
    .option('--json', 'Output as JSON')
    .action(async (idOrAlias: string, options: GetOptions) => {
      const spinner = output.spinner('Resolving secret...').start();

      try {
        // Resolve alias to UUID if needed
        const id = await resolveSecretId(idOrAlias);
        spinner.text = 'Fetching secret metadata...';

        const secret = await client.get<SecretMetadata>(`/v1/secrets/${id}/meta`);
        spinner.stop();

        if (options.json) {
          output.json(secret);
          return;
        }

        const table = new Table({
          colWidths: [20, 60],
        });

        table.push(
          ['ID', secret.id],
          ['Alias', secret.alias],
          ['Tenant', secret.tenant],
          ['Type', formatType(secret.type, secret.subType)],
          ['Version', String(secret.version)],
        );

        if (secret.fileName) {
          table.push(['File Name', secret.fileName]);
        }
        if (secret.fileSize) {
          table.push(['File Size', formatBytes(secret.fileSize)]);
        }
        if (secret.fileMime) {
          table.push(['MIME Type', secret.fileMime]);
        }
        if (secret.contentType) {
          table.push(['Content Type', secret.contentType]);
        }

        const refsRow = referencesRowValue(secret);
        if (refsRow !== null) {
          table.push(['References', refsRow]);
        }

        if (secret.expiresAt) {
          table.push(['Expires At', formatDate(secret.expiresAt)]);
        }
        if (secret.ttlUntil) {
          table.push(['TTL Until', formatDate(secret.ttlUntil)]);
        }
        if (secret.tags && secret.tags.length > 0) {
          table.push(['Tags', secret.tags.join(', ')]);
        }
        table.push(
          ['Created By', secret.createdBy || '-'],
          ['Created At', formatDate(secret.createdAt)],
          ['Updated At', formatDate(secret.updatedAt)],
        );

        console.log(table.toString());

        // Reference tips (below the table), derived from the same metadata.
        if (secret.subType === 'link') {
          console.log(
            "(tip: 'znvault secret decrypt <alias> --no-resolve' shows the pointer; " +
              "'decrypt <alias>' the target)",
          );
        } else if (secret.referencesEnabled === true && secret.hasReferences === true) {
          console.log(
            "(tip: 'znvault secret decrypt <alias>' resolves references; " +
              "'--no-resolve' shows the raw template)",
          );
        }
      } catch (error) {
        spinner.fail('Failed to get secret');
        output.error((error as Error).message);
        process.exit(1);
      }
    });
}
