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
import { selectRawValue, RawSelectionError, isFileShaped, type RawPayload } from './raw-value.js';

/** Render an unknown payload value for terminal display: strings verbatim, anything else as JSON. */
function show(value: unknown): string {
  return typeof value === 'string' ? value : JSON.stringify(value);
}

/**
 * Emit a raw payload to stdout. Text gets a trailing newline only on a TTY
 * (so an interactive prompt isn't glued to the value) — piped/redirected
 * output is byte-exact, which is what `$(...)`, `> file` and `| base64` want.
 * Bytes (decoded files) are always written as-is.
 */
function writeRawToStdout(payload: RawPayload): void {
  process.stdout.write(payload.value);
  if (payload.kind === 'text' && process.stdout.isTTY) {
    process.stdout.write('\n');
  }
}

export function registerDecryptCommand(secretCmd: Command): void {
  secretCmd
    .command('decrypt <id-or-alias>')
    .description('Decrypt and show secret value (supports UUID or tenant/alias format)')
    .option('-o, --output <file>', 'Write content to file')
    .option('--json', 'Output as JSON')
    .option('--raw', 'Print only the value, no metadata (for env vars / files). Multi-field secrets need --field')
    .option('--field <name>', 'Print only this field of the secret data (implies --raw)')
    .option('--no-resolve', 'Return the raw, unresolved template/pointer (skip reference resolution)')
    .addHelpText('after', `
Examples:
  znvault secret decrypt zn-admin/config             # by alias path
  znvault secret decrypt alias:web/api-key           # with alias: prefix  // gitleaks:allow reason=generic help-text example, not a real vault path
  znvault secret decrypt abc12345-...                # by UUID
  znvault secret decrypt certs/server-key -o key.pem # save to file
  znvault secret decrypt app/db-url --no-resolve     # raw template, tokens unexpanded

Raw output (value only — nothing else on stdout):
  export API_KEY=$(znvault secret decrypt web/api-key --raw)          # single-value secret
  export DB_PASSWORD=$(znvault secret decrypt db/creds --field password) # one field of a credential
  znvault secret decrypt certs/server-key --raw > key.pem             # file secret → decoded bytes
  znvault secret decrypt ssh/deploy --field privateKey -o id_ed25519  # file-shaped field → file
  Strings are printed verbatim; objects/numbers as compact JSON. A trailing
  newline is added only when stdout is a terminal.
`)
    .action(async (idOrAlias: string, options: DecryptOptions) => {
      const raw = options.raw === true || options.field !== undefined;
      if (raw && options.json === true) {
        output.error('--raw/--field cannot be combined with --json');
        process.exit(1);
      }

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

        if (raw) {
          let payload: RawPayload;
          try {
            payload = selectRawValue(secret.data, options.field);
          } catch (err) {
            if (err instanceof RawSelectionError) {
              output.error(err.message);
              process.exit(1);
            }
            throw err;
          }

          if (options.output) {
            const fs = await import('fs');
            fs.writeFileSync(options.output, payload.value);
            output.success(`Value written to: ${options.output}`);
            return;
          }

          writeRawToStdout(payload);
          return;
        }

        const data = secret.data;

        // If output file specified and it's a file-based secret
        if (options.output) {
          const fs = await import('fs');

          // Check if it's a file-based secret
          if ('content' in data && typeof data.content === 'string') {
            const content = Buffer.from(data.content, 'base64');
            fs.writeFileSync(options.output, content);
            output.success(`File written to: ${options.output}`);
            return;
          }

          // Otherwise write JSON
          fs.writeFileSync(options.output, JSON.stringify(data, null, 2));
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

        if (secret.type === 'credential') {
          if ('username' in data) console.log(`Username: ${show(data.username)}`);
          if ('password' in data) console.log(`Password: ${show(data.password)}`);
          // Show any additional fields
          const knownFields = ['username', 'password'];
          for (const [key, value] of Object.entries(data)) {
            if (!knownFields.includes(key)) {
              console.log(`${key}: ${show(value)}`);
            }
          }
        } else if ('text' in data) {
          // Plain text secret
          console.log(show(data.text));
        } else if ('content' in data && 'filename' in data) {
          // File-based secret
          console.log(`File: ${show(data.filename)}`);
          console.log(`Size: ${formatBytes(Buffer.from(show(data.content), 'base64').length)}`);
          if (typeof data.contentType === 'string' && data.contentType !== '') {
            console.log(`Type: ${data.contentType}`);
          }
          console.log('\nUse --output <file> to save the file content');
        } else if ('privateKey' in data) {
          // Key pair secret
          console.log('Key Pair Secret:');
          if (isFileShaped(data.privateKey)) console.log(`  Private Key: ${data.privateKey.filename}`);
          if (isFileShaped(data.publicKey)) console.log(`  Public Key: ${data.publicKey.filename}`);
          console.log('\nUse --output <file> to save the keys');
        } else {
          // A resolved field-narrowed link wraps a non-object value as { value }.
          // Unwrap for display, but only when this is a resolved link (the server
          // produces the envelope only then) so an ordinary { value } secret is
          // rendered unchanged.
          const keys = Object.keys(data);
          if (secret.resolvedFrom && keys.length === 1 && keys[0] === 'value') {
            console.log(JSON.stringify(data.value, null, 2));
          } else {
            console.log(JSON.stringify(data, null, 2));
          }
        }
      } catch (error) {
        spinner.fail('Failed to decrypt secret');
        output.error((error as Error).message);
        process.exit(1);
      }
    });
}
