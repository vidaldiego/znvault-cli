// Path: znvault-cli/test/commands/dynamic-secrets.test.ts

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Command } from 'commander';
import { registerDynamicSecretsCommands } from '../../src/commands/dynamic-secrets.js';

// Mock cli-table3
vi.mock('cli-table3', () => {
  return {
    default: class MockTable {
      push = vi.fn();
      toString = vi.fn().mockReturnValue('table');
    },
  };
});

// Mock inquirer
vi.mock('inquirer', () => ({
  default: {
    prompt: vi.fn(),
  },
}));

// Mock client
vi.mock('../../src/lib/client.js', () => ({
  client: {
    get: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
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
  warn: vi.fn(),
  keyValue: vi.fn(),
  isPlainMode: vi.fn().mockReturnValue(true),
}));

import { client } from '../../src/lib/client.js';
import inquirer from 'inquirer';
import * as output from '../../src/lib/output.js';

describe('Dynamic Secrets Commands', () => {
  let program: Command;
  let mockExit: ReturnType<typeof vi.spyOn>;
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    program = new Command();
    program.exitOverride();
    registerDynamicSecretsCommands(program);

    mockExit = vi.spyOn(process, 'exit').mockImplementation((code?: string | number | null | undefined): never => {
      throw new Error(`process.exit(${code})`);
    });
    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    mockExit.mockRestore();
    consoleSpy.mockRestore();
  });

  // ============ Connection Commands ============
  describe('dynasec connection list', () => {
    it('should list connections', async () => {
      const connections = [
        {
          id: 'conn-123',
          name: 'my-postgres',
          connectionType: 'POSTGRESQL',
          status: 'ACTIVE',
          defaultTtlSeconds: 3600,
          maxTtlSeconds: 86400,
          roleCount: 2,
          activeLeases: 5,
        },
      ];
      vi.mocked(client.get).mockResolvedValue(connections);

      await program.parseAsync(['node', 'test', 'dynasec', 'connection', 'list']);

      expect(client.get).toHaveBeenCalledWith('/v1/dynamic-secrets/connections');
      expect(output.info).toHaveBeenCalledWith('1 connection(s) found');
    });

    it('should output JSON when --json flag is set', async () => {
      const connections = [{ id: 'conn-1', name: 'test' }];
      vi.mocked(client.get).mockResolvedValue(connections);

      await program.parseAsync(['node', 'test', 'dynasec', 'connection', 'list', '--json']);

      expect(output.json).toHaveBeenCalledWith(connections);
    });

    it('should handle empty results', async () => {
      vi.mocked(client.get).mockResolvedValue([]);

      await program.parseAsync(['node', 'test', 'dynasec', 'connection', 'list']);

      expect(output.info).toHaveBeenCalledWith('No database connections found.');
    });

    it('should handle errors', async () => {
      vi.mocked(client.get).mockRejectedValue(new Error('API Error'));

      await expect(program.parseAsync(['node', 'test', 'dynasec', 'connection', 'list'])).rejects.toThrow('process.exit(1)');
      expect(output.error).toHaveBeenCalledWith('API Error');
    });
  });

  describe('dynasec connection get', () => {
    it('should get connection details', async () => {
      const connection = {
        id: 'conn-123',
        name: 'my-postgres',
        description: 'Test DB',
        connectionType: 'POSTGRESQL',
        status: 'ACTIVE',
        maxOpenConnections: 10,
        connectionTimeoutSeconds: 30,
        defaultTtlSeconds: 3600,
        maxTtlSeconds: 86400,
        lastHealthCheck: '2024-01-01T00:00:00Z',
        lastHealthCheckStatus: true,
        roleCount: 2,
        activeLeases: 5,
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
      };
      vi.mocked(client.get).mockResolvedValue(connection);

      await program.parseAsync(['node', 'test', 'dynasec', 'connection', 'get', 'my-postgres']);

      expect(client.get).toHaveBeenCalledWith('/v1/dynamic-secrets/connections/my-postgres');
      expect(output.keyValue).toHaveBeenCalled();
    });

    it('should output JSON when --json flag is set', async () => {
      const connection = { id: 'conn-123', name: 'test' };
      vi.mocked(client.get).mockResolvedValue(connection);

      await program.parseAsync(['node', 'test', 'dynasec', 'connection', 'get', 'conn-123', '--json']);

      expect(output.json).toHaveBeenCalledWith(connection);
    });

    it('should handle errors', async () => {
      vi.mocked(client.get).mockRejectedValue(new Error('Connection not found'));

      await expect(program.parseAsync(['node', 'test', 'dynasec', 'connection', 'get', 'invalid'])).rejects.toThrow('process.exit(1)');
      expect(output.error).toHaveBeenCalledWith('Connection not found');
    });
  });

  describe('dynasec connection create', () => {
    it('should create connection with CLI options', async () => {
      const created = { id: 'new-conn', name: 'my-db' };
      vi.mocked(client.post).mockResolvedValue(created);

      await program.parseAsync([
        'node', 'test', 'dynasec', 'connection', 'create',
        '--name', 'my-db',
        '--type', 'postgresql',
        '--connection-string', 'postgresql://user:pass@localhost:5432/db',
        '--description', 'Test connection',
        '--max-connections', '5',
        '--timeout', '30',
        '--default-ttl', '3600',
        '--max-ttl', '86400',
      ]);

      expect(client.post).toHaveBeenCalledWith('/v1/dynamic-secrets/connections', expect.objectContaining({
        name: 'my-db',
        connectionType: 'POSTGRESQL',
        connectionString: 'postgresql://user:pass@localhost:5432/db',
        description: 'Test connection',
        maxOpenConnections: 5,
        connectionTimeoutSeconds: 30,
        defaultTtlSeconds: 3600,
        maxTtlSeconds: 86400,
      }));
      expect(output.success).toHaveBeenCalled();
    });

    it('should create connection interactively', async () => {
      vi.mocked(inquirer.prompt)
        .mockResolvedValueOnce({ name: 'interactive-db' })
        .mockResolvedValueOnce({ type: 'MYSQL' })
        .mockResolvedValueOnce({ connectionString: 'mysql://user:pass@localhost:3306/db' });
      vi.mocked(client.post).mockResolvedValue({ id: 'conn-123', name: 'interactive-db' });

      await program.parseAsync(['node', 'test', 'dynasec', 'connection', 'create']);

      expect(inquirer.prompt).toHaveBeenCalled();
      expect(client.post).toHaveBeenCalled();
    });

    it('should output JSON when --json flag is set', async () => {
      const created = { id: 'conn-123', name: 'test' };
      vi.mocked(client.post).mockResolvedValue(created);

      await program.parseAsync([
        'node', 'test', 'dynasec', 'connection', 'create',
        '--name', 'test',
        '--type', 'postgresql',
        '--connection-string', 'postgresql://localhost/db',
        '--json',
      ]);

      expect(output.json).toHaveBeenCalledWith(created);
    });

    it('should handle errors', async () => {
      vi.mocked(client.post).mockRejectedValue(new Error('Invalid connection'));

      await expect(program.parseAsync([
        'node', 'test', 'dynasec', 'connection', 'create',
        '--name', 'test',
        '--type', 'postgresql',
        '--connection-string', 'invalid',
      ])).rejects.toThrow('process.exit(1)');
      expect(output.error).toHaveBeenCalledWith('Invalid connection');
    });
  });

  describe('dynasec connection update', () => {
    it('should update connection', async () => {
      const updated = { id: 'conn-123', name: 'updated-db' };
      vi.mocked(client.patch).mockResolvedValue(updated);

      await program.parseAsync([
        'node', 'test', 'dynasec', 'connection', 'update', 'conn-123',
        '--description', 'Updated description',
        '--max-connections', '20',
        '--status', 'disabled',
      ]);

      expect(client.patch).toHaveBeenCalledWith('/v1/dynamic-secrets/connections/conn-123', {
        description: 'Updated description',
        maxOpenConnections: 20,
        status: 'DISABLED',
      });
      expect(output.success).toHaveBeenCalled();
    });

    it('should output JSON when --json flag is set', async () => {
      const updated = { id: 'conn-123', name: 'test' };
      vi.mocked(client.patch).mockResolvedValue(updated);

      await program.parseAsync([
        'node', 'test', 'dynasec', 'connection', 'update', 'conn-123',
        '--description', 'New desc',
        '--json',
      ]);

      expect(output.json).toHaveBeenCalledWith(updated);
    });

    it('should handle errors', async () => {
      vi.mocked(client.patch).mockRejectedValue(new Error('Update failed'));

      await expect(program.parseAsync([
        'node', 'test', 'dynasec', 'connection', 'update', 'conn-123',
        '--description', 'test',
      ])).rejects.toThrow('process.exit(1)');
      expect(output.error).toHaveBeenCalledWith('Update failed');
    });
  });

  describe('dynasec connection delete', () => {
    it('should delete connection with confirmation', async () => {
      vi.mocked(inquirer.prompt).mockResolvedValue({ confirm: true });
      vi.mocked(client.delete).mockResolvedValue(undefined);

      await program.parseAsync(['node', 'test', 'dynasec', 'connection', 'delete', 'conn-123']);

      expect(inquirer.prompt).toHaveBeenCalled();
      const questions = vi.mocked(inquirer.prompt).mock.calls[0]?.[0] as unknown;
      expect(JSON.stringify(questions)).toContain('only when no retained lease history exists');
      expect(client.delete).toHaveBeenCalledWith('/v1/dynamic-secrets/connections/conn-123');
    });

    it('should delete connection with --force flag', async () => {
      vi.mocked(client.delete).mockResolvedValue(undefined);

      await program.parseAsync(['node', 'test', 'dynasec', 'connection', 'delete', 'conn-123', '--force']);

      expect(inquirer.prompt).not.toHaveBeenCalled();
      expect(client.delete).toHaveBeenCalledWith('/v1/dynamic-secrets/connections/conn-123');
    });

    it('should cancel when not confirmed', async () => {
      vi.mocked(inquirer.prompt).mockResolvedValue({ confirm: false });

      await program.parseAsync(['node', 'test', 'dynasec', 'connection', 'delete', 'conn-123']);

      expect(client.delete).not.toHaveBeenCalled();
      expect(output.info).toHaveBeenCalledWith('Cancelled');
    });

    it('should handle errors', async () => {
      vi.mocked(client.delete).mockRejectedValue(new Error('Cannot delete'));

      await expect(program.parseAsync([
        'node', 'test', 'dynasec', 'connection', 'delete', 'conn-123', '--force',
      ])).rejects.toThrow('process.exit(1)');
      expect(output.error).toHaveBeenCalledWith('Cannot delete');
    });
  });

  describe('dynasec connection test', () => {
    it('should test connection successfully', async () => {
      vi.mocked(client.post).mockResolvedValue({ success: true });

      await program.parseAsync(['node', 'test', 'dynasec', 'connection', 'test', 'conn-123']);

      expect(client.post).toHaveBeenCalledWith('/v1/dynamic-secrets/connections/conn-123/test', {});
    });

    it('should report test failure', async () => {
      vi.mocked(client.post).mockResolvedValue({ success: false, error: 'Connection refused' });

      await expect(program.parseAsync(['node', 'test', 'dynasec', 'connection', 'test', 'conn-123'])).rejects.toThrow('process.exit(1)');
      expect(output.error).toHaveBeenCalledWith('Connection refused');
    });

    it('should output JSON when --json flag is set', async () => {
      const result = { success: true };
      vi.mocked(client.post).mockResolvedValue(result);

      await program.parseAsync(['node', 'test', 'dynasec', 'connection', 'test', 'conn-123', '--json']);

      expect(output.json).toHaveBeenCalledWith(result);
    });
  });

  // ============ Role Commands ============
  describe('dynasec role list', () => {
    it('should list all roles', async () => {
      const roles = [
        {
          id: 'role-123',
          name: 'readonly',
          connectionId: 'conn-123',
          connectionName: 'my-postgres',
          isEnabled: true,
          defaultTtlSeconds: 3600,
          maxTtlSeconds: 7200,
          activeLeases: 3,
        },
      ];
      vi.mocked(client.get).mockResolvedValue(roles);

      await program.parseAsync(['node', 'test', 'dynasec', 'role', 'list']);

      expect(client.get).toHaveBeenCalledWith('/v1/dynamic-secrets/roles');
      expect(output.info).toHaveBeenCalledWith('1 role(s) found');
    });

    it('should filter by connection', async () => {
      vi.mocked(client.get).mockResolvedValue([]);

      await program.parseAsync(['node', 'test', 'dynasec', 'role', 'list', '--connection', 'conn-123']);

      expect(client.get).toHaveBeenCalledWith('/v1/dynamic-secrets/connections/conn-123/roles');
    });

    it('should output JSON when --json flag is set', async () => {
      const roles = [{ id: 'role-1' }];
      vi.mocked(client.get).mockResolvedValue(roles);

      await program.parseAsync(['node', 'test', 'dynasec', 'role', 'list', '--json']);

      expect(output.json).toHaveBeenCalledWith(roles);
    });

    it('should handle empty results', async () => {
      vi.mocked(client.get).mockResolvedValue([]);

      await program.parseAsync(['node', 'test', 'dynasec', 'role', 'list']);

      expect(output.info).toHaveBeenCalledWith('No roles found.');
    });
  });

  describe('dynasec role get', () => {
    it('should get role details', async () => {
      const role = {
        id: 'role-123',
        name: 'readonly',
        description: 'Read-only access',
        connectionId: 'conn-123',
        connectionName: 'my-postgres',
        isEnabled: true,
        usernameTemplate: 'v_{{role}}_{{random:8}}',
        defaultTtlSeconds: 3600,
        maxTtlSeconds: 7200,
        activeLeases: 5,
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
      };
      vi.mocked(client.get).mockResolvedValue(role);

      await program.parseAsync(['node', 'test', 'dynasec', 'role', 'get', 'role-123']);

      expect(client.get).toHaveBeenCalledWith('/v1/dynamic-secrets/roles/role-123');
      expect(output.keyValue).toHaveBeenCalled();
    });

    it('should output JSON when --json flag is set', async () => {
      const role = { id: 'role-123', name: 'test' };
      vi.mocked(client.get).mockResolvedValue(role);

      await program.parseAsync(['node', 'test', 'dynasec', 'role', 'get', 'role-123', '--json']);

      expect(output.json).toHaveBeenCalledWith(role);
    });
  });

  describe('dynasec role create', () => {
    it('should create role with CLI options', async () => {
      const created = { id: 'new-role', name: 'readonly' };
      vi.mocked(client.post).mockResolvedValue(created);

      await program.parseAsync([
        'node', 'test', 'dynasec', 'role', 'create', 'conn-123',
        '--name', 'readonly',
        '--description', 'Read-only access',
        '--creation-statements', 'CREATE ROLE "{{username}}" WITH LOGIN PASSWORD \'{{password}}\'',
        '--revocation-statements', 'DROP ROLE IF EXISTS "{{username}}"',
        '--default-ttl', '3600',
        '--max-ttl', '7200',
      ]);

      expect(client.post).toHaveBeenCalledWith('/v1/dynamic-secrets/connections/conn-123/roles', expect.objectContaining({
        name: 'readonly',
        description: 'Read-only access',
        creationStatements: ['CREATE ROLE "{{username}}" WITH LOGIN PASSWORD \'{{password}}\''],
        revocationStatements: ['DROP ROLE IF EXISTS "{{username}}"'],
        defaultTtlSeconds: 3600,
        maxTtlSeconds: 7200,
      }));
      expect(output.success).toHaveBeenCalled();
    });

    it('should create role interactively', async () => {
      vi.mocked(inquirer.prompt)
        .mockResolvedValueOnce({ name: 'interactive-role' })
        .mockResolvedValueOnce({ statements: 'CREATE ROLE "{{username}}"' })
        .mockResolvedValueOnce({ statements: 'DROP ROLE "{{username}}"' });
      vi.mocked(client.post).mockResolvedValue({ id: 'role-123', name: 'interactive-role' });

      await program.parseAsync(['node', 'test', 'dynasec', 'role', 'create', 'conn-123']);

      expect(inquirer.prompt).toHaveBeenCalled();
      expect(client.post).toHaveBeenCalled();
    });

    it('should output JSON when --json flag is set', async () => {
      const created = { id: 'role-123', name: 'test' };
      vi.mocked(client.post).mockResolvedValue(created);

      await program.parseAsync([
        'node', 'test', 'dynasec', 'role', 'create', 'conn-123',
        '--name', 'test',
        '--creation-statements', 'CREATE',
        '--revocation-statements', 'DROP',
        '--json',
      ]);

      expect(output.json).toHaveBeenCalledWith(created);
    });
  });

  describe('dynasec role update', () => {
    it('should update role', async () => {
      const updated = { id: 'role-123', name: 'updated-role' };
      vi.mocked(client.patch).mockResolvedValue(updated);

      await program.parseAsync([
        'node', 'test', 'dynasec', 'role', 'update', 'role-123',
        '--description', 'Updated description',
        '--enabled', 'false',
        '--default-ttl', '1800',
      ]);

      expect(client.patch).toHaveBeenCalledWith('/v1/dynamic-secrets/roles/role-123', {
        description: 'Updated description',
        isEnabled: false,
        defaultTtlSeconds: 1800,
      });
      expect(output.success).toHaveBeenCalled();
    });

    it('should output JSON when --json flag is set', async () => {
      const updated = { id: 'role-123', name: 'test' };
      vi.mocked(client.patch).mockResolvedValue(updated);

      await program.parseAsync([
        'node', 'test', 'dynasec', 'role', 'update', 'role-123',
        '--description', 'test',
        '--json',
      ]);

      expect(output.json).toHaveBeenCalledWith(updated);
    });

    it('should update role with creation/revocation/renew statements split by semicolon', async () => {
      const updated = { id: 'role-123', name: 'updated-role' };
      vi.mocked(client.patch).mockResolvedValue(updated);

      await program.parseAsync([
        'node', 'test', 'dynasec', 'role', 'update', 'role-123',
        '--creation-statements', 'CREATE USER x;GRANT SELECT ON *.* TO x',
        '--revocation-statements', 'DROP USER IF EXISTS x',
        '--renew-statements', 'ALTER USER x IDENTIFIED BY \'{{password}}\'',
      ]);

      expect(client.patch).toHaveBeenCalledWith('/v1/dynamic-secrets/roles/role-123', expect.objectContaining({
        creationStatements: ['CREATE USER x', 'GRANT SELECT ON *.* TO x'],
        revocationStatements: ['DROP USER IF EXISTS x'],
        renewStatements: ['ALTER USER x IDENTIFIED BY \'{{password}}\''],
      }));
      expect(output.success).toHaveBeenCalled();
    });
  });

  describe('dynasec role delete', () => {
    it('should delete role with confirmation', async () => {
      vi.mocked(inquirer.prompt).mockResolvedValue({ confirm: true });
      vi.mocked(client.delete).mockResolvedValue(undefined);

      await program.parseAsync(['node', 'test', 'dynasec', 'role', 'delete', 'role-123']);

      expect(inquirer.prompt).toHaveBeenCalled();
      const questions = vi.mocked(inquirer.prompt).mock.calls[0]?.[0] as unknown;
      expect(JSON.stringify(questions)).toContain('blocked while retained lease history exists');
      expect(client.delete).toHaveBeenCalledWith('/v1/dynamic-secrets/roles/role-123');
    });

    it('should delete role with --force flag', async () => {
      vi.mocked(client.delete).mockResolvedValue(undefined);

      await program.parseAsync(['node', 'test', 'dynasec', 'role', 'delete', 'role-123', '--force']);

      expect(inquirer.prompt).not.toHaveBeenCalled();
      expect(client.delete).toHaveBeenCalledWith('/v1/dynamic-secrets/roles/role-123');
    });

    it('should cancel when not confirmed', async () => {
      vi.mocked(inquirer.prompt).mockResolvedValue({ confirm: false });

      await program.parseAsync(['node', 'test', 'dynasec', 'role', 'delete', 'role-123']);

      expect(client.delete).not.toHaveBeenCalled();
      expect(output.info).toHaveBeenCalledWith('Cancelled');
    });
  });

  // ============ Credentials Commands ============
  describe('dynasec creds generate', () => {
    it('should generate credentials', async () => {
      const credentials = {
        leaseId: 'lease-123',
        username: 'v_readonly_abc123',
        password: 'secret-password',
        expiresAt: '2024-01-02T00:00:00Z',
        maxExpiresAt: '2024-01-03T00:00:00Z',
        ttlSeconds: 3600,
        renewalCount: 0,
      };
      vi.mocked(client.post).mockResolvedValue(credentials);

      await program.parseAsync(['node', 'test', 'dynasec', 'creds', 'generate', 'role-123']);

      expect(client.post).toHaveBeenCalledWith('/v1/dynamic-secrets/roles/role-123/credentials', {});
      expect(output.keyValue).toHaveBeenCalled();
      expect(output.warn).toHaveBeenCalledWith('The password is shown only once. Store it securely or use it immediately.');
    });

    it('should generate credentials with custom TTL', async () => {
      const credentials = { leaseId: 'lease-123', ttlSeconds: 7200 };
      vi.mocked(client.post).mockResolvedValue(credentials);

      await program.parseAsync(['node', 'test', 'dynasec', 'creds', 'generate', 'role-123', '--ttl', '7200']);

      expect(client.post).toHaveBeenCalledWith('/v1/dynamic-secrets/roles/role-123/credentials', { ttlSeconds: 7200 });
    });

    it('should output JSON when --json flag is set', async () => {
      const credentials = { leaseId: 'lease-123', username: 'test', password: 'secret' };
      vi.mocked(client.post).mockResolvedValue(credentials);

      await program.parseAsync(['node', 'test', 'dynasec', 'creds', 'generate', 'role-123', '--json']);

      expect(output.json).toHaveBeenCalledWith(credentials);
    });

    it('should handle errors', async () => {
      vi.mocked(client.post).mockRejectedValue(new Error('Role disabled'));

      await expect(program.parseAsync(['node', 'test', 'dynasec', 'creds', 'generate', 'role-123'])).rejects.toThrow('process.exit(1)');
      expect(output.error).toHaveBeenCalledWith('Role disabled');
    });
  });

  // ============ Lease Commands ============
  describe('dynasec lease list', () => {
    it('should list all leases', async () => {
      const leases = [
        {
          id: 'lease-123',
          username: 'v_readonly_abc123',
          roleId: 'role-123',
          roleName: 'readonly',
          status: 'ACTIVE',
          ttlRemaining: 1800,
          renewalCount: 2,
        },
      ];
      vi.mocked(client.get).mockResolvedValue(leases);

      await program.parseAsync(['node', 'test', 'dynasec', 'lease', 'list']);

      expect(client.get).toHaveBeenCalledWith('/v1/dynamic-secrets/leases');
      expect(output.info).toHaveBeenCalledWith('1 lease(s) found');
    });

    it('should filter by role', async () => {
      vi.mocked(client.get).mockResolvedValue([]);

      await program.parseAsync(['node', 'test', 'dynasec', 'lease', 'list', '--role', 'role-123']);

      expect(client.get).toHaveBeenCalledWith('/v1/dynamic-secrets/leases?roleId=role-123');
    });

    it('should filter by status', async () => {
      vi.mocked(client.get).mockResolvedValue([]);

      await program.parseAsync(['node', 'test', 'dynasec', 'lease', 'list', '--status', 'active']);

      expect(client.get).toHaveBeenCalledWith('/v1/dynamic-secrets/leases?status=ACTIVE');
    });

    it('should output JSON when --json flag is set', async () => {
      const leases = [{ id: 'lease-1' }];
      vi.mocked(client.get).mockResolvedValue(leases);

      await program.parseAsync(['node', 'test', 'dynasec', 'lease', 'list', '--json']);

      expect(output.json).toHaveBeenCalledWith(leases);
    });

    it('should handle empty results', async () => {
      vi.mocked(client.get).mockResolvedValue([]);

      await program.parseAsync(['node', 'test', 'dynasec', 'lease', 'list']);

      expect(output.info).toHaveBeenCalledWith('No leases found.');
    });
  });

  describe('dynasec lease get', () => {
    it('should get lease details', async () => {
      const lease = {
        id: 'lease-123',
        username: 'v_readonly_abc123',
        roleId: 'role-123',
        roleName: 'readonly',
        connectionId: 'conn-123',
        connectionName: 'my-postgres',
        status: 'ACTIVE',
        ttlRemaining: 1800,
        renewalCount: 2,
        issuedAt: '2024-01-01T00:00:00Z',
        expiresAt: '2024-01-02T00:00:00Z',
        maxExpiresAt: '2024-01-03T00:00:00Z',
        lastRenewedAt: '2024-01-01T12:00:00Z',
        revokedAt: null,
        revokedBy: null,
        revokeReason: null,
      };
      vi.mocked(client.get).mockResolvedValue(lease);

      await program.parseAsync(['node', 'test', 'dynasec', 'lease', 'get', 'lease-123']);

      expect(client.get).toHaveBeenCalledWith('/v1/dynamic-secrets/leases/lease-123');
      expect(output.keyValue).toHaveBeenCalled();
    });

    it('should output JSON when --json flag is set', async () => {
      const lease = { id: 'lease-123', username: 'test' };
      vi.mocked(client.get).mockResolvedValue(lease);

      await program.parseAsync(['node', 'test', 'dynasec', 'lease', 'get', 'lease-123', '--json']);

      expect(output.json).toHaveBeenCalledWith(lease);
    });
  });

  describe('dynasec lease renew', () => {
    it('should renew lease', async () => {
      const result = {
        leaseId: 'lease-123',
        expiresAt: '2024-01-02T00:00:00Z',
        renewalCount: 3,
        ttlSeconds: 3600,
      };
      vi.mocked(client.post).mockResolvedValue(result);

      await program.parseAsync(['node', 'test', 'dynasec', 'lease', 'renew', 'lease-123']);

      expect(client.post).toHaveBeenCalledWith('/v1/dynamic-secrets/leases/lease-123/renew', {});
      expect(output.success).toHaveBeenCalled();
    });

    it('should renew lease with custom TTL', async () => {
      const result = { leaseId: 'lease-123', ttlSeconds: 7200, renewalCount: 4 };
      vi.mocked(client.post).mockResolvedValue(result);

      await program.parseAsync(['node', 'test', 'dynasec', 'lease', 'renew', 'lease-123', '--ttl', '7200']);

      expect(client.post).toHaveBeenCalledWith('/v1/dynamic-secrets/leases/lease-123/renew', { ttlSeconds: 7200 });
    });

    it('should output JSON when --json flag is set', async () => {
      const result = { leaseId: 'lease-123', ttlSeconds: 3600, renewalCount: 3 };
      vi.mocked(client.post).mockResolvedValue(result);

      await program.parseAsync(['node', 'test', 'dynasec', 'lease', 'renew', 'lease-123', '--json']);

      expect(output.json).toHaveBeenCalledWith(result);
    });

    it('should handle errors', async () => {
      vi.mocked(client.post).mockRejectedValue(new Error('Lease expired'));

      await expect(program.parseAsync(['node', 'test', 'dynasec', 'lease', 'renew', 'lease-123'])).rejects.toThrow('process.exit(1)');
      expect(output.error).toHaveBeenCalledWith('Lease expired');
    });
  });

  describe('dynasec lease revoke', () => {
    it('should revoke lease with confirmation', async () => {
      vi.mocked(inquirer.prompt).mockResolvedValue({ confirm: true });
      vi.mocked(client.post).mockResolvedValue(undefined);

      await program.parseAsync(['node', 'test', 'dynasec', 'lease', 'revoke', 'lease-123']);

      expect(inquirer.prompt).toHaveBeenCalled();
      expect(client.post).toHaveBeenCalledWith('/v1/dynamic-secrets/leases/lease-123/revoke', {});
    });

    it('should revoke lease with --force flag', async () => {
      vi.mocked(client.post).mockResolvedValue(undefined);

      await program.parseAsync(['node', 'test', 'dynasec', 'lease', 'revoke', 'lease-123', '--force']);

      expect(inquirer.prompt).not.toHaveBeenCalled();
      expect(client.post).toHaveBeenCalledWith('/v1/dynamic-secrets/leases/lease-123/revoke', {});
    });

    it('should revoke lease with reason', async () => {
      vi.mocked(client.post).mockResolvedValue(undefined);

      await program.parseAsync([
        'node', 'test', 'dynasec', 'lease', 'revoke', 'lease-123',
        '--force',
        '--reason', 'No longer needed',
      ]);

      expect(client.post).toHaveBeenCalledWith('/v1/dynamic-secrets/leases/lease-123/revoke', { reason: 'No longer needed' });
    });

    it('should cancel when not confirmed', async () => {
      vi.mocked(inquirer.prompt).mockResolvedValue({ confirm: false });

      await program.parseAsync(['node', 'test', 'dynasec', 'lease', 'revoke', 'lease-123']);

      expect(client.post).not.toHaveBeenCalled();
      expect(output.info).toHaveBeenCalledWith('Cancelled');
    });

    it('should handle errors', async () => {
      vi.mocked(client.post).mockRejectedValue(new Error('Revocation failed'));

      await expect(program.parseAsync([
        'node', 'test', 'dynasec', 'lease', 'revoke', 'lease-123', '--force',
      ])).rejects.toThrow('process.exit(1)');
      expect(output.error).toHaveBeenCalledWith('Revocation failed');
    });
  });
});
