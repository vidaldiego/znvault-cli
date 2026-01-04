// Path: znvault-cli/test/commands/role.test.ts

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Command } from 'commander';

// Mock dependencies
vi.mock('ora', () => ({
  default: () => ({
    start: () => ({ stop: vi.fn(), succeed: vi.fn(), fail: vi.fn() }),
  }),
}));

vi.mock('inquirer', () => ({
  default: {
    prompt: vi.fn().mockResolvedValue({ confirm: true }),
  },
}));

const mockRoles = [
  {
    id: 'role-001',
    name: 'admin',
    description: 'Full admin access',
    is_system: true,
    permissions: ['secrets:read', 'secrets:write', 'kms:manage'],
    user_count: 2,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  },
  {
    id: 'role-002',
    name: 'developer',
    description: 'Developer access',
    is_system: false,
    permissions: ['secrets:read'],
    tenant_id: 'tenant-001',
    user_count: 5,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  },
];

const mockRoleDetails = {
  id: 'role-001',
  name: 'admin',
  description: 'Full admin access',
  is_system: true,
  permissions: ['secrets:read', 'secrets:write', 'kms:manage', 'users:manage'],
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
};

const mockCustomRole = {
  id: 'role-003',
  name: 'custom-role',
  description: 'Custom role',
  is_system: false,
  permissions: ['secrets:read'],
  tenant_id: 'acme',
  user_count: 0,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
};

const mockUserRoles = {
  roles: [mockRoles[0]],
  permissions: ['secrets:read', 'secrets:write', 'kms:manage'],
};

vi.mock('../../src/lib/client.js', () => ({
  client: {
    get: vi.fn().mockImplementation((path: string) => {
      if (path.includes('/v1/roles?')) return Promise.resolve({ data: mockRoles, total: 2, page: 1, pageSize: 20 });
      if (path.includes('/roles/role-003')) return Promise.resolve(mockCustomRole);
      if (path.includes('/roles/')) return Promise.resolve(mockRoleDetails);
      if (path.includes('/users/') && path.includes('/roles')) return Promise.resolve(mockUserRoles);
      if (path.includes('/users/') && path.includes('/permissions')) return Promise.resolve({ permissions: ['secrets:read', 'kms:encrypt'] });
      return Promise.resolve(mockRoleDetails);
    }),
    post: vi.fn().mockResolvedValue(mockCustomRole),
    patch: vi.fn().mockResolvedValue(mockCustomRole),
    delete: vi.fn().mockResolvedValue(undefined),
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
  warn: vi.fn(),
  json: vi.fn(),
}));

describe('role commands', () => {
  let program: Command;
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    program = new Command();
    program.exitOverride();

    const { registerRoleCommands } = await import('../../src/commands/role.js');
    registerRoleCommands(program);

    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleSpy.mockRestore();
    vi.clearAllMocks();
  });

  describe('role list', () => {
    it('should list all roles', async () => {
      const { client } = await import('../../src/lib/client.js');
      const { info } = await import('../../src/lib/output.js');

      await program.parseAsync(['node', 'test', 'role', 'list']);

      expect(client.get).toHaveBeenCalled();
      expect(info).toHaveBeenCalledWith('Total: 2 role(s)');
    });

    it('should filter by tenant', async () => {
      const { client } = await import('../../src/lib/client.js');

      await program.parseAsync(['node', 'test', 'role', 'list', '--tenant', 'acme']);

      expect(client.get).toHaveBeenCalledWith(expect.stringContaining('tenantId=acme'));
    });

    it('should output JSON when --json flag is used', async () => {
      const { json } = await import('../../src/lib/output.js');

      await program.parseAsync(['node', 'test', 'role', 'list', '--json']);

      expect(json).toHaveBeenCalledWith(mockRoles);
    });
  });

  describe('role get', () => {
    it('should get role details', async () => {
      const { client } = await import('../../src/lib/client.js');

      await program.parseAsync(['node', 'test', 'role', 'get', 'role-001']);

      expect(client.get).toHaveBeenCalledWith('/v1/roles/role-001');
    });

    it('should output JSON when --json flag is used', async () => {
      const { json } = await import('../../src/lib/output.js');

      await program.parseAsync(['node', 'test', 'role', 'get', 'role-001', '--json']);

      expect(json).toHaveBeenCalledWith(mockRoleDetails);
    });
  });

  describe('role create', () => {
    it('should create a new role', async () => {
      const { client } = await import('../../src/lib/client.js');
      const { success } = await import('../../src/lib/output.js');

      await program.parseAsync([
        'node', 'test', 'role', 'create', 'new-role',
        '--permissions', 'secrets:read,secrets:write',
      ]);

      expect(client.post).toHaveBeenCalledWith('/v1/roles', expect.objectContaining({
        name: 'new-role',
        permissions: ['secrets:read', 'secrets:write'],
      }));
      expect(success).toHaveBeenCalledWith('Role created successfully!');
    });

    it('should create role with tenant and description', async () => {
      const { client } = await import('../../src/lib/client.js');

      await program.parseAsync([
        'node', 'test', 'role', 'create', 'tenant-role',
        '--tenant', 'acme',
        '--description', 'A custom role for tenant',
        '--permissions', 'secrets:read',
      ]);

      expect(client.post).toHaveBeenCalledWith('/v1/roles', expect.objectContaining({
        name: 'tenant-role',
        tenantId: 'acme',
        description: 'A custom role for tenant',
        permissions: ['secrets:read'],
      }));
    });
  });

  describe('role update', () => {
    it('should update a role', async () => {
      const { client } = await import('../../src/lib/client.js');
      const { success } = await import('../../src/lib/output.js');

      await program.parseAsync([
        'node', 'test', 'role', 'update', 'role-003',
        '--name', 'updated-role',
        '--permissions', 'secrets:read,secrets:write',
      ]);

      expect(client.patch).toHaveBeenCalledWith('/v1/roles/role-003', expect.objectContaining({
        name: 'updated-role',
        permissions: ['secrets:read', 'secrets:write'],
      }));
      expect(success).toHaveBeenCalledWith('Role updated successfully!');
    });

    it('should update role description only', async () => {
      const { client } = await import('../../src/lib/client.js');

      await program.parseAsync([
        'node', 'test', 'role', 'update', 'role-003',
        '--description', 'Updated description',
      ]);

      expect(client.patch).toHaveBeenCalledWith('/v1/roles/role-003', expect.objectContaining({
        description: 'Updated description',
      }));
    });
  });

  describe('role delete', () => {
    it('should delete role with confirmation', async () => {
      const { client } = await import('../../src/lib/client.js');
      const { success } = await import('../../src/lib/output.js');

      await program.parseAsync(['node', 'test', 'role', 'delete', 'role-003']);

      expect(client.delete).toHaveBeenCalledWith('/v1/roles/role-003');
      expect(success).toHaveBeenCalledWith('Role deleted successfully');
    });

    it('should skip confirmation with --force flag', async () => {
      const { client } = await import('../../src/lib/client.js');

      await program.parseAsync(['node', 'test', 'role', 'delete', 'role-003', '--force']);

      expect(client.delete).toHaveBeenCalledWith('/v1/roles/role-003');
    });
  });

  describe('role assign', () => {
    it('should assign role to user', async () => {
      const { client } = await import('../../src/lib/client.js');
      const { success } = await import('../../src/lib/output.js');

      await program.parseAsync(['node', 'test', 'role', 'assign', 'role-001', 'user-001']);

      expect(client.post).toHaveBeenCalledWith('/v1/users/user-001/roles', { roleId: 'role-001' });
      expect(success).toHaveBeenCalledWith('Role role-001 assigned to user user-001');
    });

    it('should output JSON when --json flag is used', async () => {
      const { json } = await import('../../src/lib/output.js');

      await program.parseAsync(['node', 'test', 'role', 'assign', 'role-001', 'user-001', '--json']);

      expect(json).toHaveBeenCalledWith({ success: true, roleId: 'role-001', userId: 'user-001' });
    });
  });

  describe('role remove', () => {
    it('should remove role from user', async () => {
      const { client } = await import('../../src/lib/client.js');
      const { success } = await import('../../src/lib/output.js');

      await program.parseAsync(['node', 'test', 'role', 'remove', 'role-001', 'user-001']);

      expect(client.delete).toHaveBeenCalledWith('/v1/users/user-001/roles/role-001');
      expect(success).toHaveBeenCalledWith('Role role-001 removed from user user-001');
    });
  });

  describe('role user-roles', () => {
    it('should get user roles', async () => {
      const { client } = await import('../../src/lib/client.js');

      await program.parseAsync(['node', 'test', 'role', 'user-roles', 'user-001']);

      expect(client.get).toHaveBeenCalledWith('/v1/users/user-001/roles');
    });

    it('should output JSON when --json flag is used', async () => {
      const { json } = await import('../../src/lib/output.js');

      await program.parseAsync(['node', 'test', 'role', 'user-roles', 'user-001', '--json']);

      expect(json).toHaveBeenCalledWith(mockUserRoles);
    });
  });

  describe('role user-permissions', () => {
    it('should get user permissions', async () => {
      const { client } = await import('../../src/lib/client.js');

      await program.parseAsync(['node', 'test', 'role', 'user-permissions', 'user-001']);

      expect(client.get).toHaveBeenCalledWith('/v1/users/user-001/permissions');
    });

    it('should output JSON when --json flag is used', async () => {
      const { json } = await import('../../src/lib/output.js');

      await program.parseAsync(['node', 'test', 'role', 'user-permissions', 'user-001', '--json']);

      expect(json).toHaveBeenCalledWith({ permissions: ['secrets:read', 'kms:encrypt'] });
    });
  });
});
