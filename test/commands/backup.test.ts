// Path: znvault-cli/test/commands/backup.test.ts

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

const mockBackups = [
  {
    id: 'backup-001',
    filename: 'znvault-backup-2024-01-15.enc',
    storageIdentifier: '/backups/znvault-backup-2024-01-15.enc',
    storageType: 'local' as const,
    status: 'completed' as const,
    dbSizeBytes: 1024 * 1024 * 50,
    backupSizeBytes: 1024 * 1024 * 20,
    encrypted: true,
    checksum: 'sha256:abc123',
    initiatedBy: 'scheduled' as const,
    metadata: { duration: 5000, compressionRatio: 0.4 },
    createdAt: new Date().toISOString(),
    completedAt: new Date().toISOString(),
  },
  {
    id: 'backup-002',
    filename: 'znvault-backup-2024-01-14.enc',
    storageIdentifier: '/backups/znvault-backup-2024-01-14.enc',
    storageType: 'local' as const,
    status: 'verified' as const,
    dbSizeBytes: 1024 * 1024 * 48,
    backupSizeBytes: 1024 * 1024 * 18,
    encrypted: true,
    checksum: 'sha256:def456',
    initiatedBy: 'manual' as const,
    verifiedAt: new Date().toISOString(),
    metadata: { duration: 4500 },
    createdAt: new Date().toISOString(),
    completedAt: new Date().toISOString(),
  },
];

const mockBackupDetails = mockBackups[0];

const mockStats = {
  totalBackups: 10,
  totalSizeBytes: 1024 * 1024 * 200,
  lastBackup: new Date().toISOString(),
  lastSuccessful: new Date().toISOString(),
  verifiedCount: 5,
  failedCount: 1,
};

const mockHealth = {
  healthy: true,
  lastBackupAge: 4,
  lastBackupStatus: 'completed',
  storageAccessible: true,
  warnings: [],
};

const mockConfig = {
  enabled: true,
  schedule: '0 2 * * *',
  retention: { maxCount: 30, maxAgeDays: 90 },
  storage: { type: 'local' as const, path: '/backups' },
};

vi.mock('../../src/lib/client.js', () => ({
  client: {
    get: vi.fn().mockImplementation((path: string) => {
      if (path.includes('/v1/admin/backups?')) return Promise.resolve({ items: mockBackups, total: 2, page: 1, pageSize: 20 });
      if (path.includes('/stats')) return Promise.resolve(mockStats);
      if (path.includes('/health')) return Promise.resolve(mockHealth);
      if (path.includes('/config')) return Promise.resolve(mockConfig);
      if (path.includes('/v1/admin/backups/')) return Promise.resolve(mockBackupDetails);
      return Promise.resolve(mockBackupDetails);
    }),
    post: vi.fn().mockImplementation((path: string) => {
      if (path.includes('/verify')) return Promise.resolve({ valid: true, checksum: 'sha256:abc123', integrityCheck: 'passed', message: 'OK' });
      return Promise.resolve({ message: 'Backup created', backup: mockBackupDetails });
    }),
    patch: vi.fn().mockResolvedValue(mockConfig),
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

describe('backup commands', () => {
  let program: Command;
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    program = new Command();
    program.exitOverride();

    const { registerBackupCommands } = await import('../../src/commands/backup.js');
    registerBackupCommands(program);

    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleSpy.mockRestore();
    vi.clearAllMocks();
  });

  describe('backup list', () => {
    it('should list all backups', async () => {
      const { client } = await import('../../src/lib/client.js');
      const { info } = await import('../../src/lib/output.js');

      await program.parseAsync(['node', 'test', 'backup', 'list']);

      expect(client.get).toHaveBeenCalled();
      expect(info).toHaveBeenCalledWith('Total: 2 backup(s)');
    });

    it('should filter by status', async () => {
      const { client } = await import('../../src/lib/client.js');

      await program.parseAsync(['node', 'test', 'backup', 'list', '--status', 'completed']);

      expect(client.get).toHaveBeenCalledWith(expect.stringContaining('status=completed'));
    });

    it('should limit results', async () => {
      const { client } = await import('../../src/lib/client.js');

      await program.parseAsync(['node', 'test', 'backup', 'list', '--limit', '5']);

      expect(client.get).toHaveBeenCalledWith(expect.stringContaining('limit=5'));
    });

    it('should output JSON when --json flag is used', async () => {
      const { json } = await import('../../src/lib/output.js');

      await program.parseAsync(['node', 'test', 'backup', 'list', '--json']);

      expect(json).toHaveBeenCalledWith(mockBackups);
    });
  });

  describe('backup get', () => {
    it('should get backup details', async () => {
      const { client } = await import('../../src/lib/client.js');

      await program.parseAsync(['node', 'test', 'backup', 'get', 'backup-001']);

      expect(client.get).toHaveBeenCalledWith('/v1/admin/backups/backup-001');
    });

    it('should output JSON when --json flag is used', async () => {
      const { json } = await import('../../src/lib/output.js');

      await program.parseAsync(['node', 'test', 'backup', 'get', 'backup-001', '--json']);

      expect(json).toHaveBeenCalledWith(mockBackupDetails);
    });
  });

  describe('backup create', () => {
    it('should create a new backup', async () => {
      const { client } = await import('../../src/lib/client.js');
      const { success } = await import('../../src/lib/output.js');

      await program.parseAsync(['node', 'test', 'backup', 'create']);

      expect(client.post).toHaveBeenCalledWith('/v1/admin/backups', {});
      expect(success).toHaveBeenCalledWith('Backup created successfully!');
    });
  });

  describe('backup verify', () => {
    it('should verify backup integrity', async () => {
      const { client } = await import('../../src/lib/client.js');
      const { success } = await import('../../src/lib/output.js');

      await program.parseAsync(['node', 'test', 'backup', 'verify', 'backup-001']);

      expect(client.post).toHaveBeenCalledWith('/v1/admin/backups/backup-001/verify', {});
      expect(success).toHaveBeenCalledWith('Backup verification passed!');
    });
  });

  describe('backup delete', () => {
    it('should delete backup with confirmation', async () => {
      const { client } = await import('../../src/lib/client.js');
      const { success } = await import('../../src/lib/output.js');

      await program.parseAsync(['node', 'test', 'backup', 'delete', 'backup-001']);

      expect(client.delete).toHaveBeenCalledWith('/v1/admin/backups/backup-001');
      expect(success).toHaveBeenCalledWith('Backup deleted successfully');
    });

    it('should skip confirmation with --force flag', async () => {
      const { client } = await import('../../src/lib/client.js');

      await program.parseAsync(['node', 'test', 'backup', 'delete', 'backup-001', '--force']);

      expect(client.delete).toHaveBeenCalledWith('/v1/admin/backups/backup-001');
    });
  });

  describe('backup stats', () => {
    it('should show backup statistics', async () => {
      const { client } = await import('../../src/lib/client.js');

      await program.parseAsync(['node', 'test', 'backup', 'stats']);

      expect(client.get).toHaveBeenCalledWith('/v1/admin/backups/stats');
    });

    it('should output JSON when --json flag is used', async () => {
      const { json } = await import('../../src/lib/output.js');

      await program.parseAsync(['node', 'test', 'backup', 'stats', '--json']);

      expect(json).toHaveBeenCalledWith(mockStats);
    });
  });

  describe('backup health', () => {
    it('should check backup system health', async () => {
      const { client } = await import('../../src/lib/client.js');
      const { success } = await import('../../src/lib/output.js');

      await program.parseAsync(['node', 'test', 'backup', 'health']);

      expect(client.get).toHaveBeenCalledWith('/v1/admin/backups/health');
      expect(success).toHaveBeenCalledWith('Backup system is healthy');
    });

    it('should output JSON when --json flag is used', async () => {
      const { json } = await import('../../src/lib/output.js');

      await program.parseAsync(['node', 'test', 'backup', 'health', '--json']);

      expect(json).toHaveBeenCalledWith(mockHealth);
    });
  });

  describe('backup config', () => {
    it('should show backup configuration', async () => {
      const { client } = await import('../../src/lib/client.js');

      await program.parseAsync(['node', 'test', 'backup', 'config']);

      expect(client.get).toHaveBeenCalledWith('/v1/admin/backups/config');
    });

    it('should output JSON when --json flag is used', async () => {
      const { json } = await import('../../src/lib/output.js');

      await program.parseAsync(['node', 'test', 'backup', 'config', '--json']);

      expect(json).toHaveBeenCalledWith(mockConfig);
    });
  });

  describe('backup config-update', () => {
    it('should update backup configuration', async () => {
      const { client } = await import('../../src/lib/client.js');
      const { success } = await import('../../src/lib/output.js');

      await program.parseAsync([
        'node', 'test', 'backup', 'config-update',
        '--schedule', '0 3 * * *',
        '--max-count', '50',
      ]);

      expect(client.patch).toHaveBeenCalledWith('/v1/admin/backups/config', expect.objectContaining({
        schedule: '0 3 * * *',
        retention: { maxCount: 50 },
      }));
      expect(success).toHaveBeenCalledWith('Backup configuration updated');
    });

    it('should enable/disable automatic backups', async () => {
      const { client } = await import('../../src/lib/client.js');

      await program.parseAsync(['node', 'test', 'backup', 'config-update', '--enabled']);

      expect(client.patch).toHaveBeenCalledWith('/v1/admin/backups/config', expect.objectContaining({
        enabled: true,
      }));
    });
  });
});
