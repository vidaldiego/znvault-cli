// Path: znvault-cli/test/commands/tenant.test.ts

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Command } from 'commander';

// Mock dependencies
vi.mock('ora', () => ({
  default: () => ({
    start: () => ({ stop: vi.fn(), succeed: vi.fn(), fail: vi.fn() }),
  }),
}));

vi.mock('../../src/lib/prompts.js', () => ({
  promptConfirm: vi.fn().mockResolvedValue(true),
}));

const mockTenants = [
  { id: 'tenant-1', name: 'Test Tenant 1', status: 'active', planTier: 'standard', createdAt: new Date().toISOString() },
  { id: 'tenant-2', name: 'Test Tenant 2', status: 'suspended', planTier: 'enterprise', createdAt: new Date().toISOString() },
];

const mockTenantUsage = { secretsCount: 10, kmsKeysCount: 2, storageUsedMb: 5, usersCount: 3, apiKeysCount: 1 };

// Mock mode.js - this is what the commands actually use
vi.mock('../../src/lib/mode.js', () => ({
  getMode: vi.fn().mockReturnValue('api'),
  getModeDescription: vi.fn().mockReturnValue('API mode - using API key'),
  listTenants: vi.fn().mockResolvedValue(mockTenants),
  getTenant: vi.fn().mockResolvedValue({ id: 'tenant-1', name: 'Test Tenant', status: 'active', maxSecrets: null, maxKmsKeys: null, contactEmail: null, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }),
  getTenantUsage: vi.fn().mockResolvedValue(mockTenantUsage),
  closeLocalClient: vi.fn().mockResolvedValue(undefined),
}));

// Mock client.js for API-only operations
vi.mock('../../src/lib/client.js', () => ({
  client: {
    createTenant: vi.fn().mockResolvedValue({ id: 'new-tenant', name: 'New Tenant', status: 'active', maxSecrets: null, maxKmsKeys: null, createdAt: new Date().toISOString() }),
    updateTenant: vi.fn().mockResolvedValue({ id: 'tenant-1', name: 'Updated Tenant', status: 'active', maxSecrets: null, updatedAt: new Date().toISOString() }),
    deleteTenant: vi.fn().mockResolvedValue(undefined),
    configure: vi.fn(),
  },
}));

vi.mock('../../src/lib/config.js', () => ({
  getCredentials: vi.fn().mockReturnValue({ accessToken: 'token' }),
  getConfig: vi.fn().mockReturnValue({ url: 'https://localhost:8443', insecure: false, timeout: 30000 }),
}));

vi.mock('../../src/lib/output.js', () => ({
  success: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  keyValue: vi.fn(),
  json: vi.fn(),
  table: vi.fn(),
  section: vi.fn(),
  formatRelativeTime: vi.fn().mockReturnValue('1m ago'),
  formatDate: vi.fn().mockReturnValue('2024-01-15'),
}));

describe('tenant commands', () => {
  let program: Command;

  beforeEach(async () => {
    program = new Command();
    program.exitOverride();

    const { registerTenantCommands } = await import('../../src/commands/tenant.js');
    registerTenantCommands(program);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('tenant list', () => {
    it('should list all tenants', async () => {
      const mode = await import('../../src/lib/mode.js');
      const { table, info } = await import('../../src/lib/output.js');

      await program.parseAsync(['node', 'test', 'tenant', 'list']);

      expect(mode.listTenants).toHaveBeenCalledWith({ status: undefined, withUsage: undefined });
      expect(table).toHaveBeenCalled();
      expect(info).toHaveBeenCalledWith('Total: 2 tenant(s)');
    });

    it('should filter by status', async () => {
      const mode = await import('../../src/lib/mode.js');

      await program.parseAsync(['node', 'test', 'tenant', 'list', '--status', 'active']);

      expect(mode.listTenants).toHaveBeenCalledWith({ status: 'active', withUsage: undefined });
    });

    it('should include usage with --with-usage flag', async () => {
      const mode = await import('../../src/lib/mode.js');

      await program.parseAsync(['node', 'test', 'tenant', 'list', '--with-usage']);

      expect(mode.listTenants).toHaveBeenCalledWith({ status: undefined, withUsage: true });
    });
  });

  describe('tenant create', () => {
    it('should create a new tenant', async () => {
      const { client } = await import('../../src/lib/client.js');

      await program.parseAsync(['node', 'test', 'tenant', 'create', 'new-tenant', 'New Tenant']);

      expect(client.createTenant).toHaveBeenCalledWith({
        id: 'new-tenant',
        name: 'New Tenant',
        maxSecrets: undefined,
        maxKmsKeys: undefined,
        contactEmail: undefined,
      });
    });

    it('should create tenant with options', async () => {
      const { client } = await import('../../src/lib/client.js');

      await program.parseAsync(['node', 'test', 'tenant', 'create', 'new-tenant', 'New Tenant', '--max-secrets', '1000', '--email', 'admin@example.com']);

      expect(client.createTenant).toHaveBeenCalledWith({
        id: 'new-tenant',
        name: 'New Tenant',
        maxSecrets: 1000,
        maxKmsKeys: undefined,
        contactEmail: 'admin@example.com',
      });
    });
  });

  describe('tenant get', () => {
    it('should get tenant details', async () => {
      const mode = await import('../../src/lib/mode.js');
      const { section, keyValue } = await import('../../src/lib/output.js');

      await program.parseAsync(['node', 'test', 'tenant', 'get', 'tenant-1']);

      expect(mode.getTenant).toHaveBeenCalledWith('tenant-1', undefined);
      expect(section).toHaveBeenCalled();
      expect(keyValue).toHaveBeenCalled();
    });
  });

  describe('tenant update', () => {
    it('should update tenant', async () => {
      const { client } = await import('../../src/lib/client.js');

      await program.parseAsync(['node', 'test', 'tenant', 'update', 'tenant-1', '--name', 'Updated Name']);

      expect(client.updateTenant).toHaveBeenCalledWith('tenant-1', { name: 'Updated Name' });
    });
  });

  describe('tenant delete', () => {
    it('should delete tenant with confirmation', async () => {
      const { client } = await import('../../src/lib/client.js');
      const { promptConfirm } = await import('../../src/lib/prompts.js');

      await program.parseAsync(['node', 'test', 'tenant', 'delete', 'tenant-1']);

      expect(promptConfirm).toHaveBeenCalled();
      expect(client.deleteTenant).toHaveBeenCalledWith('tenant-1');
    });
  });

  describe('tenant usage', () => {
    it('should get tenant usage', async () => {
      const mode = await import('../../src/lib/mode.js');
      const { keyValue, section } = await import('../../src/lib/output.js');

      await program.parseAsync(['node', 'test', 'tenant', 'usage', 'tenant-1']);

      expect(mode.getTenantUsage).toHaveBeenCalledWith('tenant-1');
      expect(section).toHaveBeenCalled();
      expect(keyValue).toHaveBeenCalled();
    });
  });
});
