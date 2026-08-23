// Path: src/commands/secret/create.ts

/**
 * Secret create command
 */

import type { Command } from 'commander';

import inquirer from 'inquirer';
import { client } from '../../lib/client.js';
import * as output from '../../lib/output.js';
import { getAuthContext } from '../../lib/auth-context.js';
import { readStdinUtf8 } from '../../lib/stdin.js';
import type { CreateOptions, SecretMetadata, SuggestResult } from './types.js';
import { formatBytes } from './helpers.js';
import { analyzeFileForSuggestion, formatPemType, type FileAnalysisInfo } from './pem-analysis.js';
import { validateTokenAlias, validateFieldPath, buildLinkData } from './references.js';

export function registerCreateCommand(secretCmd: Command): void {
  secretCmd
    .command('create <alias>')
    .description('Create a new secret (use --suggest for AI naming help)')
    // Note: `--tenant` was removed in v3.0.0. Secret creation is always
    // performed against the caller's own tenant (derived from the JWT).
    // Superadmins must use a tenant principal to create secrets, by design.
    .option('--type <type>', 'Secret type (opaque, credential, setting)', 'opaque')
    .option('--sub-type <subType>', 'Semantic sub-type')
    .option('--tags <tags>', 'Comma-separated tags')
    .option('--ttl <datetime>', 'TTL expiration (ISO 8601)')
    .option('--expires <datetime>', 'Natural expiration (ISO 8601)')
    .option('--content-type <mime>', 'Content type for settings')
    .option('--json', 'Output as JSON')
    .option('--suggest', 'Get AI suggestions for naming (alias becomes description)')
    // Non-interactive data options
    .option('--username <username>', 'Username for credential type (non-interactive)')
    .option('--password <password>', 'Password for credential type (non-interactive)')
    .option('--text <text>', 'Text content (non-interactive)')
    .option('--data <json>', 'JSON data (non-interactive)')
    .option('--data-stdin', 'Read JSON data from stdin (keeps secret values out of argv and files)')
    .option('--enable-references', 'Opt this secret in to ${ref:...} reference resolution')
    .option('--link <alias>', 'Create a link secret pointing at another secret (sets sub-type link)')
    .option('--link-field <path>', 'Narrow a --link to a single field (dot-path, e.g. password or db.host)')
    .option('--file <path>', 'File to upload (non-interactive)')
    .addHelpText('after', `
Examples:
  znvault secret create api/current-key --link secrets/api-key-prod
  znvault secret create app/db-pw --link db/prod/creds --link-field password
  znvault secret create app/db-url --sub-type env --enable-references \\
    --data '{"DATABASE_URL":"postgres://app:\${ref:db/prod/creds#password}@db:5432/app"}'
`)
    .action(async (aliasOrDescription: string, options: CreateOptions, cmd: Command) => {
      let alias = aliasOrDescription;
      let actualType = options.type || 'opaque';
      let actualSubType = options.subType;
      let actualTags = options.tags;

      if (options.dataStdin === true && (
        options.data !== undefined
        || options.text !== undefined
        || options.username !== undefined
        || options.password !== undefined
        || options.file !== undefined
      )) {
        output.error(
          '--data-stdin cannot be combined with --data/--text/--username/--password/--file.',
        );
        process.exit(1);
      }

      // --- Link-secret construction and conflict gating (Secret References) ---
      let linkData: Record<string, unknown> | undefined;
      if (options.link !== undefined) {
        const dataBearing = options.data !== undefined
          || options.text !== undefined
          || options.username !== undefined
          || options.password !== undefined
          || options.file !== undefined
          || options.dataStdin === true;
        if (dataBearing) {
          output.error(
            '--link cannot be combined with --data/--data-stdin/--text/--username/--password/--file '
            + "(a link's value is its pointer).",
          );
          process.exit(1);
        }
        if (options.subType && options.subType !== 'link') {
          output.error('--link cannot be combined with --sub-type (a link sets its own sub-type).');
          process.exit(1);
        }
        if (cmd.getOptionValueSource('type') === 'cli' && options.type !== 'setting') {
          output.error("--link cannot be combined with an explicit --type other than 'setting'.");
          process.exit(1);
        }
        if (options.suggest) {
          output.error('--link cannot be combined with --suggest.');
          process.exit(1);
        }
        const aliasCheck = validateTokenAlias(options.link);
        if (!aliasCheck.valid) {
          output.error(`Invalid --link alias: ${aliasCheck.error}.`);
          process.exit(1);
        }
        if (options.linkField !== undefined) {
          const fieldCheck = validateFieldPath(options.linkField);
          if (!fieldCheck.valid) {
            output.error(`Invalid --link-field path: ${fieldCheck.error}.`);
            process.exit(1);
          }
        }
        linkData = buildLinkData(options.link, options.linkField) as unknown as Record<string, unknown>;
        actualType = 'setting';
        actualSubType = 'link';
      } else if (options.linkField !== undefined) {
        output.error('--link-field requires --link.');
        process.exit(1);
      }

      // AI Suggestion flow
      if (options.suggest) {
        // Analyze file if --file is provided
        let fileInfo: FileAnalysisInfo | null = null;
        if (options.file) {
          const analyzeSpinner = output.spinner('Analyzing file...').start();
          fileInfo = await analyzeFileForSuggestion(options.file);
          analyzeSpinner.stop();

          if (fileInfo) {
            output.section('File Analysis');
            const analysisInfo: Record<string, string> = {
              'Filename': fileInfo.filename,
              'Extension': fileInfo.extension,
              'MIME Type': fileInfo.mimeType,
              'Size': formatBytes(fileInfo.size),
            };

            if (fileInfo.pemInfo) {
              analysisInfo['PEM Type'] = formatPemType(fileInfo.pemInfo.type);
              if (fileInfo.pemInfo.algorithm) {
                analysisInfo.Algorithm = fileInfo.pemInfo.algorithm.toUpperCase();
              }
              if (fileInfo.pemInfo.detectedPurpose) {
                analysisInfo['Detected Purpose'] = fileInfo.pemInfo.detectedPurpose;
              }
              if (fileInfo.pemInfo.isAppleP8) {
                analysisInfo.Special = 'Apple .p8 authentication key';
              }
              if (fileInfo.pemInfo.certificateCount && fileInfo.pemInfo.certificateCount > 1) {
                analysisInfo.Certificates = `${fileInfo.pemInfo.certificateCount} (chain/bundle)`;
              }
            }

            output.keyValue(analysisInfo);
            console.log();
          }
        }

        const spinner = output.spinner('Getting AI suggestions...').start();

        try {
          const body: Record<string, unknown> = { description: aliasOrDescription };

          // Include file analysis in the request
          if (fileInfo) {
            body.fileInfo = fileInfo;
          }

          const response = await client.post<{
            success: boolean;
            data: SuggestResult;
          }>('/v1/advisor/suggest', body);

          spinner.stop();

          const result = response.data;

          // Show suggestions
          output.section('AI Suggestions');
          output.keyValue({
            'Suggested Alias': result.alias,
            'Type': result.type,
            'Sub-Type': result.subType ?? '-',
            'Tags': result.tags.join(', ') || 'none',
            'Confidence': `${Math.round(result.confidence * 100)}%`,
          });

          if (result.alternativeAliases && result.alternativeAliases.length > 0) {
            output.info(`Alternatives: ${result.alternativeAliases.join(', ')}`);
          }

          if (result.warnings && result.warnings.length > 0) {
            for (const w of result.warnings) {
              console.log(`  ⚠ ${w}`);
            }
          }

          console.log(`\nReasoning: ${result.reasoning}\n`);

          // Let user confirm or modify
          const aliasChoices = [
            { name: `${result.alias} (suggested)`, value: result.alias },
            ...(result.alternativeAliases ?? []).map(a => ({ name: a, value: a })),
            { name: 'Enter custom alias', value: '__custom__' },
          ];

          const { useAlias } = await inquirer.prompt<{ useAlias: string }>([
            {
              type: 'list',
              name: 'useAlias',
              message: 'Use which alias?',
              choices: aliasChoices,
            },
          ]);

          if (useAlias === '__custom__') {
            const { customAlias } = await inquirer.prompt<{ customAlias: string }>([
              { type: 'input', name: 'customAlias', message: 'Enter alias:' },
            ]);
            alias = customAlias;
          } else {
            alias = useAlias;
          }

          // Apply suggested values (unless overridden by CLI options)
          if (!options.type || options.type === 'opaque') {
            actualType = result.type;
          }
          if (!options.subType && result.subType) {
            actualSubType = result.subType;
          }
          if (!options.tags && result.tags.length > 0) {
            actualTags = result.tags.join(',');
          }

          output.success(`Using alias: ${alias}`);
          console.log();

        } catch (err) {
          spinner.fail('Failed to get AI suggestions');
          output.error(err instanceof Error ? err.message : String(err));

          // Continue without suggestions?
          const { continueWithout } = await inquirer.prompt<{ continueWithout: boolean }>([
            {
              type: 'confirm',
              name: 'continueWithout',
              message: 'Continue creating secret without AI suggestions?',
              default: true,
            },
          ]);

          if (!continueWithout) {
            process.exit(0);
          }

          // Use the description as alias
          alias = aliasOrDescription;
        }
      }

      // Resolve tenant from the authenticated principal. Superadmins do not
      // have a tenantId in their JWT and cannot create secrets through this
      // command — they must log in as a tenant principal.
      const authContext = getAuthContext();
      const tenantId = authContext.tenantId;

      if (!tenantId) {
        output.error(
          'Tenant principal required. `znvault secret create` does not work for superadmin '
          + 'accounts (separation of duties). Log in as a tenant user instead.'
        );
        process.exit(1);
      }

      let data: Record<string, unknown> = {};

      // Check for non-interactive data options first. A --link owns the value
      // (its pointer), so it bypasses both interactive and other non-interactive
      // data collection.
      const hasNonInteractiveData = options.username !== undefined
        || options.password !== undefined
        || options.text !== undefined
        || options.data !== undefined
        || options.file !== undefined
        || options.dataStdin === true;

      if (linkData) {
        data = linkData;
      } else if (hasNonInteractiveData) {
        // Non-interactive mode: use CLI options
        if (options.username || options.password) {
          actualType = 'credential';
          data = {
            username: options.username ?? '',
            password: options.password ?? '',
          };
        } else if (options.text) {
          data = { text: options.text };
        } else if (options.dataStdin === true) {
          let stdinData: string;
          try {
            stdinData = await readStdinUtf8();
          } catch (error) {
            output.error(`Failed to read --data-stdin: ${(error as Error).message}`);
            process.exit(1);
          }

          if (stdinData.trim().length === 0) {
            output.error('--data-stdin received empty input');
            process.exit(1);
          }

          try {
            const parsed: unknown = JSON.parse(stdinData);
            if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
              throw new Error('secret data must be a JSON object');
            }
            data = parsed as Record<string, unknown>;
          } catch {
            output.error('Invalid JSON received by --data-stdin');
            process.exit(1);
          }
        } else if (options.data) {
          try {
            data = JSON.parse(options.data);
          } catch {
            output.error('Invalid JSON in --data option');
            process.exit(1);
          }
        } else if (options.file) {
          const fs = await import('fs');
          const pathModule = await import('path');

          if (!fs.existsSync(options.file)) {
            output.error(`File not found: ${options.file}`);
            process.exit(1);
          }

          const content = fs.readFileSync(options.file);
          const filename = pathModule.basename(options.file);

          data = {
            filename,
            content: content.toString('base64'),
            contentType: options.contentType ?? 'application/octet-stream',
          };
        }
      } else {
        // Interactive mode: prompt for data
        const { dataType } = await inquirer.prompt<{ dataType: string }>([
          {
            type: 'list',
            name: 'dataType',
            message: 'What type of data?',
            choices: [
              { name: 'Credential (username/password)', value: 'credential' },
              { name: 'Plain Text', value: 'text' },
              { name: 'Key-Value pairs', value: 'keyvalue' },
              { name: 'File upload', value: 'file' },
            ],
          },
        ]);

        if (dataType === 'credential') {
          actualType = 'credential';
          const answers = await inquirer.prompt<{ username: string; password: string }>([
            { type: 'input', name: 'username', message: 'Username:' },
            { type: 'password', name: 'password', message: 'Password:', mask: '*' },
          ]);
          data = answers;
        } else if (dataType === 'text') {
          const { text } = await inquirer.prompt<{ text: string }>([
            { type: 'editor', name: 'text', message: 'Enter text content:' },
          ]);
          data = { text: text.trim() };
        } else if (dataType === 'keyvalue') {
          console.log('Enter key-value pairs (empty key to finish):');
          while (true) {
            const { key } = await inquirer.prompt<{ key: string }>([
              { type: 'input', name: 'key', message: 'Key:' },
            ]);
            if (!key) break;
            const { value } = await inquirer.prompt<{ value: string }>([
              { type: 'input', name: 'value', message: `Value for "${key}":` },
            ]);
            data[key] = value;
          }
        } else if (dataType === 'file') {
          const { filePath } = await inquirer.prompt<{ filePath: string }>([
            { type: 'input', name: 'filePath', message: 'File path:' },
          ]);

          const fs = await import('fs');
          const pathModule = await import('path');

          if (!fs.existsSync(filePath)) {
            output.error(`File not found: ${filePath}`);
            process.exit(1);
          }

          const content = fs.readFileSync(filePath);
          const filename = pathModule.basename(filePath);

          data = {
            filename,
            content: content.toString('base64'),
            contentType: options.contentType ?? 'application/octet-stream',
          };
        }
      }

      const spinner = output.spinner('Creating secret...').start();

      try {
        // Body does NOT include `tenant`; the server derives tenant from
        // the authenticated principal's JWT. We retain the local tenantId
        // only for nicer error messages above.
        void tenantId;
        const body: Record<string, unknown> = {
          alias,
          type: actualType,
          data,
        };

        if (actualSubType) body.subType = actualSubType;
        if (actualTags) body.tags = actualTags.split(',').map(t => t.trim());
        if (options.ttl) body.ttlUntil = options.ttl;
        if (options.expires) body.expiresAt = options.expires;
        if (options.contentType) body.contentType = options.contentType;

        // Opt in to ${ref:...} resolution (ignored for a link — inherently a reference).
        if (options.enableReferences !== undefined && !linkData) {
          body.enableReferences = options.enableReferences;
        }

        const result = await client.post<SecretMetadata>('/v1/secrets', body);
        spinner.stop();

        if (options.json) {
          output.json(result);
          return;
        }

        output.success(`Secret created successfully!`);
        console.log(`  ID:     ${result.id}`);
        console.log(`  Alias:  ${result.alias}`);
        console.log(`  Tenant: ${result.tenant}`);
        if (result.references) {
          console.log(`  References: ${result.references.count}`);
        }
      } catch (error) {
        spinner.fail('Failed to create secret');
        output.error((error as Error).message);
        process.exit(1);
      }
    });
}
