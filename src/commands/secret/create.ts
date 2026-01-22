// Path: src/commands/secret/create.ts

/**
 * Secret create command
 */

import type { Command } from 'commander';
import ora from 'ora';
import inquirer from 'inquirer';
import { client } from '../../lib/client.js';
import * as output from '../../lib/output.js';
import { getAuthContext } from '../../lib/auth-context.js';
import type { CreateOptions, SecretMetadata, SuggestResult } from './types.js';
import { formatBytes } from './helpers.js';
import { analyzeFileForSuggestion, formatPemType, type FileAnalysisInfo } from './pem-analysis.js';

export function registerCreateCommand(secretCmd: Command): void {
  secretCmd
    .command('create <alias>')
    .description('Create a new secret (use --suggest for AI naming help)')
    .option('-t, --tenant <id>', 'Tenant ID (defaults to current user tenant)')
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
    .option('--file <path>', 'File to upload (non-interactive)')
    .action(async (aliasOrDescription: string, options: CreateOptions) => {
      let alias = aliasOrDescription;
      let actualType = options.type || 'opaque';
      let actualSubType = options.subType;
      let actualTags = options.tags;

      // AI Suggestion flow
      if (options.suggest) {
        const tenant = options.tenant || 'me';

        // Analyze file if --file is provided
        let fileInfo: FileAnalysisInfo | null = null;
        if (options.file) {
          const analyzeSpinner = ora('Analyzing file...').start();
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

        const spinner = ora('Getting AI suggestions...').start();

        try {
          const body: Record<string, unknown> = { description: aliasOrDescription };

          // Include file analysis in the request
          if (fileInfo) {
            body.fileInfo = fileInfo;
          }

          const response = await client.post<{
            success: boolean;
            data: SuggestResult;
          }>(`/v1/advisor/${tenant}/suggest`, body);

          spinner.stop();

          const result = response.data;

          // Show suggestions
          output.section('AI Suggestions');
          output.keyValue({
            'Suggested Alias': result.alias,
            'Type': result.type,
            'Sub-Type': result.subType || '-',
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
            ...(result.alternativeAliases || []).map(a => ({ name: a, value: a })),
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

      // Resolve tenant: use explicit option, or get from stored credentials
      const authContext = getAuthContext();
      const tenantId = options.tenant || authContext.tenantId;

      if (!tenantId) {
        output.error('Tenant is required. Use --tenant <id> or login to a tenant account.');
        process.exit(1);
      }

      let data: Record<string, unknown> = {};

      // Check for non-interactive data options first
      const hasNonInteractiveData = options.username || options.password || options.text || options.data || options.file;

      if (hasNonInteractiveData) {
        // Non-interactive mode: use CLI options
        if (options.username || options.password) {
          actualType = 'credential';
          data = {
            username: options.username || '',
            password: options.password || '',
          };
        } else if (options.text) {
          data = { text: options.text };
        } else if (options.data) {
          try {
            data = JSON.parse(options.data);
          } catch (e) {
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
            contentType: options.contentType || 'application/octet-stream',
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
            contentType: options.contentType || 'application/octet-stream',
          };
        }
      }

      const spinner = ora('Creating secret...').start();

      try {
        const body: Record<string, unknown> = {
          alias,
          tenant: tenantId,
          type: actualType,
          data,
        };

        if (actualSubType) body.subType = actualSubType;
        if (actualTags) body.tags = actualTags.split(',').map(t => t.trim());
        if (options.ttl) body.ttlUntil = options.ttl;
        if (options.expires) body.expiresAt = options.expires;
        if (options.contentType) body.contentType = options.contentType;

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
      } catch (error) {
        spinner.fail('Failed to create secret');
        output.error((error as Error).message);
        process.exit(1);
      }
    });
}
