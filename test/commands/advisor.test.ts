// Path: znvault-cli/test/commands/advisor.test.ts

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Command } from 'commander';
import { registerAdvisorCommands } from '../../src/commands/advisor.js';

// Mock client
vi.mock('../../src/lib/client.js', () => ({
  client: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
  },
}));

// Mock output
vi.mock('../../src/lib/output.js', () => ({
  spinner: vi.fn(() => ({ start: vi.fn().mockReturnThis(), stop: vi.fn().mockReturnThis(), succeed: vi.fn().mockReturnThis(), fail: vi.fn().mockReturnThis(), warn: vi.fn().mockReturnThis(), info: vi.fn().mockReturnThis(), text: '', isSpinning: false })),
  json: vi.fn(),
  info: vi.fn(),
  error: vi.fn(),
  success: vi.fn(),
  section: vi.fn(),
  keyValue: vi.fn(),
  table: vi.fn(),
  formatRelativeTime: vi.fn((date: string) => date),
}));

import { client } from '../../src/lib/client.js';
import * as output from '../../src/lib/output.js';
import { applyTenantContextPatch } from '../../src/lib/command-context.js';

// Apply the global tenant-option patch so the `--tenant` flag is gated by
// registration context (matches the runtime behavior of src/index.ts).
applyTenantContextPatch(Command.prototype as unknown as Parameters<typeof applyTenantContextPatch>[0]);

describe('Advisor Commands', () => {
  let program: Command;
  let mockExit: ReturnType<typeof vi.spyOn>;
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    program = new Command();
    program.exitOverride();
    // Register at top level as tenant context (no --tenant, no llm) AND under
    // a synthetic `superadmin` group for the superadmin-only commands.
    registerAdvisorCommands(program);
    const superadminGroup = program
      .command('superadmin')
      .description('Superadmin commands (test harness)');
    registerAdvisorCommands(superadminGroup, { context: 'superadmin' });

    mockExit = vi.spyOn(process, 'exit').mockImplementation((code?: string | number | null | undefined): never => {
      throw new Error(`process.exit(${code})`);
    });
    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    mockExit.mockRestore();
    consoleSpy.mockRestore();
  });

  // ============ Audit Command ============
  describe('advisor audit', () => {
    it('should run security audit', async () => {
      const auditResult = {
        auditId: 'audit-123',
        tenantId: 'acme',
        status: 'completed',
        startedAt: '2024-01-01T00:00:00Z',
        completedAt: '2024-01-01T00:01:00Z',
        summary: {
          total: 3,
          bySeverity: { critical: 1, high: 2, medium: 0, low: 0 },
          byCategory: { security: 2, organization: 1, compliance: 0 },
          byStatus: { open: 3, acknowledged: 0, resolved: 0 },
        },
        findings: [
          {
            ruleId: 'weak-password',
            ruleName: 'Weak Password',
            severity: 'critical',
            category: 'security',
            status: 'open',
            description: 'User has weak password',
            resourceType: 'user',
            resourceId: 'user-123',
            recommendation: 'Enforce stronger password policy',
            foundAt: '2024-01-01T00:00:00Z',
          },
        ],
      };
      vi.mocked(client.post).mockResolvedValue({ success: true, data: auditResult });

      await program.parseAsync(['node', 'test', 'advisor', 'audit']);

      expect(client.post).toHaveBeenCalledWith('/v1/advisor/audit', {});
      expect(output.section).toHaveBeenCalledWith('Audit Summary');
      expect(output.table).toHaveBeenCalled();
    });

    it('should run audit with tenant option', async () => {
      const auditResult = {
        auditId: 'audit-123',
        tenantId: 'custom',
        status: 'completed',
        startedAt: '2024-01-01T00:00:00Z',
        summary: { total: 0, bySeverity: {}, byCategory: {}, byStatus: {} },
        findings: [],
      };
      vi.mocked(client.post).mockResolvedValue({ success: true, data: auditResult });

      await program.parseAsync(['node', 'test', 'superadmin', 'advisor', 'audit', '--tenant', 'custom']);

      expect(client.post).toHaveBeenCalledWith('/v1/superadmin/advisor/audit?tenantId=custom', {});
    });

    it('should filter by category', async () => {
      const auditResult = {
        auditId: 'audit-123',
        tenantId: 'acme',
        status: 'completed',
        startedAt: '2024-01-01T00:00:00Z',
        summary: { total: 0, bySeverity: {}, byCategory: {}, byStatus: {} },
        findings: [],
      };
      vi.mocked(client.post).mockResolvedValue({ success: true, data: auditResult });

      await program.parseAsync(['node', 'test', 'advisor', 'audit', '--category', 'security']);

      expect(client.post).toHaveBeenCalledWith('/v1/advisor/audit', { categories: ['security'] });
    });

    it('should filter by severity', async () => {
      const auditResult = {
        auditId: 'audit-123',
        tenantId: 'acme',
        status: 'completed',
        startedAt: '2024-01-01T00:00:00Z',
        summary: { total: 0, bySeverity: {}, byCategory: {}, byStatus: {} },
        findings: [],
      };
      vi.mocked(client.post).mockResolvedValue({ success: true, data: auditResult });

      await program.parseAsync(['node', 'test', 'advisor', 'audit', '--severity', 'critical']);

      expect(client.post).toHaveBeenCalledWith('/v1/advisor/audit', { severity: ['critical'] });
    });

    it('should include AI summary when requested', async () => {
      const auditResult = {
        auditId: 'audit-123',
        tenantId: 'acme',
        status: 'completed',
        startedAt: '2024-01-01T00:00:00Z',
        summary: { total: 1, bySeverity: { high: 1 }, byCategory: { security: 1 }, byStatus: { open: 1 } },
        findings: [{
          ruleId: 'test',
          ruleName: 'Test',
          severity: 'high',
          category: 'security',
          status: 'open',
          description: 'Test finding',
          resourceType: 'secret',
          resourceId: 'secret-123',
          recommendation: 'Fix it',
          foundAt: '2024-01-01T00:00:00Z',
        }],
        aiSummary: 'This is the AI-generated summary of findings.',
      };
      vi.mocked(client.post).mockResolvedValue({ success: true, data: auditResult });

      await program.parseAsync(['node', 'test', 'advisor', 'audit', '--ai-summary']);

      expect(client.post).toHaveBeenCalledWith('/v1/advisor/audit', { includeAiSummary: true });
      expect(output.section).toHaveBeenCalledWith('AI Summary');
    });

    it('should output JSON when --json flag is set', async () => {
      const auditResult = { auditId: 'audit-123', findings: [] };
      vi.mocked(client.post).mockResolvedValue({ success: true, data: auditResult });

      await program.parseAsync(['node', 'test', 'advisor', 'audit', '--json']);

      expect(output.json).toHaveBeenCalledWith(auditResult);
    });

    it('should show success message when no findings', async () => {
      const auditResult = {
        auditId: 'audit-123',
        tenantId: 'acme',
        status: 'completed',
        startedAt: '2024-01-01T00:00:00Z',
        summary: { total: 0, bySeverity: {}, byCategory: {}, byStatus: {} },
        findings: [],
      };
      vi.mocked(client.post).mockResolvedValue({ success: true, data: auditResult });

      await program.parseAsync(['node', 'test', 'advisor', 'audit']);

      expect(output.success).toHaveBeenCalledWith('No security findings detected!');
    });

    it('should handle errors', async () => {
      vi.mocked(client.post).mockRejectedValue(new Error('Audit failed'));

      await expect(program.parseAsync(['node', 'test', 'advisor', 'audit'])).rejects.toThrow('process.exit(1)');
      expect(output.error).toHaveBeenCalledWith('Audit failed');
    });
  });

  // ============ Rules Command ============
  describe('advisor rules', () => {
    it('should list rules', async () => {
      const rules = [
        {
          id: 'weak-password',
          name: 'Weak Password Detection',
          description: 'Detects users with weak passwords',
          category: 'security',
          severity: 'critical',
          enabled: true,
        },
        {
          id: 'unused-secret',
          name: 'Unused Secret Detection',
          description: 'Finds secrets not accessed recently',
          category: 'organization',
          severity: 'low',
          enabled: true,
        },
      ];
      vi.mocked(client.get).mockResolvedValue({ success: true, data: rules });

      await program.parseAsync(['node', 'test', 'advisor', 'rules']);

      expect(client.get).toHaveBeenCalledWith('/v1/advisor/rules');
      expect(output.table).toHaveBeenCalled();
      expect(output.info).toHaveBeenCalledWith('Total: 2 rules');
    });

    it('should filter by category', async () => {
      vi.mocked(client.get).mockResolvedValue({ success: true, data: [] });

      await program.parseAsync(['node', 'test', 'advisor', 'rules', '--category', 'security']);

      expect(client.get).toHaveBeenCalledWith('/v1/advisor/rules?category=security');
    });

    it('should filter by severity', async () => {
      vi.mocked(client.get).mockResolvedValue({ success: true, data: [] });

      await program.parseAsync(['node', 'test', 'advisor', 'rules', '--severity', 'critical']);

      expect(client.get).toHaveBeenCalledWith('/v1/advisor/rules?severity=critical');
    });

    it('should output JSON when --json flag is set', async () => {
      const rules = [{ id: 'rule-1', name: 'Test Rule' }];
      vi.mocked(client.get).mockResolvedValue({ success: true, data: rules });

      await program.parseAsync(['node', 'test', 'advisor', 'rules', '--json']);

      expect(output.json).toHaveBeenCalledWith(rules);
    });

    it('should handle errors', async () => {
      vi.mocked(client.get).mockRejectedValue(new Error('Failed to fetch rules'));

      await expect(program.parseAsync(['node', 'test', 'advisor', 'rules'])).rejects.toThrow('process.exit(1)');
      expect(output.error).toHaveBeenCalledWith('Failed to fetch rules');
    });
  });

  // ============ Suggest Command ============
  describe('advisor suggest', () => {
    it('should get AI suggestions for secret', async () => {
      const suggestion = {
        alias: 'api/stripe/production',
        alternativeAliases: ['stripe/prod/api-key', 'payments/stripe-key'],
        type: 'credential',
        subType: 'api-key',
        tags: ['stripe', 'payments', 'production'],
        expiresInDays: 90,
        rotationRecommendation: 'Rotate every 90 days',
        warnings: ['Consider using restricted API key'],
        confidence: 0.85,
        reasoning: 'Based on the description, this appears to be a Stripe API key for production payments.',
      };
      vi.mocked(client.post).mockResolvedValue({ success: true, data: suggestion });

      await program.parseAsync(['node', 'test', 'advisor', 'suggest', 'stripe api key for payments']);

      expect(client.post).toHaveBeenCalledWith('/v1/advisor/suggest', { description: 'stripe api key for payments' });
      expect(output.section).toHaveBeenCalledWith('Suggested Configuration');
      expect(output.section).toHaveBeenCalledWith('Alternative Names');
      expect(output.section).toHaveBeenCalledWith('Warnings');
      expect(output.section).toHaveBeenCalledWith('Reasoning');
    });

    it('should include hints when provided', async () => {
      const suggestion = {
        alias: 'dev/api/stripe',
        type: 'credential',
        tags: ['stripe', 'dev'],
        confidence: 0.9,
        reasoning: 'Dev environment Stripe key.',
      };
      vi.mocked(client.post).mockResolvedValue({ success: true, data: suggestion });

      await program.parseAsync([
        'node', 'test', 'advisor', 'suggest', 'stripe key',
        '--environment', 'dev',
        '--service', 'payments',
        '--team', 'backend',
      ]);

      expect(client.post).toHaveBeenCalledWith('/v1/advisor/suggest', {
        description: 'stripe key',
        hints: {
          environment: 'dev',
          service: 'payments',
          team: 'backend',
        },
      });
    });

    it('should use tenant option', async () => {
      const suggestion = { alias: 'test', type: 'credential', tags: [], confidence: 0.8, reasoning: 'Test' };
      vi.mocked(client.post).mockResolvedValue({ success: true, data: suggestion });

      await program.parseAsync(['node', 'test', 'superadmin', 'advisor', 'suggest', 'test secret', '--tenant', 'acme']);

      expect(client.post).toHaveBeenCalledWith('/v1/superadmin/advisor/suggest?tenantId=acme', expect.any(Object));
    });

    it('should output JSON when --json flag is set', async () => {
      const suggestion = { alias: 'test', type: 'credential' };
      vi.mocked(client.post).mockResolvedValue({ success: true, data: suggestion });

      await program.parseAsync(['node', 'test', 'advisor', 'suggest', 'test', '--json']);

      expect(output.json).toHaveBeenCalledWith(suggestion);
    });

    it('should handle errors', async () => {
      vi.mocked(client.post).mockRejectedValue(new Error('LLM not configured'));

      await expect(program.parseAsync(['node', 'test', 'advisor', 'suggest', 'test'])).rejects.toThrow('process.exit(1)');
      expect(output.error).toHaveBeenCalledWith('LLM not configured');
    });
  });

  // ============ LLM Status Command ============
  describe('advisor llm status', () => {
    it('should show LLM status', async () => {
      const status = {
        configured: true,
        enabled: true,
        provider: 'anthropic',
        model: 'claude-3-5-haiku-latest',
      };
      vi.mocked(client.get).mockResolvedValue({ success: true, data: status });

      await program.parseAsync(['node', 'test', 'superadmin', 'advisor', 'llm', 'status']);

      expect(client.get).toHaveBeenCalledWith('/v1/advisor/llm/status');
      expect(output.keyValue).toHaveBeenCalled();
    });

    it('should show configuration hint when not configured', async () => {
      const status = {
        configured: false,
        enabled: false,
        provider: null,
        model: null,
      };
      vi.mocked(client.get).mockResolvedValue({ success: true, data: status });

      await program.parseAsync(['node', 'test', 'superadmin', 'advisor', 'llm', 'status']);

      expect(output.info).toHaveBeenCalledWith('\nTo enable AI features, configure LLM with:');
    });

    it('should output JSON when --json flag is set', async () => {
      const status = { configured: true, enabled: true };
      vi.mocked(client.get).mockResolvedValue({ success: true, data: status });

      await program.parseAsync(['node', 'test', 'superadmin', 'advisor', 'llm', 'status', '--json']);

      expect(output.json).toHaveBeenCalledWith(status);
    });

    it('should handle errors', async () => {
      vi.mocked(client.get).mockRejectedValue(new Error('Failed to check status'));

      await expect(program.parseAsync(['node', 'test', 'superadmin', 'advisor', 'llm', 'status'])).rejects.toThrow('process.exit(1)');
      expect(output.error).toHaveBeenCalledWith('Failed to check status');
    });
  });

  // ============ LLM Get Command ============
  describe('advisor llm get', () => {
    it('should get LLM configuration', async () => {
      const config = {
        provider: 'anthropic',
        apiKeyConfigured: true,
        apiKeyPrefix: 'sk-ant-...',
        model: 'claude-3-5-haiku-latest',
        maxTokens: 4096,
        enabled: true,
      };
      vi.mocked(client.get).mockResolvedValue({ success: true, data: config });

      await program.parseAsync(['node', 'test', 'superadmin', 'advisor', 'llm', 'get']);

      expect(client.get).toHaveBeenCalledWith('/v1/admin/advisor/llm/config');
      expect(output.keyValue).toHaveBeenCalled();
    });

    it('should handle unconfigured LLM', async () => {
      vi.mocked(client.get).mockResolvedValue({ success: true, data: null });

      await program.parseAsync(['node', 'test', 'superadmin', 'advisor', 'llm', 'get']);

      expect(output.info).toHaveBeenCalledWith('LLM is not configured');
    });

    it('should output JSON when --json flag is set', async () => {
      const config = { provider: 'anthropic', enabled: true };
      vi.mocked(client.get).mockResolvedValue({ success: true, data: config });

      await program.parseAsync(['node', 'test', 'superadmin', 'advisor', 'llm', 'get', '--json']);

      expect(output.json).toHaveBeenCalledWith(config);
    });

    it('should handle errors', async () => {
      vi.mocked(client.get).mockRejectedValue(new Error('Access denied'));

      await expect(program.parseAsync(['node', 'test', 'superadmin', 'advisor', 'llm', 'get'])).rejects.toThrow('process.exit(1)');
      expect(output.error).toHaveBeenCalledWith('Access denied');
    });
  });

  // ============ LLM Config Command ============
  describe('advisor llm config', () => {
    it('should update LLM configuration', async () => {
      const updated = {
        provider: 'anthropic',
        apiKeyConfigured: true,
        apiKeyPrefix: 'sk-ant-...',
        model: 'claude-3-5-haiku-latest',
        maxTokens: 4096,
        enabled: true,
      };
      vi.mocked(client.put).mockResolvedValue({ success: true, data: updated });

      await program.parseAsync([
        'node', 'test', 'superadmin', 'advisor', 'llm', 'config',
        '--provider', 'anthropic',
        '--api-key', 'sk-ant-test-key',
        '--model', 'claude-3-5-haiku-latest',
        '--max-tokens', '4096',
        '--enabled', 'true',
      ]);

      expect(client.put).toHaveBeenCalledWith('/v1/admin/advisor/llm/config', {
        provider: 'anthropic',
        apiKey: 'sk-ant-test-key',
        model: 'claude-3-5-haiku-latest',
        maxTokens: 4096,
        enabled: true,
      });
      expect(output.success).toHaveBeenCalledWith('LLM configuration updated');
    });

    it('should update only specified options', async () => {
      const updated = { provider: 'anthropic', enabled: false };
      vi.mocked(client.put).mockResolvedValue({ success: true, data: updated });

      await program.parseAsync(['node', 'test', 'superadmin', 'advisor', 'llm', 'config', '--enabled', 'false']);

      expect(client.put).toHaveBeenCalledWith('/v1/admin/advisor/llm/config', { enabled: false });
    });

    it('should fail when no options provided', async () => {
      await expect(program.parseAsync(['node', 'test', 'superadmin', 'advisor', 'llm', 'config'])).rejects.toThrow('process.exit(1)');
      expect(output.error).toHaveBeenCalledWith('No configuration options provided');
    });

    it('should handle errors', async () => {
      vi.mocked(client.put).mockRejectedValue(new Error('Invalid API key'));

      await expect(program.parseAsync([
        'node', 'test', 'superadmin', 'advisor', 'llm', 'config',
        '--api-key', 'invalid',
      ])).rejects.toThrow('process.exit(1)');
      expect(output.error).toHaveBeenCalledWith('Invalid API key');
    });
  });

  // ============ LLM Test Command ============
  describe('advisor llm test', () => {
    it('should test LLM connection successfully', async () => {
      const result = {
        success: true,
        message: 'LLM connection successful',
        model: 'claude-3-5-haiku-latest',
      };
      vi.mocked(client.post).mockResolvedValue({ success: true, data: result });

      await program.parseAsync(['node', 'test', 'superadmin', 'advisor', 'llm', 'test']);

      expect(client.post).toHaveBeenCalledWith('/v1/admin/advisor/llm/test', {});
      expect(output.success).toHaveBeenCalledWith('LLM connection successful');
      expect(output.info).toHaveBeenCalledWith('Model: claude-3-5-haiku-latest');
    });

    it('should handle test failure', async () => {
      const result = {
        success: false,
        message: 'Invalid API key',
      };
      vi.mocked(client.post).mockResolvedValue({ success: true, data: result });

      await expect(program.parseAsync(['node', 'test', 'superadmin', 'advisor', 'llm', 'test'])).rejects.toThrow('process.exit(1)');
      expect(output.error).toHaveBeenCalledWith('Invalid API key');
    });

    it('should handle errors', async () => {
      vi.mocked(client.post).mockRejectedValue(new Error('Connection failed'));

      await expect(program.parseAsync(['node', 'test', 'superadmin', 'advisor', 'llm', 'test'])).rejects.toThrow('process.exit(1)');
      expect(output.error).toHaveBeenCalledWith('Connection failed');
    });
  });

  // ============ LLM Delete Command ============
  describe('advisor llm delete', () => {
    it('should delete LLM configuration', async () => {
      vi.mocked(client.delete).mockResolvedValue(undefined);

      await program.parseAsync(['node', 'test', 'superadmin', 'advisor', 'llm', 'delete']);

      expect(client.delete).toHaveBeenCalledWith('/v1/admin/advisor/llm/config');
      expect(output.success).toHaveBeenCalledWith('LLM configuration deleted');
    });

    it('should handle errors', async () => {
      vi.mocked(client.delete).mockRejectedValue(new Error('Access denied'));

      await expect(program.parseAsync(['node', 'test', 'superadmin', 'advisor', 'llm', 'delete'])).rejects.toThrow('process.exit(1)');
      expect(output.error).toHaveBeenCalledWith('Access denied');
    });
  });
});
