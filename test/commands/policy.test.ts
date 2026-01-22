// Path: znvault-cli/test/commands/policy.test.ts

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Command } from 'commander';
import { registerPolicyCommands } from '../../src/commands/policy.js';

// Mock ora
vi.mock('ora', () => ({
  default: vi.fn(() => ({
    start: vi.fn().mockReturnThis(),
    stop: vi.fn().mockReturnThis(),
    succeed: vi.fn().mockReturnThis(),
    fail: vi.fn().mockReturnThis(),
  })),
}));

// Mock fs
vi.mock('fs', () => ({
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
  existsSync: vi.fn().mockReturnValue(true),
}));

// Mock client
vi.mock('../../src/lib/client.js', () => ({
  client: {
    listPolicies: vi.fn(),
    getPolicy: vi.fn(),
    createPolicy: vi.fn(),
    updatePolicy: vi.fn(),
    deletePolicy: vi.fn(),
    togglePolicy: vi.fn(),
    validatePolicy: vi.fn(),
    getPolicyAttachments: vi.fn(),
    attachPolicyToUser: vi.fn(),
    attachPolicyToRole: vi.fn(),
    detachPolicyFromUser: vi.fn(),
    detachPolicyFromRole: vi.fn(),
    getUserPolicies: vi.fn(),
    getRolePolicies: vi.fn(),
    testPolicy: vi.fn(),
  },
}));

// Mock prompts
vi.mock('../../src/lib/prompts.js', () => ({
  promptConfirm: vi.fn(),
}));

// Mock output
vi.mock('../../src/lib/output.js', () => ({
  json: vi.fn(),
  info: vi.fn(),
  error: vi.fn(),
  success: vi.fn(),
  table: vi.fn(),
  section: vi.fn(),
  keyValue: vi.fn(),
  formatDate: vi.fn((date: string) => date),
}));

import { client } from '../../src/lib/client.js';
import { promptConfirm } from '../../src/lib/prompts.js';
import * as output from '../../src/lib/output.js';
import * as fs from 'fs';

describe('Policy Commands', () => {
  let program: Command;
  let mockExit: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    program = new Command();
    program.exitOverride();
    registerPolicyCommands(program);

    // Reset existsSync to return true by default
    vi.mocked(fs.existsSync).mockReturnValue(true);

    mockExit = vi.spyOn(process, 'exit').mockImplementation((code?: string | number | null | undefined): never => {
      throw new Error(`process.exit(${code})`);
    });
  });

  afterEach(() => {
    mockExit.mockRestore();
  });

  // ============ List Policies ============
  describe('policy list', () => {
    it('should list policies', async () => {
      vi.mocked(client.listPolicies).mockResolvedValue({
        items: [
          {
            id: 'policy-123',
            name: 'Test Policy',
            description: 'Test description',
            effect: 'allow',
            actions: ['secret:read'],
            priority: 10,
            isActive: true,
            tenantId: 'tenant-1',
            createdAt: '2024-01-01T00:00:00Z',
            updatedAt: '2024-01-01T00:00:00Z',
          },
        ],
        pagination: { total: 1, limit: 50, offset: 0, hasMore: false },
      });

      await program.parseAsync(['node', 'test', 'policy', 'list']);

      expect(client.listPolicies).toHaveBeenCalledWith({
        tenantId: undefined,
        enabled: undefined,
        effect: undefined,
        search: undefined,
      });
      expect(output.table).toHaveBeenCalled();
    });

    it('should filter by tenant', async () => {
      vi.mocked(client.listPolicies).mockResolvedValue({
        items: [],
        pagination: { total: 0, limit: 50, offset: 0, hasMore: false },
      });

      await program.parseAsync(['node', 'test', 'policy', 'list', '--tenant', 'acme']);

      expect(client.listPolicies).toHaveBeenCalledWith(
        expect.objectContaining({ tenantId: 'acme' })
      );
    });

    it('should filter by enabled status', async () => {
      vi.mocked(client.listPolicies).mockResolvedValue({
        items: [],
        pagination: { total: 0, limit: 50, offset: 0, hasMore: false },
      });

      await program.parseAsync(['node', 'test', 'policy', 'list', '--enabled']);

      expect(client.listPolicies).toHaveBeenCalledWith(
        expect.objectContaining({ enabled: true })
      );
    });

    it('should filter by disabled status', async () => {
      vi.mocked(client.listPolicies).mockResolvedValue({
        items: [],
        pagination: { total: 0, limit: 50, offset: 0, hasMore: false },
      });

      await program.parseAsync(['node', 'test', 'policy', 'list', '--disabled']);

      expect(client.listPolicies).toHaveBeenCalledWith(
        expect.objectContaining({ enabled: false })
      );
    });

    it('should filter by effect', async () => {
      vi.mocked(client.listPolicies).mockResolvedValue({
        items: [],
        pagination: { total: 0, limit: 50, offset: 0, hasMore: false },
      });

      await program.parseAsync(['node', 'test', 'policy', 'list', '--effect', 'deny']);

      expect(client.listPolicies).toHaveBeenCalledWith(
        expect.objectContaining({ effect: 'deny' })
      );
    });

    it('should search policies', async () => {
      vi.mocked(client.listPolicies).mockResolvedValue({
        items: [],
        pagination: { total: 0, limit: 50, offset: 0, hasMore: false },
      });

      await program.parseAsync(['node', 'test', 'policy', 'list', '--search', 'admin']);

      expect(client.listPolicies).toHaveBeenCalledWith(
        expect.objectContaining({ search: 'admin' })
      );
    });

    it('should output JSON when --json flag is set', async () => {
      const policies = [{ id: 'policy-1', name: 'Test' }];
      vi.mocked(client.listPolicies).mockResolvedValue({
        items: policies as any,
        pagination: { total: 1, limit: 50, offset: 0, hasMore: false },
      });

      await program.parseAsync(['node', 'test', 'policy', 'list', '--json']);

      expect(output.json).toHaveBeenCalledWith(policies);
    });

    it('should handle empty results', async () => {
      vi.mocked(client.listPolicies).mockResolvedValue({
        items: [],
        pagination: { total: 0, limit: 50, offset: 0, hasMore: false },
      });

      await program.parseAsync(['node', 'test', 'policy', 'list']);

      expect(output.info).toHaveBeenCalledWith('No policies found');
    });

    it('should handle errors', async () => {
      vi.mocked(client.listPolicies).mockRejectedValue(new Error('API Error'));

      await expect(program.parseAsync(['node', 'test', 'policy', 'list'])).rejects.toThrow('process.exit(1)');
      expect(output.error).toHaveBeenCalledWith('API Error');
    });
  });

  // ============ Get Policy ============
  describe('policy get', () => {
    it('should get policy details', async () => {
      const policy = {
        id: 'policy-123',
        name: 'Test Policy',
        description: 'Test description',
        effect: 'allow',
        actions: ['secret:read', 'secret:update'],
        resources: [{ type: 'secret', id: '*' }],
        conditions: [{ type: 'ip', operator: 'in', value: ['10.0.0.0/8'] }],
        priority: 10,
        isActive: true,
        tenantId: 'tenant-1',
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
      };
      vi.mocked(client.getPolicy).mockResolvedValue(policy);

      await program.parseAsync(['node', 'test', 'policy', 'get', 'policy-123']);

      expect(client.getPolicy).toHaveBeenCalledWith('policy-123');
      expect(output.section).toHaveBeenCalledWith('Policy Details');
      expect(output.keyValue).toHaveBeenCalled();
    });

    it('should output JSON when --json flag is set', async () => {
      const policy = { id: 'policy-123', name: 'Test' };
      vi.mocked(client.getPolicy).mockResolvedValue(policy as any);

      await program.parseAsync(['node', 'test', 'policy', 'get', 'policy-123', '--json']);

      expect(output.json).toHaveBeenCalledWith(policy);
    });

    it('should handle errors', async () => {
      vi.mocked(client.getPolicy).mockRejectedValue(new Error('Policy not found'));

      await expect(program.parseAsync(['node', 'test', 'policy', 'get', 'invalid'])).rejects.toThrow('process.exit(1)');
      expect(output.error).toHaveBeenCalledWith('Policy not found');
    });
  });

  // ============ Create Policy ============
  describe('policy create', () => {
    it('should create a policy with required options', async () => {
      const created = {
        id: 'new-policy',
        name: 'New Policy',
        effect: 'allow',
        actions: ['secret:read'],
        priority: 5,
        isActive: true,
      };
      vi.mocked(client.createPolicy).mockResolvedValue(created as any);

      await program.parseAsync([
        'node', 'test', 'policy', 'create',
        '--name', 'New Policy',
        '--effect', 'allow',
        '--actions', 'secret:read',
        '--priority', '5',
      ]);

      expect(client.createPolicy).toHaveBeenCalledWith({
        name: 'New Policy',
        description: undefined,
        effect: 'allow',
        actions: ['secret:read'],
        priority: 5,
        tenantId: undefined,
      });
      expect(output.keyValue).toHaveBeenCalled();
    });

    it('should create a policy with all options', async () => {
      const created = { id: 'new-policy', name: 'Full Policy', effect: 'deny', isActive: true, priority: 10 };
      vi.mocked(client.createPolicy).mockResolvedValue(created as any);

      await program.parseAsync([
        'node', 'test', 'policy', 'create',
        '--name', 'Full Policy',
        '--effect', 'deny',
        '--actions', 'secret:read,secret:update',
        '--description', 'Full description',
        '--priority', '10',
        '--tenant', 'acme',
        '--resources', '[{"type":"secret","id":"*"}]',
        '--conditions', '[{"type":"ip","value":["10.0.0.0/8"]}]',
      ]);

      expect(client.createPolicy).toHaveBeenCalledWith({
        name: 'Full Policy',
        description: 'Full description',
        effect: 'deny',
        actions: ['secret:read', 'secret:update'],
        priority: 10,
        tenantId: 'acme',
        resources: [{ type: 'secret', id: '*' }],
        conditions: [{ type: 'ip', value: ['10.0.0.0/8'] }],
      });
    });

    it('should create policy from file', async () => {
      const fileContent = JSON.stringify({
        name: 'File Policy',
        effect: 'allow',
        actions: ['kms:encrypt'],
        priority: 1,
      });
      vi.mocked(fs.readFileSync).mockReturnValue(fileContent);
      vi.mocked(client.createPolicy).mockResolvedValue({ id: 'file-policy', name: 'File Policy', effect: 'allow', isActive: true, priority: 1 } as any);

      await program.parseAsync([
        'node', 'test', 'policy', 'create',
        '--name', 'ignored',
        '--effect', 'ignored',
        '--actions', 'ignored',
        '--from-file', '/path/to/policy.json',
      ]);

      expect(fs.readFileSync).toHaveBeenCalledWith('/path/to/policy.json', 'utf-8');
      expect(client.createPolicy).toHaveBeenCalledWith({
        name: 'File Policy',
        effect: 'allow',
        actions: ['kms:encrypt'],
        priority: 1,
      });
    });

    it('should output JSON when --json flag is set', async () => {
      const created = { id: 'new-policy', name: 'Test' };
      vi.mocked(client.createPolicy).mockResolvedValue(created as any);

      await program.parseAsync([
        'node', 'test', 'policy', 'create',
        '--name', 'Test',
        '--effect', 'allow',
        '--actions', 'secret:read',
        '--json',
      ]);

      expect(output.json).toHaveBeenCalledWith(created);
    });

    it('should handle errors', async () => {
      vi.mocked(client.createPolicy).mockRejectedValue(new Error('Invalid policy'));

      await expect(program.parseAsync([
        'node', 'test', 'policy', 'create',
        '--name', 'Test',
        '--effect', 'allow',
        '--actions', 'secret:read',
      ])).rejects.toThrow('process.exit(1)');
      expect(output.error).toHaveBeenCalledWith('Invalid policy');
    });
  });

  // ============ Update Policy ============
  describe('policy update', () => {
    it('should update policy name', async () => {
      const updated = { id: 'policy-123', name: 'Updated Name', effect: 'allow', updatedAt: '2024-01-02T00:00:00Z' };
      vi.mocked(client.updatePolicy).mockResolvedValue(updated as any);

      await program.parseAsync(['node', 'test', 'policy', 'update', 'policy-123', '--name', 'Updated Name']);

      expect(client.updatePolicy).toHaveBeenCalledWith('policy-123', { name: 'Updated Name' });
      expect(output.keyValue).toHaveBeenCalled();
    });

    it('should update multiple fields', async () => {
      const updated = { id: 'policy-123', name: 'New Name', effect: 'deny', updatedAt: '2024-01-02T00:00:00Z' };
      vi.mocked(client.updatePolicy).mockResolvedValue(updated as any);

      await program.parseAsync([
        'node', 'test', 'policy', 'update', 'policy-123',
        '--name', 'New Name',
        '--effect', 'deny',
        '--actions', 'secret:delete',
        '--priority', '20',
      ]);

      expect(client.updatePolicy).toHaveBeenCalledWith('policy-123', {
        name: 'New Name',
        effect: 'deny',
        actions: ['secret:delete'],
        priority: 20,
      });
    });

    it('should update from file', async () => {
      const fileContent = JSON.stringify({ name: 'File Updated', priority: 50 });
      vi.mocked(fs.readFileSync).mockReturnValue(fileContent);
      vi.mocked(client.updatePolicy).mockResolvedValue({ id: 'policy-123', name: 'File Updated', effect: 'allow', updatedAt: '2024-01-02T00:00:00Z' } as any);

      await program.parseAsync([
        'node', 'test', 'policy', 'update', 'policy-123',
        '--from-file', '/path/to/updates.json',
      ]);

      expect(fs.readFileSync).toHaveBeenCalledWith('/path/to/updates.json', 'utf-8');
      expect(client.updatePolicy).toHaveBeenCalledWith('policy-123', { name: 'File Updated', priority: 50 });
    });

    it('should fail when no updates specified', async () => {
      await expect(program.parseAsync(['node', 'test', 'policy', 'update', 'policy-123'])).rejects.toThrow('process.exit(1)');
      expect(output.error).toHaveBeenCalledWith('No updates specified');
    });

    it('should output JSON when --json flag is set', async () => {
      const updated = { id: 'policy-123', name: 'Updated' };
      vi.mocked(client.updatePolicy).mockResolvedValue(updated as any);

      await program.parseAsync(['node', 'test', 'policy', 'update', 'policy-123', '--name', 'Updated', '--json']);

      expect(output.json).toHaveBeenCalledWith(updated);
    });
  });

  // ============ Delete Policy ============
  describe('policy delete', () => {
    it('should delete policy with confirmation', async () => {
      vi.mocked(promptConfirm).mockResolvedValue(true);
      vi.mocked(client.deletePolicy).mockResolvedValue(undefined);

      await program.parseAsync(['node', 'test', 'policy', 'delete', 'policy-123']);

      expect(promptConfirm).toHaveBeenCalled();
      expect(client.deletePolicy).toHaveBeenCalledWith('policy-123');
    });

    it('should delete policy with --yes flag', async () => {
      vi.mocked(client.deletePolicy).mockResolvedValue(undefined);

      await program.parseAsync(['node', 'test', 'policy', 'delete', 'policy-123', '--yes']);

      expect(promptConfirm).not.toHaveBeenCalled();
      expect(client.deletePolicy).toHaveBeenCalledWith('policy-123');
    });

    it('should cancel delete when not confirmed', async () => {
      vi.mocked(promptConfirm).mockResolvedValue(false);

      await program.parseAsync(['node', 'test', 'policy', 'delete', 'policy-123']);

      expect(promptConfirm).toHaveBeenCalled();
      expect(client.deletePolicy).not.toHaveBeenCalled();
      expect(output.info).toHaveBeenCalledWith('Delete cancelled');
    });

    it('should handle errors', async () => {
      vi.mocked(promptConfirm).mockResolvedValue(true);
      vi.mocked(client.deletePolicy).mockRejectedValue(new Error('Cannot delete'));

      await expect(program.parseAsync(['node', 'test', 'policy', 'delete', 'policy-123'])).rejects.toThrow('process.exit(1)');
      expect(output.error).toHaveBeenCalledWith('Cannot delete');
    });
  });

  // ============ Enable Policy ============
  describe('policy enable', () => {
    it('should enable a policy', async () => {
      const enabled = { id: 'policy-123', name: 'Test Policy', isActive: true };
      vi.mocked(client.togglePolicy).mockResolvedValue(enabled as any);

      await program.parseAsync(['node', 'test', 'policy', 'enable', 'policy-123']);

      expect(client.togglePolicy).toHaveBeenCalledWith('policy-123', true);
      expect(output.keyValue).toHaveBeenCalled();
    });

    it('should handle errors', async () => {
      vi.mocked(client.togglePolicy).mockRejectedValue(new Error('Policy not found'));

      await expect(program.parseAsync(['node', 'test', 'policy', 'enable', 'invalid'])).rejects.toThrow('process.exit(1)');
      expect(output.error).toHaveBeenCalledWith('Policy not found');
    });
  });

  // ============ Disable Policy ============
  describe('policy disable', () => {
    it('should disable a policy', async () => {
      const disabled = { id: 'policy-123', name: 'Test Policy', isActive: false };
      vi.mocked(client.togglePolicy).mockResolvedValue(disabled as any);

      await program.parseAsync(['node', 'test', 'policy', 'disable', 'policy-123']);

      expect(client.togglePolicy).toHaveBeenCalledWith('policy-123', false);
      expect(output.keyValue).toHaveBeenCalled();
    });

    it('should handle errors', async () => {
      vi.mocked(client.togglePolicy).mockRejectedValue(new Error('Policy not found'));

      await expect(program.parseAsync(['node', 'test', 'policy', 'disable', 'invalid'])).rejects.toThrow('process.exit(1)');
      expect(output.error).toHaveBeenCalledWith('Policy not found');
    });
  });

  // ============ Validate Policy ============
  describe('policy validate', () => {
    it('should validate a valid policy', async () => {
      vi.mocked(client.validatePolicy).mockResolvedValue({ valid: true });

      await program.parseAsync([
        'node', 'test', 'policy', 'validate',
        '--name', 'Test Policy',
        '--effect', 'allow',
        '--actions', 'secret:read',
      ]);

      expect(client.validatePolicy).toHaveBeenCalledWith({
        name: 'Test Policy',
        description: undefined,
        effect: 'allow',
        actions: ['secret:read'],
        priority: 0,
      });
    });

    it('should validate policy from file', async () => {
      const fileContent = JSON.stringify({
        name: 'File Policy',
        effect: 'deny',
        actions: ['kms:decrypt'],
        priority: 5,
      });
      vi.mocked(fs.readFileSync).mockReturnValue(fileContent);
      vi.mocked(client.validatePolicy).mockResolvedValue({ valid: true });

      await program.parseAsync([
        'node', 'test', 'policy', 'validate',
        '--name', 'ignored',
        '--effect', 'ignored',
        '--actions', 'ignored',
        '--from-file', '/path/to/policy.json',
      ]);

      expect(fs.readFileSync).toHaveBeenCalledWith('/path/to/policy.json', 'utf-8');
      expect(client.validatePolicy).toHaveBeenCalledWith({
        name: 'File Policy',
        effect: 'deny',
        actions: ['kms:decrypt'],
        priority: 5,
      });
    });

    it('should report invalid policy', async () => {
      vi.mocked(client.validatePolicy).mockResolvedValue({
        valid: false,
        errors: ['Invalid action format', 'Missing resources'],
      });

      await expect(program.parseAsync([
        'node', 'test', 'policy', 'validate',
        '--name', 'Bad Policy',
        '--effect', 'allow',
        '--actions', 'invalid',
      ])).rejects.toThrow('process.exit(1)');
      expect(output.error).toHaveBeenCalledWith('  - Invalid action format');
      expect(output.error).toHaveBeenCalledWith('  - Missing resources');
    });
  });

  // ============ Policy Attachments ============
  describe('policy attachments', () => {
    it('should show policy attachments', async () => {
      vi.mocked(client.getPolicyAttachments).mockResolvedValue({
        users: [{ userId: 'user-123', username: 'alice', attachedAt: '2024-01-01T00:00:00Z' }],
        roles: [{ roleId: 'role-123', roleName: 'admin', attachedAt: '2024-01-01T00:00:00Z' }],
      });

      await program.parseAsync(['node', 'test', 'policy', 'attachments', 'policy-123']);

      expect(client.getPolicyAttachments).toHaveBeenCalledWith('policy-123');
      expect(output.section).toHaveBeenCalledWith('Attached Users');
      expect(output.section).toHaveBeenCalledWith('Attached Roles');
      expect(output.table).toHaveBeenCalledTimes(2);
    });

    it('should handle no attachments', async () => {
      vi.mocked(client.getPolicyAttachments).mockResolvedValue({ users: [], roles: [] });

      await program.parseAsync(['node', 'test', 'policy', 'attachments', 'policy-123']);

      expect(output.info).toHaveBeenCalledWith('No attachments found for this policy');
    });

    it('should output JSON when --json flag is set', async () => {
      const attachments = { users: [], roles: [] };
      vi.mocked(client.getPolicyAttachments).mockResolvedValue(attachments);

      await program.parseAsync(['node', 'test', 'policy', 'attachments', 'policy-123', '--json']);

      expect(output.json).toHaveBeenCalledWith(attachments);
    });
  });

  // ============ Attach User ============
  describe('policy attach-user', () => {
    it('should attach policy to user', async () => {
      vi.mocked(client.attachPolicyToUser).mockResolvedValue(undefined);

      await program.parseAsync(['node', 'test', 'policy', 'attach-user', 'policy-123', 'user-456']);

      expect(client.attachPolicyToUser).toHaveBeenCalledWith('policy-123', 'user-456');
    });

    it('should handle errors', async () => {
      vi.mocked(client.attachPolicyToUser).mockRejectedValue(new Error('User not found'));

      await expect(program.parseAsync(['node', 'test', 'policy', 'attach-user', 'policy-123', 'invalid'])).rejects.toThrow('process.exit(1)');
      expect(output.error).toHaveBeenCalledWith('User not found');
    });
  });

  // ============ Attach Role ============
  describe('policy attach-role', () => {
    it('should attach policy to role', async () => {
      vi.mocked(client.attachPolicyToRole).mockResolvedValue(undefined);

      await program.parseAsync(['node', 'test', 'policy', 'attach-role', 'policy-123', 'role-456']);

      expect(client.attachPolicyToRole).toHaveBeenCalledWith('policy-123', 'role-456');
    });

    it('should handle errors', async () => {
      vi.mocked(client.attachPolicyToRole).mockRejectedValue(new Error('Role not found'));

      await expect(program.parseAsync(['node', 'test', 'policy', 'attach-role', 'policy-123', 'invalid'])).rejects.toThrow('process.exit(1)');
      expect(output.error).toHaveBeenCalledWith('Role not found');
    });
  });

  // ============ Detach User ============
  describe('policy detach-user', () => {
    it('should detach policy from user', async () => {
      vi.mocked(client.detachPolicyFromUser).mockResolvedValue(undefined);

      await program.parseAsync(['node', 'test', 'policy', 'detach-user', 'policy-123', 'user-456']);

      expect(client.detachPolicyFromUser).toHaveBeenCalledWith('policy-123', 'user-456');
    });

    it('should handle errors', async () => {
      vi.mocked(client.detachPolicyFromUser).mockRejectedValue(new Error('Not attached'));

      await expect(program.parseAsync(['node', 'test', 'policy', 'detach-user', 'policy-123', 'user-456'])).rejects.toThrow('process.exit(1)');
      expect(output.error).toHaveBeenCalledWith('Not attached');
    });
  });

  // ============ Detach Role ============
  describe('policy detach-role', () => {
    it('should detach policy from role', async () => {
      vi.mocked(client.detachPolicyFromRole).mockResolvedValue(undefined);

      await program.parseAsync(['node', 'test', 'policy', 'detach-role', 'policy-123', 'role-456']);

      expect(client.detachPolicyFromRole).toHaveBeenCalledWith('policy-123', 'role-456');
    });

    it('should handle errors', async () => {
      vi.mocked(client.detachPolicyFromRole).mockRejectedValue(new Error('Not attached'));

      await expect(program.parseAsync(['node', 'test', 'policy', 'detach-role', 'policy-123', 'role-456'])).rejects.toThrow('process.exit(1)');
      expect(output.error).toHaveBeenCalledWith('Not attached');
    });
  });

  // ============ User Policies ============
  describe('policy user-policies', () => {
    it('should list user policies', async () => {
      const policies = [
        { id: 'policy-1', name: 'Policy 1', effect: 'allow', priority: 10, isActive: true },
        { id: 'policy-2', name: 'Policy 2', effect: 'deny', priority: 5, isActive: false },
      ];
      vi.mocked(client.getUserPolicies).mockResolvedValue(policies as any);

      await program.parseAsync(['node', 'test', 'policy', 'user-policies', 'user-123']);

      expect(client.getUserPolicies).toHaveBeenCalledWith('user-123');
      expect(output.table).toHaveBeenCalled();
      expect(output.info).toHaveBeenCalledWith('Total: 2 policy(s)');
    });

    it('should handle no policies', async () => {
      vi.mocked(client.getUserPolicies).mockResolvedValue([]);

      await program.parseAsync(['node', 'test', 'policy', 'user-policies', 'user-123']);

      expect(output.info).toHaveBeenCalledWith('No policies attached to this user');
    });

    it('should output JSON when --json flag is set', async () => {
      const policies = [{ id: 'policy-1' }];
      vi.mocked(client.getUserPolicies).mockResolvedValue(policies as any);

      await program.parseAsync(['node', 'test', 'policy', 'user-policies', 'user-123', '--json']);

      expect(output.json).toHaveBeenCalledWith(policies);
    });
  });

  // ============ Role Policies ============
  describe('policy role-policies', () => {
    it('should list role policies', async () => {
      const policies = [
        { id: 'policy-1', name: 'Policy 1', effect: 'allow', priority: 10, isActive: true },
      ];
      vi.mocked(client.getRolePolicies).mockResolvedValue(policies as any);

      await program.parseAsync(['node', 'test', 'policy', 'role-policies', 'role-123']);

      expect(client.getRolePolicies).toHaveBeenCalledWith('role-123');
      expect(output.table).toHaveBeenCalled();
      expect(output.info).toHaveBeenCalledWith('Total: 1 policy(s)');
    });

    it('should handle no policies', async () => {
      vi.mocked(client.getRolePolicies).mockResolvedValue([]);

      await program.parseAsync(['node', 'test', 'policy', 'role-policies', 'role-123']);

      expect(output.info).toHaveBeenCalledWith('No policies attached to this role');
    });

    it('should output JSON when --json flag is set', async () => {
      const policies = [{ id: 'policy-1' }];
      vi.mocked(client.getRolePolicies).mockResolvedValue(policies as any);

      await program.parseAsync(['node', 'test', 'policy', 'role-policies', 'role-123', '--json']);

      expect(output.json).toHaveBeenCalledWith(policies);
    });
  });

  // ============ Test Policy ============
  describe('policy test', () => {
    it('should test policy with basic options', async () => {
      const result = {
        allowed: true,
        effect: 'allow',
        reason: 'Policy matched',
        evaluatedPolicies: 5,
        matchedPolicies: [{ name: 'Test Policy', effect: 'allow', priority: 10 }],
        evaluationTimeMs: 2,
      };
      vi.mocked(client.testPolicy).mockResolvedValue(result);

      await program.parseAsync([
        'node', 'test', 'policy', 'test',
        '--user', 'user-123',
        '--action', 'secret:read:value',
      ]);

      expect(client.testPolicy).toHaveBeenCalledWith({
        userId: 'user-123',
        action: 'secret:read:value',
        resource: undefined,
        requestContext: undefined,
      });
      expect(output.keyValue).toHaveBeenCalled();
    });

    it('should test policy with all options', async () => {
      const result = {
        allowed: false,
        effect: 'deny',
        reason: 'Denied by policy',
        evaluatedPolicies: 3,
        matchedPolicies: [],
        evaluationTimeMs: 1,
      };
      vi.mocked(client.testPolicy).mockResolvedValue(result);

      await program.parseAsync([
        'node', 'test', 'policy', 'test',
        '--user', 'user-123',
        '--action', 'secret:delete',
        '--resource-type', 'secret',
        '--resource-id', 'secret-456',
        '--resource-tenant', 'acme',
        '--ip', '192.168.1.1',
        '--mfa',
      ]);

      expect(client.testPolicy).toHaveBeenCalledWith({
        userId: 'user-123',
        action: 'secret:delete',
        resource: {
          type: 'secret',
          id: 'secret-456',
          tenantId: 'acme',
        },
        requestContext: {
          ip: '192.168.1.1',
          mfaVerified: true,
        },
      });
    });

    it('should output JSON when --json flag is set', async () => {
      const result = { allowed: true, effect: 'allow', reason: 'OK', evaluatedPolicies: 1, matchedPolicies: [], evaluationTimeMs: 1 };
      vi.mocked(client.testPolicy).mockResolvedValue(result);

      await program.parseAsync([
        'node', 'test', 'policy', 'test',
        '--user', 'user-123',
        '--action', 'secret:read',
        '--json',
      ]);

      expect(output.json).toHaveBeenCalledWith(result);
    });

    it('should handle errors', async () => {
      vi.mocked(client.testPolicy).mockRejectedValue(new Error('User not found'));

      await expect(program.parseAsync([
        'node', 'test', 'policy', 'test',
        '--user', 'invalid',
        '--action', 'secret:read',
      ])).rejects.toThrow('process.exit(1)');
      expect(output.error).toHaveBeenCalledWith('User not found');
    });
  });

  // ============ Export Policy ============
  describe('policy export', () => {
    it('should export policy to stdout', async () => {
      const policy = {
        id: 'policy-123',
        name: 'Export Policy',
        description: 'Test',
        effect: 'allow',
        actions: ['secret:read'],
        resources: [],
        conditions: [],
        priority: 10,
      };
      vi.mocked(client.getPolicy).mockResolvedValue(policy as any);
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      await program.parseAsync(['node', 'test', 'policy', 'export', 'policy-123']);

      expect(client.getPolicy).toHaveBeenCalledWith('policy-123');
      expect(consoleSpy).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });

    it('should export policy to file', async () => {
      const policy = {
        id: 'policy-123',
        name: 'Export Policy',
        description: 'Test',
        effect: 'allow',
        actions: ['secret:read'],
        resources: [],
        conditions: [],
        priority: 10,
      };
      vi.mocked(client.getPolicy).mockResolvedValue(policy as any);

      await program.parseAsync(['node', 'test', 'policy', 'export', 'policy-123', '--output', '/tmp/policy.json']);

      expect(fs.writeFileSync).toHaveBeenCalledWith(
        '/tmp/policy.json',
        expect.stringContaining('"name": "Export Policy"')
      );
      expect(output.success).toHaveBeenCalledWith('Policy exported to /tmp/policy.json');
    });

    it('should handle errors', async () => {
      vi.mocked(client.getPolicy).mockRejectedValue(new Error('Policy not found'));

      await expect(program.parseAsync(['node', 'test', 'policy', 'export', 'invalid'])).rejects.toThrow('process.exit(1)');
      expect(output.error).toHaveBeenCalledWith('Policy not found');
    });
  });

  // ============ Import Policy ============
  describe('policy import', () => {
    it('should import policy from file', async () => {
      const fileContent = JSON.stringify({
        name: 'Imported Policy',
        effect: 'allow',
        actions: ['secret:read'],
        priority: 5,
      });
      vi.mocked(fs.readFileSync).mockReturnValue(fileContent);
      vi.mocked(client.createPolicy).mockResolvedValue({
        id: 'imported-policy',
        name: 'Imported Policy',
        effect: 'allow',
        isActive: true,
      } as any);

      await program.parseAsync(['node', 'test', 'policy', 'import', '/path/to/policy.json']);

      expect(fs.readFileSync).toHaveBeenCalledWith('/path/to/policy.json', 'utf-8');
      expect(client.createPolicy).toHaveBeenCalledWith({
        name: 'Imported Policy',
        effect: 'allow',
        actions: ['secret:read'],
        priority: 5,
      });
      expect(output.keyValue).toHaveBeenCalled();
    });

    it('should import with tenant override', async () => {
      const fileContent = JSON.stringify({
        name: 'Imported Policy',
        effect: 'allow',
        actions: ['secret:read'],
        priority: 5,
      });
      vi.mocked(fs.readFileSync).mockReturnValue(fileContent);
      vi.mocked(client.createPolicy).mockResolvedValue({ id: 'imported', name: 'Imported Policy', effect: 'allow', isActive: true } as any);

      await program.parseAsync(['node', 'test', 'policy', 'import', '/path/to/policy.json', '--tenant', 'acme']);

      expect(client.createPolicy).toHaveBeenCalledWith(
        expect.objectContaining({ tenantId: 'acme' })
      );
    });

    it('should output JSON when --json flag is set', async () => {
      const fileContent = JSON.stringify({ name: 'Test', effect: 'allow', actions: ['secret:read'], priority: 0 });
      vi.mocked(fs.readFileSync).mockReturnValue(fileContent);
      const created = { id: 'imported', name: 'Test' };
      vi.mocked(client.createPolicy).mockResolvedValue(created as any);

      await program.parseAsync(['node', 'test', 'policy', 'import', '/path/to/policy.json', '--json']);

      expect(output.json).toHaveBeenCalledWith(created);
    });

    it('should handle file read errors', async () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);

      await expect(program.parseAsync(['node', 'test', 'policy', 'import', '/invalid/path.json'])).rejects.toThrow('process.exit(1)');
      expect(output.error).toHaveBeenCalledWith('File not found: /invalid/path.json');
    });
  });
});
