// Path: znvault-cli/src/commands/secret.ts
// CLI commands for secrets management

import { type Command } from 'commander';
import ora from 'ora';
import Table from 'cli-table3';
import inquirer from 'inquirer';
import { client } from '../lib/client.js';
import * as output from '../lib/output.js';

// ============================================================================
// Type Definitions
// ============================================================================

interface SecretMetadata {
  id: string;
  alias: string;
  tenant: string;
  type: 'opaque' | 'credential' | 'setting';
  subType?: string;
  version: number;
  fileName?: string;
  fileSize?: number;
  fileMime?: string;
  expiresAt?: string;
  ttlUntil?: string;
  tags?: string[];
  contentType?: string;
  createdBy?: string;
  createdAt: string;
  updatedAt: string;
}

interface DecryptedSecret extends SecretMetadata {
  data: Record<string, unknown>;
  content_type?: string;
}

interface ListOptions {
  tenant?: string;
  type?: string;
  subType?: string;
  aliasPrefix?: string;
  expiring?: string;
  json?: boolean;
}

interface GetOptions {
  json?: boolean;
}

interface DecryptOptions {
  output?: string;
  json?: boolean;
}

interface CreateOptions {
  tenant?: string;
  type: string;
  subType?: string;
  tags?: string;
  ttl?: string;
  expires?: string;
  contentType?: string;
  json?: boolean;
  suggest?: boolean;
  // Non-interactive data options
  username?: string;
  password?: string;
  text?: string;
  data?: string;
  file?: string;
}

interface SuggestResult {
  alias: string;
  alternativeAliases?: string[];
  type: string;
  subType?: string;
  tags: string[];
  expiresInDays?: number;
  rotationRecommendation?: string;
  warnings?: string[];
  confidence: number;
  reasoning: string;
}

/**
 * PEM file analysis result
 */
interface PEMInfo {
  type: 'certificate' | 'private-key' | 'public-key' | 'csr' | 'bundle' | 'encrypted-key' | 'unknown';
  algorithm?: 'rsa' | 'ec' | 'ed25519' | 'dsa' | 'unknown';
  pemHeaders: string[];
  blockCount: number;
  certificateCount?: number;
  detectedPurpose?: string;
  isAppleP8?: boolean;
}

/**
 * File analysis info for LLM
 */
interface FileAnalysisInfo {
  filename: string;
  extension: string;
  mimeType: string;
  size: number;
  pemInfo?: PEMInfo;
}

interface UpdateOptions {
  tags?: string;
  ttl?: string;
  expires?: string;
  json?: boolean;
  // Non-interactive data option
  data?: string;
}

interface DeleteOptions {
  force?: boolean;
}

interface RotateOptions {
  json?: boolean;
}

interface CopyOptions {
  noMetadata?: boolean;
  json?: boolean;
}

// ============================================================================
// Helper Functions
// ============================================================================

function formatDate(dateStr: string | undefined): string {
  if (!dateStr) return '-';
  return new Date(dateStr).toLocaleString();
}

function formatType(type: string, subType?: string): string {
  if (subType) return `${type}/${subType}`;
  return type;
}

function formatTags(tags?: string[]): string {
  if (!tags || tags.length === 0) return '-';
  if (tags.length <= 3) return tags.join(', ');
  return `${tags.slice(0, 2).join(', ')} +${tags.length - 2} more`;
}

function truncateAlias(alias: string, maxLen = 40): string {
  if (alias.length <= maxLen) return alias;
  return '...' + alias.slice(-(maxLen - 3));
}

function formatBytes(bytes?: number): string {
  if (!bytes) return '-';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function getDaysUntilExpiry(expiresAt?: string): number | null {
  if (!expiresAt) return null;
  const expires = new Date(expiresAt);
  const now = new Date();
  return Math.ceil((expires.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
}

// ============================================================================
// PEM File Analysis (for --suggest with --file)
// ============================================================================

const PEM_HEADER_MAP: Record<string, { type: PEMInfo['type']; algorithm?: PEMInfo['algorithm'] }> = {
  'PRIVATE KEY': { type: 'private-key' },
  'RSA PRIVATE KEY': { type: 'private-key', algorithm: 'rsa' },
  'EC PRIVATE KEY': { type: 'private-key', algorithm: 'ec' },
  'DSA PRIVATE KEY': { type: 'private-key', algorithm: 'dsa' },
  'OPENSSH PRIVATE KEY': { type: 'private-key' },
  'ENCRYPTED PRIVATE KEY': { type: 'encrypted-key' },
  'PUBLIC KEY': { type: 'public-key' },
  'RSA PUBLIC KEY': { type: 'public-key', algorithm: 'rsa' },
  'EC PUBLIC KEY': { type: 'public-key', algorithm: 'ec' },
  'CERTIFICATE': { type: 'certificate' },
  'X509 CERTIFICATE': { type: 'certificate' },
  'CERTIFICATE REQUEST': { type: 'csr' },
};

function detectKeyAlgorithm(content: string): PEMInfo['algorithm'] | undefined {
  if (content.includes('EC PRIVATE KEY') || content.includes('EC PUBLIC KEY')) return 'ec';
  if (content.includes('RSA PRIVATE KEY') || content.includes('RSA PUBLIC KEY')) return 'rsa';

  // Check for EC curve OIDs
  const ecOidPatterns = ['BggqhkjOPQMBBw', 'BgUrgQQAIg', 'BgUrgQQAIw'];
  for (const pattern of ecOidPatterns) {
    if (content.includes(pattern)) return 'ec';
  }

  // Size-based heuristic for generic keys
  const keyMatch = /-----BEGIN (?:PRIVATE KEY|PUBLIC KEY)-----\s*([\s\S]*?)\s*-----END/;
  const keyContent = keyMatch.exec(content);
  if (keyContent) {
    const keyBase64 = keyContent[1].replace(/\s/g, '');
    if (keyBase64.length < 400) return 'ec';
    if (keyBase64.length > 1000) return 'rsa';
  }

  return 'unknown';
}

function detectPurpose(filename: string, type: PEMInfo['type'], algorithm?: PEMInfo['algorithm'], headers?: string[]): string | undefined {
  const lowerFilename = filename.toLowerCase();

  if (lowerFilename.endsWith('.p8') || lowerFilename.includes('authkey')) {
    if (type === 'private-key' && algorithm === 'ec') {
      return 'Apple Push Notification Service (APNS) authentication key';
    }
    return 'Apple authentication key (.p8)';
  }

  if (lowerFilename.includes('ssl') || lowerFilename.includes('tls')) {
    if (type === 'certificate') return 'SSL/TLS certificate';
    if (type === 'private-key') return 'SSL/TLS private key';
    if (type === 'bundle') return 'SSL/TLS certificate bundle';
  }

  if (lowerFilename.includes('ca') || lowerFilename.includes('root') || lowerFilename.includes('intermediate')) {
    if (type === 'certificate') return 'Certificate Authority (CA) certificate';
    if (type === 'bundle') return 'CA certificate chain';
  }

  // JWT/API signing (check before generic "sign" to avoid false matches)
  if (lowerFilename.includes('jwt') || lowerFilename.includes('signing')) {
    if (type === 'private-key') return 'JWT/API signing key';
    if (type === 'public-key') return 'JWT/API verification key';
  }

  // Code signing (codesign specifically, not just "sign")
  if (lowerFilename.includes('codesign') || (lowerFilename.includes('sign') && !lowerFilename.includes('signing'))) {
    if (type === 'certificate') return 'Code signing certificate';
    if (type === 'private-key') return 'Code signing private key';
  }

  if (lowerFilename.includes('ssh') || lowerFilename.startsWith('id_') || headers?.some(h => h.includes('OPENSSH'))) {
    if (type === 'private-key') return 'SSH private key';
    if (type === 'public-key') return 'SSH public key';
  }

  if (type === 'certificate') return 'X.509 certificate';
  if (type === 'bundle') return 'Certificate bundle/chain';
  if (type === 'csr') return 'Certificate Signing Request (CSR)';
  if (type === 'encrypted-key') return 'Encrypted private key (password protected)';

  return undefined;
}

function analyzePEMContent(content: string, filename: string): PEMInfo | null {
  const headerRegex = /-----BEGIN ([A-Z0-9 ]+)-----/g;
  const headers: string[] = [];
  let match;

  while ((match = headerRegex.exec(content)) !== null) {
    headers.push(match[1]);
  }

  if (headers.length === 0) return null;

  const certificateCount = headers.filter(h => h.includes('CERTIFICATE')).length;
  const privateKeyHeaders = headers.filter(h => h.includes('PRIVATE KEY'));
  const publicKeyHeaders = headers.filter(h => h.includes('PUBLIC KEY'));
  const csrHeaders = headers.filter(h => h.includes('CERTIFICATE REQUEST'));

  let type: PEMInfo['type'] = 'unknown';
  let algorithm: PEMInfo['algorithm'] | undefined;

  if (certificateCount > 1 || (certificateCount >= 1 && privateKeyHeaders.length >= 1)) {
    type = 'bundle';
  } else if (privateKeyHeaders.length > 0) {
    const keyHeader = privateKeyHeaders[0];
    const mapping = PEM_HEADER_MAP[keyHeader];
    type = mapping?.type ?? 'private-key';
    algorithm = mapping?.algorithm;
    if (keyHeader.includes('ENCRYPTED')) type = 'encrypted-key';
  } else if (publicKeyHeaders.length > 0) {
    const keyHeader = publicKeyHeaders[0];
    const mapping = PEM_HEADER_MAP[keyHeader];
    type = mapping?.type ?? 'public-key';
    algorithm = mapping?.algorithm;
  } else if (csrHeaders.length > 0) {
    type = 'csr';
  } else if (certificateCount > 0) {
    type = 'certificate';
  }

  if (!algorithm && (type === 'private-key' || type === 'public-key')) {
    algorithm = detectKeyAlgorithm(content);
  }

  const detectedPurpose = detectPurpose(filename, type, algorithm, headers);
  const lowerFilename = filename.toLowerCase();
  const isAppleP8 = type === 'private-key' && algorithm === 'ec' &&
    (lowerFilename.endsWith('.p8') || lowerFilename.includes('authkey'));

  return {
    type,
    algorithm,
    pemHeaders: headers,
    blockCount: headers.length,
    certificateCount: certificateCount > 0 ? certificateCount : undefined,
    detectedPurpose,
    isAppleP8: isAppleP8 || undefined,
  };
}

function detectMimeType(content: Buffer): string {
  const text = content.toString('utf8', 0, 100);
  if (text.includes('-----BEGIN')) return 'application/x-pem-file';
  return 'application/octet-stream';
}

async function analyzeFileForSuggestion(filePath: string): Promise<FileAnalysisInfo | null> {
  const fs = await import('fs');
  const pathModule = await import('path');

  if (!fs.existsSync(filePath)) return null;

  const content = fs.readFileSync(filePath);
  const filename = pathModule.basename(filePath);
  const extension = pathModule.extname(filePath).toLowerCase();
  const mimeType = detectMimeType(content);

  const result: FileAnalysisInfo = {
    filename,
    extension,
    mimeType,
    size: content.length,
  };

  // Analyze PEM content for relevant file types
  const pemExtensions = ['.pem', '.crt', '.cer', '.key', '.p8', '.p12', '.pfx', '.pub'];
  if (mimeType === 'application/x-pem-file' || pemExtensions.includes(extension)) {
    const textContent = content.toString('utf8');
    const pemInfo = analyzePEMContent(textContent, filename);
    if (pemInfo) {
      result.pemInfo = pemInfo;
    }
  }

  return result;
}

function formatPemType(type: string): string {
  const typeMap: Record<string, string> = {
    'private-key': 'Private Key',
    'public-key': 'Public Key',
    'certificate': 'X.509 Certificate',
    'csr': 'Certificate Signing Request',
    'bundle': 'Certificate Bundle/Chain',
    'encrypted-key': 'Encrypted Private Key',
    'unknown': 'Unknown PEM format',
  };
  return typeMap[type] ?? type;
}

function formatExpiry(expiresAt?: string): string {
  if (!expiresAt) return '-';
  const days = getDaysUntilExpiry(expiresAt);
  if (days === null) return '-';
  if (days < 0) return `Expired ${Math.abs(days)}d ago`;
  if (days === 0) return 'Expires today';
  if (days <= 7) return `${days}d (!)`;
  if (days <= 30) return `${days}d`;
  return `${days}d`;
}

// ============================================================================
// Command Implementations
// ============================================================================

async function listSecrets(options: ListOptions): Promise<void> {
  const spinner = ora('Fetching secrets...').start();

  try {
    const query: Record<string, string | undefined> = {};
    if (options.tenant) query.tenant = options.tenant;
    if (options.type) query.type = options.type;
    if (options.subType) query.subType = options.subType;
    if (options.aliasPrefix) query.aliasPrefix = options.aliasPrefix;
    if (options.expiring) {
      const days = parseInt(options.expiring, 10);
      const expiringBefore = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
      query.expiringBefore = expiringBefore;
    }

    const secrets = await client.get<SecretMetadata[]>('/v1/secrets?' + new URLSearchParams(query as Record<string, string>).toString());
    spinner.stop();

    if (options.json) {
      output.json(secrets);
      return;
    }

    if (secrets.length === 0) {
      output.info('No secrets found');
      return;
    }

    const table = new Table({
      head: ['ID', 'Alias', 'Tenant', 'Type', 'Ver', 'Expires', 'Tags', 'Updated'],
      colWidths: [12, 42, 12, 16, 5, 14, 20, 20],
      wordWrap: true,
    });

    for (const secret of secrets) {
      table.push([
        secret.id.slice(0, 10) + '...',
        truncateAlias(secret.alias),
        secret.tenant.slice(0, 10),
        formatType(secret.type, secret.subType),
        String(secret.version),
        formatExpiry(secret.expiresAt || secret.ttlUntil),
        formatTags(secret.tags),
        formatDate(secret.updatedAt).split(',')[0], // Just date
      ]);
    }

    console.log(table.toString());
    output.info(`Total: ${secrets.length} secret(s)`);
  } catch (error) {
    spinner.fail('Failed to list secrets');
    output.error((error as Error).message);
    process.exit(1);
  }
}

async function getSecret(id: string, options: GetOptions): Promise<void> {
  const spinner = ora('Fetching secret metadata...').start();

  try {
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
  } catch (error) {
    spinner.fail('Failed to get secret');
    output.error((error as Error).message);
    process.exit(1);
  }
}

async function decryptSecret(id: string, options: DecryptOptions): Promise<void> {
  const spinner = ora('Decrypting secret...').start();

  try {
    const secret = await client.post<DecryptedSecret>(`/v1/secrets/${id}/decrypt`, {});
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
        const content = Buffer.from(secret.data.content as string, 'base64');
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
      // Generic key-value
      console.log(JSON.stringify(secret.data, null, 2));
    }
  } catch (error) {
    spinner.fail('Failed to decrypt secret');
    output.error((error as Error).message);
    process.exit(1);
  }
}

async function createSecret(aliasOrDescription: string, options: CreateOptions): Promise<void> {
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
            analysisInfo['Algorithm'] = fileInfo.pemInfo.algorithm.toUpperCase();
          }
          if (fileInfo.pemInfo.detectedPurpose) {
            analysisInfo['Detected Purpose'] = fileInfo.pemInfo.detectedPurpose;
          }
          if (fileInfo.pemInfo.isAppleP8) {
            analysisInfo['Special'] = 'Apple .p8 authentication key';
          }
          if (fileInfo.pemInfo.certificateCount && fileInfo.pemInfo.certificateCount > 1) {
            analysisInfo['Certificates'] = `${fileInfo.pemInfo.certificateCount} (chain/bundle)`;
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

  // Tenant is required for creating secrets
  if (!options.tenant && !options.suggest) {
    output.error('Tenant is required. Use --tenant <id> or --suggest to infer from auth context');
    process.exit(1);
  }

  // For suggest mode without explicit tenant, we need to get tenant from context
  // The API will infer it, but we still need it for the create call
  const tenantId = options.tenant || 'me';

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
}

async function updateSecret(id: string, options: UpdateOptions): Promise<void> {
  let newData: Record<string, unknown> | undefined;

  // Check for non-interactive data option
  if (options.data) {
    // Non-interactive mode: parse JSON data from CLI
    try {
      newData = JSON.parse(options.data);
    } catch {
      output.error('Invalid JSON in --data option');
      process.exit(1);
    }
  } else {
    // Interactive mode: prompt for data
    const spinner = ora('Fetching current secret...').start();

    try {
      const current = await client.post<DecryptedSecret>(`/v1/secrets/${id}/decrypt`, {});
      spinner.stop();

      const { updateData } = await inquirer.prompt<{ updateData: boolean }>([
        {
          type: 'confirm',
          name: 'updateData',
          message: 'Update the secret data?',
          default: false,
        },
      ]);

      newData = current.data;

      if (updateData) {
        if (current.type === 'credential') {
          const answers = await inquirer.prompt<{ username: string; password: string }>([
            {
              type: 'input',
              name: 'username',
              message: 'Username:',
              default: current.data.username as string
            },
            {
              type: 'password',
              name: 'password',
              message: 'Password (leave empty to keep current):',
              mask: '*'
            },
          ]);
          newData = {
            username: answers.username,
            password: answers.password || current.data.password,
          };
        } else {
          const { dataJson } = await inquirer.prompt<{ dataJson: string }>([
            {
              type: 'editor',
              name: 'dataJson',
              message: 'Edit data (JSON):',
              default: JSON.stringify(current.data, null, 2),
            },
          ]);
          try {
            newData = JSON.parse(dataJson);
          } catch {
            output.error('Invalid JSON data');
            process.exit(1);
          }
        }
      }
    } catch (error) {
      spinner.fail('Failed to fetch current secret');
      output.error((error as Error).message);
      process.exit(1);
    }
  }

  const updateSpinner = ora('Updating secret...').start();

  try {

    const body: Record<string, unknown> = { data: newData };
    if (options.tags) body.tags = options.tags.split(',').map(t => t.trim());
    if (options.ttl) body.ttlUntil = options.ttl;
    if (options.expires) body.expiresAt = options.expires;

    const result = await client.put<SecretMetadata>(`/v1/secrets/${id}`, body);
    updateSpinner.stop();

    if (options.json) {
      output.json(result);
      return;
    }

    output.success('Secret updated successfully!');
    console.log(`  Version: ${result.version}`);
  } catch (error) {
    updateSpinner.fail('Failed to update secret');
    output.error((error as Error).message);
    process.exit(1);
  }
}

async function deleteSecret(id: string, options: DeleteOptions): Promise<void> {
  if (!options.force) {
    // Get metadata first
    const spinner = ora('Fetching secret...').start();
    try {
      const secret = await client.get<SecretMetadata>(`/v1/secrets/${id}/meta`);
      spinner.stop();

      const { confirm } = await inquirer.prompt<{ confirm: boolean }>([
        {
          type: 'confirm',
          name: 'confirm',
          message: `Delete secret "${secret.alias}" (${id})? This cannot be undone.`,
          default: false,
        },
      ]);

      if (!confirm) {
        output.info('Deletion cancelled');
        return;
      }
    } catch (error) {
      spinner.fail('Failed to fetch secret');
      output.error((error as Error).message);
      process.exit(1);
    }
  }

  const deleteSpinner = ora('Deleting secret...').start();

  try {
    await client.delete(`/v1/secrets/${id}`);
    deleteSpinner.stop();
    output.success('Secret deleted successfully');
  } catch (error) {
    deleteSpinner.fail('Failed to delete secret');
    output.error((error as Error).message);
    process.exit(1);
  }
}

async function rotateSecret(id: string, options: RotateOptions): Promise<void> {
  // Get current secret first
  const spinner = ora('Fetching current secret...').start();

  try {
    const current = await client.post<DecryptedSecret>(`/v1/secrets/${id}/decrypt`, {});
    spinner.stop();

    console.log(`Current secret: ${current.alias} (v${current.version})`);

    // Prompt for new data
    let newData: Record<string, unknown>;

    if (current.type === 'credential') {
      const answers = await inquirer.prompt<{ password: string }>([
        {
          type: 'password',
          name: 'password',
          message: 'New password:',
          mask: '*',
          validate: (input: string) => input.length > 0 || 'Password is required',
        },
      ]);
      newData = {
        username: current.data.username,
        password: answers.password,
      };
    } else {
      const { dataJson } = await inquirer.prompt<{ dataJson: string }>([
        {
          type: 'editor',
          name: 'dataJson',
          message: 'Enter new data (JSON):',
          default: JSON.stringify(current.data, null, 2),
        },
      ]);
      try {
        newData = JSON.parse(dataJson);
      } catch {
        output.error('Invalid JSON data');
        process.exit(1);
      }
    }

    const rotateSpinner = ora('Rotating secret...').start();

    const result = await client.post<SecretMetadata>(`/v1/secrets/${id}/rotate`, { data: newData });
    rotateSpinner.stop();

    if (options.json) {
      output.json(result);
      return;
    }

    output.success('Secret rotated successfully!');
    console.log(`  New Version: ${result.version}`);
  } catch (error) {
    spinner.fail('Failed to rotate secret');
    output.error((error as Error).message);
    process.exit(1);
  }
}

interface HistoryEntry {
  version: number;
  createdAt: string;
  createdBy?: string;
  supersededAt?: string;
}

interface HistoryResponse {
  history: HistoryEntry[];
  count: number;
}

async function showHistory(id: string, options: { json?: boolean }): Promise<void> {
  const spinner = ora('Fetching secret history...').start();

  try {
    const response = await client.get<HistoryResponse>(`/v1/secrets/${id}/history`);
    spinner.stop();

    const history = response.history || [];

    if (options.json) {
      output.json(history);
      return;
    }

    if (history.length === 0) {
      output.info('No version history found');
      return;
    }

    const table = new Table({
      head: ['Version', 'Created At', 'Superseded At', 'Created By'],
      colWidths: [10, 25, 25, 30],
    });

    for (const entry of history) {
      table.push([
        String(entry.version),
        formatDate(entry.createdAt),
        entry.supersededAt ? formatDate(entry.supersededAt) : '-',
        entry.createdBy || '-',
      ]);
    }

    console.log(table.toString());
    console.log(`Total: ${response.count} version(s)`);
  } catch (error) {
    spinner.fail('Failed to fetch history');
    output.error((error as Error).message);
    process.exit(1);
  }
}

interface CopyResponse {
  id: string;
  alias: string;
  tenant: string;
  type: string;
  subType?: string;
  version: number;
  copiedFrom: {
    id: string;
    alias: string;
    tenant: string;
    version: number;
  };
  createdAt: string;
}

async function copySecret(source: string, destinationAlias: string, options: CopyOptions): Promise<void> {
  const spinner = ora('Copying secret...').start();

  try {
    const body: Record<string, unknown> = {
      source,
      destinationAlias,
      includeMetadata: !options.noMetadata,
    };

    const result = await client.post<CopyResponse>('/v1/secrets/copy', body);
    spinner.stop();

    if (options.json) {
      output.json(result);
      return;
    }

    output.success('Secret copied successfully!');
    console.log(`  New ID:     ${result.id}`);
    console.log(`  New Alias:  ${result.alias}`);
    console.log(`  Tenant:     ${result.tenant}`);
    console.log(`  Type:       ${formatType(result.type, result.subType)}`);
    console.log(`  Copied From:`);
    console.log(`    ID:       ${result.copiedFrom.id}`);
    console.log(`    Alias:    ${result.copiedFrom.alias}`);
    console.log(`    Version:  ${result.copiedFrom.version}`);
  } catch (error) {
    spinner.fail('Failed to copy secret');
    output.error((error as Error).message);
    process.exit(1);
  }
}

// ============================================================================
// Command Registration
// ============================================================================

export function registerSecretCommands(program: Command): void {
  const secret = program
    .command('secret')
    .description('Manage secrets');

  // List secrets
  secret
    .command('list')
    .description('List secrets (metadata only)')
    .option('-t, --tenant <id>', 'Filter by tenant')
    .option('--type <type>', 'Filter by type (opaque, credential, setting)')
    .option('--sub-type <subType>', 'Filter by sub-type')
    .option('--alias-prefix <prefix>', 'Filter by alias prefix')
    .option('--expiring <days>', 'Show secrets expiring within N days')
    .option('--json', 'Output as JSON')
    .action(listSecrets);

  // Get secret metadata
  secret
    .command('get <id>')
    .description('Get secret metadata (no value)')
    .option('--json', 'Output as JSON')
    .action(getSecret);

  // Decrypt secret
  secret
    .command('decrypt <id>')
    .description('Decrypt and show secret value')
    .option('-o, --output <file>', 'Write content to file')
    .option('--json', 'Output as JSON')
    .action(decryptSecret);

  // Create secret
  secret
    .command('create <alias>')
    .description('Create a new secret (use --suggest for AI naming help)')
    .option('-t, --tenant <id>', 'Tenant ID (required unless using --suggest with auth context)')
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
    .action(createSecret);

  // Update secret
  secret
    .command('update <id>')
    .description('Update a secret')
    .option('--tags <tags>', 'Comma-separated tags')
    .option('--ttl <datetime>', 'TTL expiration (ISO 8601)')
    .option('--expires <datetime>', 'Natural expiration (ISO 8601)')
    .option('--json', 'Output as JSON')
    .option('--data <json>', 'New data as JSON (non-interactive)')
    .action(updateSecret);

  // Delete secret
  secret
    .command('delete <id>')
    .description('Delete a secret')
    .option('-f, --force', 'Skip confirmation')
    .action(deleteSecret);

  // Rotate secret
  secret
    .command('rotate <id>')
    .description('Rotate secret (create new version)')
    .option('--json', 'Output as JSON')
    .action(rotateSecret);

  // Show history
  secret
    .command('history <id>')
    .description('Show secret version history')
    .option('--json', 'Output as JSON')
    .action(showHistory);

  // Copy secret
  secret
    .command('copy <source> <destination-alias>')
    .description('Copy a secret to a new location')
    .option('--no-metadata', 'Do not copy tags/metadata')
    .option('--json', 'Output as JSON')
    .action(copySecret);
}
