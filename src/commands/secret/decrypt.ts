// Path: src/commands/secret/decrypt.ts

/**
 * Secret decrypt command
 */

import type { Command } from 'commander';

import { client } from '../../lib/client.js';
import * as output from '../../lib/output.js';
import type { DecryptOptions, DecryptedSecret } from './types.js';
import { formatType, formatBytes } from './helpers.js';
import { resolveSecretId } from './resolve.js';

export function registerDecryptCommand(secretCmd: Command): void {
  secretCmd
    .command('decrypt <id-or-alias>')
    .description('Decrypt and show secret value (supports UUID or tenant/alias format)')
    .option('-o, --output <file>', 'Write content to file')
    .option('--json', 'Output as JSON')
    .option('--no-resolve', 'Return the raw, unresolved template/pointer (skip reference resolution)')
    .addHelpText('after', `
Examples:
  znvault secret decrypt zn-admin/config             # by alias path
  znvault secret decrypt alias:web/api-key           # with alias: prefix
  znvault secret decrypt abc12345-...                # by UUID
  znvault secret decrypt certs/server-key -o key.pem # save to file
  znvault secret decrypt app/db-url --no-resolve     # raw template, tokens unexpanded
`)
    .action(async (idOrAlias: string, options: DecryptOptions) => {
      const spinner = output.spinner('Resolving secret...').start();

      try {
        // Resolve alias to UUID if needed
        const id = await resolveSecretId(idOrAlias);
        spinner.text = 'Decrypting secret...';

        // Commander sets `resolve` to false only when `--no-resolve` is passed
        // (default true). Append the query ONLY on explicit false — a default
        // decrypt stays byte-identical to the pre-feature call.
        const query = options.resolve === false ? '?resolve=false' : '';
        const secret = await client.post<DecryptedSecret>(`/v1/secrets/${id}/decrypt${query}`, {});
        spinner.stop();

        if (options.json) {
          output.json(secret);
          return;
        }

        // If output file specified and it's a file-based secret
        if (options.output && secret.data) {
          const fs = await import('fs');

          // Check if it's a file-based secret
          if ('content' in secret.data && typeof secret.data.content === 'string') {
            const content = Buffer.from(secret.data.content, 'base64');
            fs.writeFileSync(options.output, content);
            output.success(`File written to: ${options.output}`);
            return;
          }

          // Otherwise write JSON
          fs.writeFileSync(options.output, JSON.stringify(secret.data, null, 2));
          output.success(`Data written to: ${options.output}`);
          return;
        }

        // Display metadata
        console.log('\n--- Secret Metadata ---');
        console.log(`ID:      ${secret.id}`);
        console.log(`Alias:   ${secret.alias}`);
        console.log(`Tenant:  ${secret.tenant}`);
        console.log(`Type:    ${formatType(secret.type, secret.subType)}`);
        console.log(`Version: ${secret.version}`);
        if (secret.resolvedFrom) {
          const from = secret.resolvedFrom.field
            ? `${secret.resolvedFrom.alias}#${secret.resolvedFrom.field}`
            : secret.resolvedFrom.alias;
          console.log(`Resolved from: ${from}`);
        }
        if (secret.resolved) {
          console.log(`Resolved refs: ${secret.resolved.count}`);
        }

        // Display data based on type
        console.log('\n--- Secret Data ---');

        if (secret.type === 'credential' && secret.data) {
          if ('username' in secret.data) console.log(`Username: ${secret.data.username}`);
          if ('password' in secret.data) console.log(`Password: ${secret.data.password}`);
          // Show any additional fields
          const knownFields = ['username', 'password'];
          for (const [key, value] of Object.entries(secret.data)) {
            if (!knownFields.includes(key)) {
              console.log(`${key}: ${typeof value === 'object' ? JSON.stringify(value) : value}`);
            }
          }
        } else if (secret.data && 'text' in secret.data) {
          // Plain text secret
          console.log(secret.data.text);
        } else if (secret.data && 'content' in secret.data && 'filename' in secret.data) {
          // File-based secret
          console.log(`File: ${secret.data.filename}`);
          console.log(`Size: ${formatBytes(Buffer.from(secret.data.content as string, 'base64').length)}`);
          if (secret.data.contentType) console.log(`Type: ${secret.data.contentType}`);
          console.log('\nUse --output <file> to save the file content');
        } else if (secret.data && 'privateKey' in secret.data) {
          // Key pair secret
          console.log('Key Pair Secret:');
          const pk = secret.data.privateKey as Record<string, unknown>;
          const pub = secret.data.publicKey as Record<string, unknown>;
          if (pk?.filename) console.log(`  Private Key: ${pk.filename}`);
          if (pub?.filename) console.log(`  Public Key: ${pub.filename}`);
          console.log('\nUse --output <file> to save the keys');
        } else {
          // A resolved field-narrowed link wraps a non-object value as { value }.
          // Unwrap for display, but only when this is a resolved link (the server
          // produces the envelope only then) so an ordinary { value } secret is
          // rendered unchanged.
          const keys = secret.data ? Object.keys(secret.data) : [];
          if (secret.resolvedFrom && keys.length === 1 && keys[0] === 'value') {
            console.log(JSON.stringify(secret.data.value, null, 2));
          } else {
            console.log(JSON.stringify(secret.data, null, 2));
          }
        }
      } catch (error) {
        spinner.fail('Failed to decrypt secret');
        output.error((error as Error).message);
        process.exit(1);
      }
    });
}
