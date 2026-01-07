// Path: znvault-cli/src/commands/advisor.ts

import { type Command } from 'commander';
import ora from 'ora';
import { client } from '../lib/client.js';
import * as output from '../lib/output.js';

// Types for advisor API responses
interface Finding {
  ruleId: string;
  ruleName: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
  category: 'security' | 'organization' | 'compliance';
  status: 'open' | 'acknowledged' | 'resolved';
  description: string;
  resourceType: string;
  resourceId: string;
  recommendation: string;
  foundAt: string;
}

interface AuditResult {
  auditId: string;
  tenantId: string;
  status: 'running' | 'completed' | 'failed';
  startedAt: string;
  completedAt?: string;
  summary: {
    total: number;
    bySeverity: Record<string, number>;
    byCategory: Record<string, number>;
    byStatus: Record<string, number>;
  };
  findings: Finding[];
  aiSummary?: string;
}

interface Rule {
  id: string;
  name: string;
  description: string;
  category: 'security' | 'organization' | 'compliance';
  severity: 'critical' | 'high' | 'medium' | 'low';
  enabled: boolean;
}

interface LLMConfig {
  provider: string;
  apiKeyConfigured: boolean;
  apiKeyPrefix?: string;
  model: string;
  maxTokens: number;
  enabled: boolean;
}

interface LLMStatus {
  configured: boolean;
  enabled: boolean;
  provider: string | null;
  model: string | null;
}

interface AuditOptions {
  tenant?: string;
  category?: string;
  severity?: string;
  aiSummary?: boolean;
  json?: boolean;
}

interface RulesListOptions {
  category?: string;
  severity?: string;
  json?: boolean;
}

interface SuggestOptions {
  tenant?: string;
  environment?: string;
  service?: string;
  team?: string;
  json?: boolean;
}

interface LLMConfigUpdateOptions {
  provider?: string;
  apiKey?: string;
  model?: string;
  maxTokens?: string;
  enabled?: string;
}

export function registerAdvisorCommands(program: Command): void {
  const advisor = program
    .command('advisor')
    .description('AI-powered security advisor commands');

  // Run security audit
  advisor
    .command('audit')
    .description('Run a security audit (tenant inferred from auth, or specify for superadmin)')
    .option('--tenant <id>', 'Tenant ID (superadmin only)')
    .option('--category <category>', 'Filter by category (security, organization, compliance)')
    .option('--severity <severity>', 'Filter by severity (critical, high, medium, low)')
    .option('--ai-summary', 'Include AI-generated summary')
    .option('--json', 'Output as JSON')
    .action(async (options: AuditOptions) => {
      const spinner = ora('Running security audit...').start();

      try {
        // Use 'me' if no tenant specified (server will use auth context)
        const tenant = options.tenant || 'me';
        const body: Record<string, unknown> = {};
        if (options.category) {
          body.categories = [options.category];
        }
        if (options.severity) {
          body.severity = [options.severity];
        }
        if (options.aiSummary) {
          body.includeAiSummary = true;
        }

        const response = await client.post<{ success: boolean; data: AuditResult }>(
          `/v1/advisor/${tenant}/audit`,
          body
        );
        spinner.stop();

        if (options.json) {
          output.json(response.data);
          return;
        }

        const result = response.data;

        // Summary header
        output.section('Audit Summary');
        output.keyValue({
          'Audit ID': result.auditId,
          'Tenant': result.tenantId,
          'Status': result.status,
          'Started': output.formatRelativeTime(result.startedAt),
          'Total Findings': result.summary.total,
        });

        // Severity breakdown
        if (result.summary.total > 0) {
          output.section('By Severity');
          const severityColors: Record<string, string> = {
            critical: '\x1b[31m', // red
            high: '\x1b[33m',     // yellow
            medium: '\x1b[36m',   // cyan
            low: '\x1b[37m',      // white
          };
          const reset = '\x1b[0m';

          for (const [sev, count] of Object.entries(result.summary.bySeverity)) {
            if (count > 0) {
              const color = severityColors[sev] || '';
              console.log(`  ${color}${sev.toUpperCase()}: ${count}${reset}`);
            }
          }

          // Findings table
          output.section('Findings');
          output.table(
            ['Severity', 'Rule', 'Description', 'Resource'],
            result.findings.slice(0, 20).map(f => [
              f.severity.toUpperCase(),
              f.ruleId,
              f.description.substring(0, 40) + (f.description.length > 40 ? '...' : ''),
              `${f.resourceType}:${f.resourceId.substring(0, 8)}`,
            ])
          );

          if (result.findings.length > 20) {
            output.info(`... and ${result.findings.length - 20} more findings`);
          }
        } else {
          output.success('No security findings detected!');
        }

        // AI Summary
        if (result.aiSummary) {
          output.section('AI Summary');
          console.log(result.aiSummary);
        }
      } catch (err) {
        spinner.fail('Failed to run audit');
        output.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    });

  // List available rules
  advisor
    .command('rules')
    .description('List available security rules')
    .option('--category <category>', 'Filter by category')
    .option('--severity <severity>', 'Filter by severity')
    .option('--json', 'Output as JSON')
    .action(async (options: RulesListOptions) => {
      const spinner = ora('Fetching rules...').start();

      try {
        const query: string[] = [];
        if (options.category) query.push(`category=${options.category}`);
        if (options.severity) query.push(`severity=${options.severity}`);

        const path = query.length > 0 ? `/v1/advisor/rules?${query.join('&')}` : '/v1/advisor/rules';
        const response = await client.get<{ success: boolean; data: Rule[] }>(path);
        spinner.stop();

        if (options.json) {
          output.json(response.data);
          return;
        }

        const rules = response.data;

        output.table(
          ['ID', 'Name', 'Category', 'Severity'],
          rules.map(r => [
            r.id,
            r.name.substring(0, 30),
            r.category,
            r.severity.toUpperCase(),
          ])
        );

        output.info(`Total: ${rules.length} rules`);
      } catch (err) {
        spinner.fail('Failed to list rules');
        output.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    });

  // Suggest secret configuration
  advisor
    .command('suggest')
    .description('Get AI suggestions for naming and configuring a new secret')
    .argument('<description>', 'Description of the secret (e.g., "stripe api key for payments")')
    .option('--tenant <id>', 'Tenant ID (superadmin only)')
    .option('--environment <env>', 'Environment hint (prod, staging, dev)')
    .option('--service <name>', 'Service name hint')
    .option('--team <name>', 'Team name hint')
    .option('--json', 'Output as JSON')
    .action(async (description: string, options: SuggestOptions) => {
      const spinner = ora('Getting AI suggestions...').start();

      try {
        const tenant = options.tenant || 'me';
        const body: Record<string, unknown> = { description };
        const hints: Record<string, string> = {};
        if (options.environment) hints.environment = options.environment;
        if (options.service) hints.service = options.service;
        if (options.team) hints.team = options.team;
        if (Object.keys(hints).length > 0) body.hints = hints;

        const response = await client.post<{
          success: boolean;
          data: {
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
          };
        }>(`/v1/advisor/${tenant}/suggest`, body);
        spinner.stop();

        if (options.json) {
          output.json(response.data);
          return;
        }

        const result = response.data;

        output.section('Suggested Configuration');
        output.keyValue({
          'Alias': result.alias,
          'Type': result.type,
          'Sub-Type': result.subType || '-',
          'Tags': result.tags.join(', ') || 'none',
          'Expiration': result.expiresInDays ? `${result.expiresInDays} days` : '-',
          'Rotation': result.rotationRecommendation || '-',
          'Confidence': `${Math.round(result.confidence * 100)}%`,
        });

        if (result.alternativeAliases && result.alternativeAliases.length > 0) {
          output.section('Alternative Names');
          result.alternativeAliases.forEach(a => console.log(`  - ${a}`));
        }

        if (result.warnings && result.warnings.length > 0) {
          output.section('Warnings');
          result.warnings.forEach(w => console.log(`  ⚠ ${w}`));
        }

        output.section('Reasoning');
        console.log(`  ${result.reasoning}`);
      } catch (err) {
        spinner.fail('Failed to get suggestions');
        output.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    });

  // LLM configuration subcommand
  const llm = advisor
    .command('llm')
    .description('Manage LLM configuration for AI features');

  // Check LLM status
  llm
    .command('status')
    .description('Check LLM configuration status')
    .option('--json', 'Output as JSON')
    .action(async (options: { json?: boolean }) => {
      const spinner = ora('Checking LLM status...').start();

      try {
        const response = await client.get<{ success: boolean; data: LLMStatus }>('/v1/advisor/llm/status');
        spinner.stop();

        if (options.json) {
          output.json(response.data);
          return;
        }

        const status = response.data;
        output.keyValue({
          'Configured': status.configured ? 'Yes' : 'No',
          'Enabled': status.enabled ? 'Yes' : 'No',
          'Provider': status.provider || '-',
          'Model': status.model || '-',
        });

        if (!status.configured) {
          output.info('\nTo enable AI features, configure LLM with:');
          output.info('  znvault advisor llm config --api-key <key> --enabled true');
        }
      } catch (err) {
        spinner.fail('Failed to check LLM status');
        output.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    });

  // Get LLM config (superadmin only)
  llm
    .command('get')
    .description('Get LLM configuration (superadmin only)')
    .option('--json', 'Output as JSON')
    .action(async (options: { json?: boolean }) => {
      const spinner = ora('Fetching LLM configuration...').start();

      try {
        const response = await client.get<{ success: boolean; data: LLMConfig | null }>('/v1/admin/advisor/llm/config');
        spinner.stop();

        if (options.json) {
          output.json(response.data);
          return;
        }

        const config = response.data;
        if (!config) {
          output.info('LLM is not configured');
          return;
        }

        output.keyValue({
          'Provider': config.provider,
          'API Key': config.apiKeyConfigured ? `${config.apiKeyPrefix}...` : 'Not set',
          'Model': config.model,
          'Max Tokens': config.maxTokens,
          'Enabled': config.enabled ? 'Yes' : 'No',
        });
      } catch (err) {
        spinner.fail('Failed to get LLM configuration');
        output.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    });

  // Update LLM config (superadmin only)
  llm
    .command('config')
    .description('Update LLM configuration (superadmin only)')
    .option('--provider <provider>', 'LLM provider (anthropic)')
    .option('--api-key <key>', 'API key for the provider')
    .option('--model <model>', 'Model to use (e.g., claude-3-5-haiku-latest)')
    .option('--max-tokens <tokens>', 'Maximum tokens for responses')
    .option('--enabled <bool>', 'Enable or disable LLM features (true/false)')
    .action(async (options: LLMConfigUpdateOptions) => {
      const spinner = ora('Updating LLM configuration...').start();

      try {
        const body: Record<string, unknown> = {};
        if (options.provider) body.provider = options.provider;
        if (options.apiKey) body.apiKey = options.apiKey;
        if (options.model) body.model = options.model;
        if (options.maxTokens) body.maxTokens = parseInt(options.maxTokens, 10);
        if (options.enabled !== undefined) body.enabled = options.enabled === 'true';

        if (Object.keys(body).length === 0) {
          spinner.stop();
          output.error('No configuration options provided');
          output.info('Use --help to see available options');
          process.exit(1);
        }

        const response = await client.put<{ success: boolean; data: LLMConfig }>('/v1/admin/advisor/llm/config', body);
        spinner.stop();

        output.success('LLM configuration updated');
        output.keyValue({
          'Provider': response.data.provider,
          'API Key': response.data.apiKeyConfigured ? `${response.data.apiKeyPrefix}...` : 'Not set',
          'Model': response.data.model,
          'Max Tokens': response.data.maxTokens,
          'Enabled': response.data.enabled ? 'Yes' : 'No',
        });
      } catch (err) {
        spinner.fail('Failed to update LLM configuration');
        output.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    });

  // Test LLM connection (superadmin only)
  llm
    .command('test')
    .description('Test LLM connection (superadmin only)')
    .action(async () => {
      const spinner = ora('Testing LLM connection...').start();

      try {
        const response = await client.post<{ success: boolean; data: { success: boolean; message: string; model?: string } }>(
          '/v1/admin/advisor/llm/test',
          {}
        );
        spinner.stop();

        const result = response.data;
        if (result.success) {
          output.success(result.message);
          if (result.model) {
            output.info(`Model: ${result.model}`);
          }
        } else {
          output.error(result.message);
          process.exit(1);
        }
      } catch (err) {
        spinner.fail('Failed to test LLM connection');
        output.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    });

  // Delete LLM config (superadmin only)
  llm
    .command('delete')
    .description('Delete LLM configuration (superadmin only)')
    .action(async () => {
      const spinner = ora('Deleting LLM configuration...').start();

      try {
        await client.delete('/v1/admin/advisor/llm/config');
        spinner.stop();

        output.success('LLM configuration deleted');
      } catch (err) {
        spinner.fail('Failed to delete LLM configuration');
        output.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    });
}
