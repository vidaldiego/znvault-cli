// Path: src/commands/secret/patch.ts

/**
 * Secret patch command - partial modification of secret data
 *
 * Supports JSON, YAML, env, properties, and TOML formats
 * Uses CLI-side merging: decrypt -> parse -> patch -> full update
 */

import type { Command } from 'commander';
import ora from 'ora';
import { client } from '../../lib/client.js';
import * as output from '../../lib/output.js';
import type { DecryptedSecret, SecretMetadata } from './types.js';
import { resolveSecretId } from './resolve.js';
import {
  type PatchOptions,
  type SecretFormat,
  type PatchOperation,
  SUPPORTED_FORMATS,
  PatchError,
} from './patch/types.js';
import {
  parseSetArgs,
  parseUnsetArgs,
  applyOperations,
  deepClone,
} from './patch/operations.js';
import { getParser, detectFormat } from './patch/parsers.js';
import { generateDiff, displayDiff, displayOperationsSummary } from './patch/diff.js';

/**
 * Extract the raw content from a decrypted secret's data
 * Secrets can store data in different formats:
 * - text: { text: "content" }
 * - raw object: { key: value, ... }
 */
function extractContent(data: Record<string, unknown>): string {
  // If it has a "text" field, use that as the raw content
  if (typeof data.text === 'string') {
    return data.text;
  }

  // Otherwise, serialize the data object as JSON
  return JSON.stringify(data, null, 2);
}

/**
 * Wrap content back into the data structure
 */
function wrapContent(
  originalData: Record<string, unknown>,
  content: string,
  format: SecretFormat
): Record<string, unknown> {
  // If original had a "text" field, preserve that structure
  if (typeof originalData.text === 'string') {
    return { ...originalData, text: content };
  }

  // Otherwise, parse the content based on format
  const parser = getParser(format);
  return parser.parse(content);
}

/**
 * Collect repeatable option values
 */
function collect(value: string, previous: string[]): string[] {
  return previous.concat([value]);
}

export function registerPatchCommand(secretCmd: Command): void {
  secretCmd
    .command('patch <id-or-alias>')
    .description('Partially modify secret data without replacing the entire value')
    .option('--set <path=value>', 'Set/update a key (repeatable)', collect, [])
    .option('--unset <path>', 'Remove a key (repeatable)', collect, [])
    .option('--format <format>', `Force format: ${SUPPORTED_FORMATS.join(', ')}`)
    .option('--dry-run', 'Preview changes without applying')
    .option('--json', 'Output result as JSON')
    .addHelpText('after', `
Examples:
  # JSON: Set top-level key
  znvault secret patch config/app --set api_version=v2

  # JSON: Set nested key (dot notation)
  znvault secret patch config/app --set database.host=db.prod.example.com

  # JSON: Multiple operations
  znvault secret patch config/app \\
    --set database.host=db.example.com \\
    --set database.port=5432 \\
    --unset deprecated_field

  # ENV: Add/update variables
  znvault secret patch config/env --set DATABASE_URL=postgres://... --unset OLD_VAR

  # YAML: Nested paths
  znvault secret patch config/k8s --set spec.replicas=3

  # Array operations
  znvault secret patch config/app --set servers[0]=first-server
  znvault secret patch config/app --set servers[+]=append-new-server

  # Preview changes
  znvault secret patch config/app --set version=2.0 --dry-run

Path Syntax:
  key           Top-level key
  a.b.c         Nested path
  arr[0]        Array index
  arr[+]        Append to array
  a.b[0].c      Mixed path

Value Types:
  true/false    Boolean
  123, 45.67    Number
  null          Null
  {...}, [...]  JSON object/array
  other         String
`)
    .action(async (idOrAlias: string, options: PatchOptions) => {
      // Validate options
      if ((!options.set || options.set.length === 0) &&
          (!options.unset || options.unset.length === 0)) {
        output.error('At least one --set or --unset option is required');
        process.exit(1);
      }

      // Validate format option
      if (options.format !== undefined && !SUPPORTED_FORMATS.includes(options.format)) {
        output.error(`Invalid format: ${options.format}. Supported: ${SUPPORTED_FORMATS.join(', ')}`);
        process.exit(1);
      }

      const spinner = ora('Resolving secret...').start();
      let id: string;
      let secret: DecryptedSecret;

      try {
        // Resolve alias to UUID
        id = await resolveSecretId(idOrAlias);
        spinner.text = 'Decrypting secret...';

        // Decrypt current secret
        secret = await client.post<DecryptedSecret>(`/v1/secrets/${id}/decrypt`, {});
        spinner.stop();
      } catch (error) {
        spinner.fail('Failed to fetch secret');
        output.error((error as Error).message);
        process.exit(1);
      }

      // Parse operations
      let operations: PatchOperation[];
      try {
        const setOps = parseSetArgs(options.set ?? []);
        const unsetOps = parseUnsetArgs(options.unset ?? []);
        operations = [...setOps, ...unsetOps];
      } catch (error) {
        if (error instanceof PatchError) {
          output.error(`Invalid operation: ${error.message}`);
        } else {
          output.error(`Failed to parse operations: ${(error as Error).message}`);
        }
        process.exit(1);
      }

      // Extract content from secret data
      const originalData = secret.data;
      const originalContent = extractContent(originalData);

      // Detect format
      const format = detectFormat(
        originalContent,
        options.format,
        secret.contentType,
        secret.subType
      );

      // Parse content
      let parsedData: Record<string, unknown>;
      try {
        const parser = getParser(format);
        parsedData = parser.parse(originalContent);
      } catch (error) {
        if (error instanceof PatchError) {
          output.error(`Failed to parse secret data as ${format}: ${error.message}`);
        } else {
          output.error(`Parse error: ${(error as Error).message}`);
        }
        process.exit(1);
      }

      // Clone and apply operations
      const modifiedData = deepClone(parsedData);
      let appliedOps;
      try {
        appliedOps = applyOperations(modifiedData, operations);
      } catch (error) {
        if (error instanceof PatchError) {
          output.error(`Failed to apply operation: ${error.message}`);
        } else {
          output.error(`Operation error: ${(error as Error).message}`);
        }
        process.exit(1);
      }

      // Serialize back
      let modifiedContent: string;
      try {
        const parser = getParser(format);
        modifiedContent = parser.stringify(modifiedData);
      } catch (error) {
        if (error instanceof PatchError) {
          output.error(`Failed to serialize to ${format}: ${error.message}`);
        } else {
          output.error(`Serialize error: ${(error as Error).message}`);
        }
        process.exit(1);
      }

      // Dry-run mode: show diff and exit
      if (options.dryRun) {
        const originalSerialized = getParser(format).stringify(parsedData);
        const diff = generateDiff(originalSerialized, modifiedContent, appliedOps);

        if (options.json) {
          output.json({
            dryRun: true,
            format,
            operations: appliedOps,
            diff: {
              before: diff.before,
              after: diff.after,
              changes: diff.changes,
            },
          });
          return;
        }

        output.info(`Dry-run mode - no changes will be applied`);
        console.log();
        console.log(`Secret: ${secret.alias}`);
        console.log(`Format: ${format}`);

        displayDiff(diff);
        displayOperationsSummary(appliedOps);

        console.log();
        output.info('Run without --dry-run to apply changes');
        return;
      }

      // Apply changes
      const updateSpinner = ora('Applying changes...').start();

      try {
        // Wrap content back into the appropriate data structure
        const newData = wrapContent(originalData, modifiedContent, format);

        // Update the secret
        const result = await client.put<SecretMetadata>(`/v1/secrets/${id}`, {
          data: newData,
        });

        updateSpinner.stop();

        if (options.json) {
          output.json({
            success: true,
            id: result.id,
            alias: result.alias,
            version: result.version,
            format,
            operations: appliedOps,
          });
          return;
        }

        output.success('Secret patched successfully!');
        console.log(`  Alias:   ${result.alias}`);
        console.log(`  Version: ${result.version}`);
        console.log(`  Format:  ${format}`);

        displayOperationsSummary(appliedOps);
      } catch (error) {
        updateSpinner.fail('Failed to update secret');
        output.error((error as Error).message);
        process.exit(1);
      }
    });
}
