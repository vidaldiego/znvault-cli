// Path: znvault-cli/test/commands/cert.test.ts

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Command } from 'commander';

// Mock mode (API client)
vi.mock('../../src/lib/mode.js', () => ({
  apiGet: vi.fn(),
  apiPost: vi.fn(),
  apiDelete: vi.fn(),
  closeLocalClient: vi.fn(),
}));

// Mock output
vi.mock('../../src/lib/output.js', () => ({
  spinner: vi.fn(() => ({ start: vi.fn().mockReturnThis(), stop: vi.fn().mockReturnThis(), succeed: vi.fn().mockReturnThis(), fail: vi.fn().mockReturnThis(), warn: vi.fn().mockReturnThis(), info: vi.fn().mockReturnThis(), text: '', isSpinning: false })),
  success: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  keyValue: vi.fn(),
  json: vi.fn(),
  table: vi.fn(),
  formatStatus: vi.fn((status) => {
    if (status === 'ok') return '✓';
    if (status === 'warning') return '⚠';
    if (status === 'error') return '✗';
    return status;
  }),
}));

// Mock fs for store/rotate commands
vi.mock('node:fs', () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
}));

// Mock process.exit
vi.spyOn(process, 'exit').mockImplementation(() => {
  throw new Error('process.exit called');
});

describe('cert commands', () => {
  let program: Command;
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  // Sample test data
  const mockCertificate = {
    id: 'cert-123',
    tenantId: 'tenant-1',
    alias: 'my-cert',
    kind: 'AEAT',
    clientId: 'B12345678',
    clientName: 'Test Company',
    subjectCn: 'Test Certificate Subject',
    issuerCn: 'Test CA',
    notBefore: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(),
    notAfter: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(),
    fingerprintSha256: 'abc123def456abc123def456abc123def456',
    status: 'ACTIVE',
    daysUntilExpiry: 365,
    hasPrivateKey: true,
    version: 1,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    lastAccessedAt: null,
    accessCount: 0,
    tags: [],
    contactEmail: 'admin@example.com',
  };

  const mockStats = {
    total: 10,
    byStatus: {
      ACTIVE: 8,
      EXPIRING_SOON: 1,
      EXPIRED: 1,
    },
    byKind: {
      AEAT: 5,
      FNMT: 3,
      CUSTOM: 2,
    },
    expiringIn7Days: 0,
    expiringIn30Days: 1,
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    program = new Command();
    program.exitOverride();

    const { registerCertCommands } = await import('../../src/commands/cert.js');
    registerCertCommands(program);

    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleSpy.mockRestore();
    vi.clearAllMocks();
  });

  // ===== cert list =====
  describe('cert list', () => {
    it('should list certificates', async () => {
      const { apiGet } = await import('../../src/lib/mode.js');
      const { table } = await import('../../src/lib/output.js');

      vi.mocked(apiGet).mockResolvedValue({
        items: [mockCertificate],
        total: 1,
      });

      await program.parseAsync(['node', 'test', 'cert', 'list']);

      expect(apiGet).toHaveBeenCalledWith('/v1/certificates');
      expect(table).toHaveBeenCalled();
    });

    it('should filter by status', async () => {
      const { apiGet } = await import('../../src/lib/mode.js');

      vi.mocked(apiGet).mockResolvedValue({ items: [], total: 0 });

      await program.parseAsync(['node', 'test', 'cert', 'list', '--status', 'ACTIVE']);

      expect(apiGet).toHaveBeenCalledWith('/v1/certificates?status=ACTIVE');
    });

    it('should filter by kind', async () => {
      const { apiGet } = await import('../../src/lib/mode.js');

      vi.mocked(apiGet).mockResolvedValue({ items: [], total: 0 });

      await program.parseAsync(['node', 'test', 'cert', 'list', '--kind', 'AEAT']);

      expect(apiGet).toHaveBeenCalledWith('/v1/certificates?kind=AEAT');
    });

    it('should filter by expiring days', async () => {
      const { apiGet } = await import('../../src/lib/mode.js');

      vi.mocked(apiGet).mockResolvedValue([]);

      await program.parseAsync(['node', 'test', 'cert', 'list', '--expiring', '30']);

      expect(apiGet).toHaveBeenCalledWith('/v1/certificates/expiring?days=30');
    });

    it('should output JSON when --json flag is used', async () => {
      const { apiGet } = await import('../../src/lib/mode.js');
      const { json } = await import('../../src/lib/output.js');

      const response = { items: [mockCertificate], total: 1 };
      vi.mocked(apiGet).mockResolvedValue(response);

      await program.parseAsync(['node', 'test', 'cert', 'list', '--json']);

      expect(json).toHaveBeenCalledWith(response);
    });

    it('should show message when no certificates found', async () => {
      const { apiGet } = await import('../../src/lib/mode.js');

      vi.mocked(apiGet).mockResolvedValue({ items: [], total: 0 });

      await program.parseAsync(['node', 'test', 'cert', 'list']);

      expect(consoleSpy).toHaveBeenCalledWith('No certificates found');
    });

    it('should handle API errors', async () => {
      const { apiGet } = await import('../../src/lib/mode.js');
      const { error } = await import('../../src/lib/output.js');

      vi.mocked(apiGet).mockRejectedValue(new Error('Network error'));

      await expect(
        program.parseAsync(['node', 'test', 'cert', 'list'])
      ).rejects.toThrow('process.exit called');

      expect(error).toHaveBeenCalledWith('Network error');
    });
  });

  // ===== cert get =====
  describe('cert get', () => {
    it('should get certificate details', async () => {
      const { apiGet } = await import('../../src/lib/mode.js');

      vi.mocked(apiGet).mockResolvedValue(mockCertificate);

      await program.parseAsync(['node', 'test', 'cert', 'get', 'cert-123']);

      expect(apiGet).toHaveBeenCalledWith('/v1/certificates/cert-123');
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('ID:'));
    });

    it('should output JSON when --json flag is used', async () => {
      const { apiGet } = await import('../../src/lib/mode.js');
      const { json } = await import('../../src/lib/output.js');

      vi.mocked(apiGet).mockResolvedValue(mockCertificate);

      await program.parseAsync(['node', 'test', 'cert', 'get', 'cert-123', '--json']);

      expect(json).toHaveBeenCalledWith(mockCertificate);
    });
  });

  // ===== cert decrypt =====
  describe('cert decrypt', () => {
    it('should decrypt certificate', async () => {
      const { apiPost } = await import('../../src/lib/mode.js');

      vi.mocked(apiPost).mockResolvedValue({
        certificateData: Buffer.from('-----BEGIN CERTIFICATE-----\ntest\n-----END CERTIFICATE-----').toString('base64'),
      });

      await program.parseAsync(['node', 'test', 'cert', 'decrypt', 'cert-123']);

      expect(apiPost).toHaveBeenCalledWith('/v1/certificates/cert-123/decrypt', {
        purpose: 'CLI access',
      });
    });

    it('should write to file when --output specified', async () => {
      const { apiPost } = await import('../../src/lib/mode.js');
      const fs = await import('node:fs');

      vi.mocked(apiPost).mockResolvedValue({
        certificateData: Buffer.from('test cert data').toString('base64'),
      });

      await program.parseAsync(['node', 'test', 'cert', 'decrypt', 'cert-123', '--output', '/tmp/cert.pem']);

      expect(fs.writeFileSync).toHaveBeenCalledWith('/tmp/cert.pem', 'test cert data');
    });

    it('should pass custom purpose', async () => {
      const { apiPost } = await import('../../src/lib/mode.js');

      vi.mocked(apiPost).mockResolvedValue({
        certificateData: Buffer.from('test').toString('base64'),
      });

      await program.parseAsync(['node', 'test', 'cert', 'decrypt', 'cert-123', '--purpose', 'backup']);

      expect(apiPost).toHaveBeenCalledWith('/v1/certificates/cert-123/decrypt', {
        purpose: 'backup',
      });
    });
  });

  // ===== cert expiring =====
  describe('cert expiring', () => {
    it('should list expiring certificates', async () => {
      const { apiGet } = await import('../../src/lib/mode.js');
      const { table } = await import('../../src/lib/output.js');

      vi.mocked(apiGet).mockResolvedValue([mockCertificate]);

      await program.parseAsync(['node', 'test', 'cert', 'expiring']);

      expect(apiGet).toHaveBeenCalledWith('/v1/certificates/expiring?days=30');
      expect(table).toHaveBeenCalled();
    });

    it('should use custom days parameter', async () => {
      const { apiGet } = await import('../../src/lib/mode.js');

      vi.mocked(apiGet).mockResolvedValue([]);

      await program.parseAsync(['node', 'test', 'cert', 'expiring', '--days', '7']);

      expect(apiGet).toHaveBeenCalledWith('/v1/certificates/expiring?days=7');
    });

    it('should show message when no expiring certificates', async () => {
      const { apiGet } = await import('../../src/lib/mode.js');

      vi.mocked(apiGet).mockResolvedValue([]);

      await program.parseAsync(['node', 'test', 'cert', 'expiring', '--days', '7']);

      expect(consoleSpy).toHaveBeenCalledWith('No certificates expiring within 7 days');
    });

    it('should output JSON when --json flag is used', async () => {
      const { apiGet } = await import('../../src/lib/mode.js');
      const { json } = await import('../../src/lib/output.js');

      vi.mocked(apiGet).mockResolvedValue([mockCertificate]);

      await program.parseAsync(['node', 'test', 'cert', 'expiring', '--json']);

      expect(json).toHaveBeenCalledWith([mockCertificate]);
    });
  });

  // ===== cert stats =====
  describe('cert stats', () => {
    it('should get certificate statistics', async () => {
      const { apiGet } = await import('../../src/lib/mode.js');

      vi.mocked(apiGet).mockResolvedValue(mockStats);

      await program.parseAsync(['node', 'test', 'cert', 'stats']);

      expect(apiGet).toHaveBeenCalledWith('/v1/certificates/stats');
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Total Certificates:'));
    });

    it('should output JSON when --json flag is used', async () => {
      const { apiGet } = await import('../../src/lib/mode.js');
      const { json } = await import('../../src/lib/output.js');

      vi.mocked(apiGet).mockResolvedValue(mockStats);

      await program.parseAsync(['node', 'test', 'cert', 'stats', '--json']);

      expect(json).toHaveBeenCalledWith(mockStats);
    });
  });

  // ===== cert store =====
  describe('cert store', () => {
    it('should store a certificate', async () => {
      const { apiPost } = await import('../../src/lib/mode.js');
      const fs = await import('node:fs');

      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(Buffer.from('cert data'));
      vi.mocked(apiPost).mockResolvedValue(mockCertificate);

      await program.parseAsync([
        'node', 'test', 'cert', 'store',
        '--file', '/path/to/cert.pem',
        '--client-id', 'B12345678',
        '--kind', 'AEAT',
        '--alias', 'my-cert'
      ]);

      expect(apiPost).toHaveBeenCalledWith('/v1/certificates', expect.objectContaining({
        clientId: 'B12345678',
        kind: 'AEAT',
        alias: 'my-cert',
        certificateType: 'PEM',
        purpose: 'SIGNING',
      }));
    });

    it('should error when file not found', async () => {
      const { error } = await import('../../src/lib/output.js');
      const fs = await import('node:fs');

      vi.mocked(fs.existsSync).mockReturnValue(false);

      await expect(
        program.parseAsync([
          'node', 'test', 'cert', 'store',
          '--file', '/nonexistent.pem',
          '--client-id', 'B12345678',
          '--kind', 'AEAT',
          '--alias', 'my-cert'
        ])
      ).rejects.toThrow('process.exit called');

      expect(error).toHaveBeenCalledWith('File not found: /nonexistent.pem');
    });

    it('should pass optional parameters', async () => {
      const { apiPost } = await import('../../src/lib/mode.js');
      const fs = await import('node:fs');

      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(Buffer.from('cert data'));
      vi.mocked(apiPost).mockResolvedValue(mockCertificate);

      await program.parseAsync([
        'node', 'test', 'cert', 'store',
        '--file', '/path/to/cert.p12',
        '--client-id', 'B12345678',
        '--kind', 'AEAT',
        '--alias', 'my-cert',
        '--type', 'P12',
        '--passphrase', 'secret123',
        '--client-name', 'Test Company',
        '--contact', 'admin@example.com',
        '--tags', 'prod,critical'
      ]);

      expect(apiPost).toHaveBeenCalledWith('/v1/certificates', expect.objectContaining({
        clientId: 'B12345678',
        kind: 'AEAT',
        alias: 'my-cert',
        certificateType: 'P12',
        passphrase: 'secret123',
        clientName: 'Test Company',
        contactEmail: 'admin@example.com',
        tags: ['prod', 'critical'],
      }));
    });
  });

  // ===== cert rotate =====
  describe('cert rotate', () => {
    it('should rotate a certificate', async () => {
      const { apiPost } = await import('../../src/lib/mode.js');
      const fs = await import('node:fs');

      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(Buffer.from('new cert data'));
      vi.mocked(apiPost).mockResolvedValue({ ...mockCertificate, version: 2 });

      await program.parseAsync([
        'node', 'test', 'cert', 'rotate', 'cert-123',
        '--file', '/path/to/new-cert.pem'
      ]);

      expect(apiPost).toHaveBeenCalledWith('/v1/certificates/cert-123/rotate', expect.objectContaining({
        certificateType: 'PEM',
        reason: 'Certificate renewal',
      }));
    });

    it('should error when file not found', async () => {
      const { error } = await import('../../src/lib/output.js');
      const fs = await import('node:fs');

      vi.mocked(fs.existsSync).mockReturnValue(false);

      await expect(
        program.parseAsync([
          'node', 'test', 'cert', 'rotate', 'cert-123',
          '--file', '/nonexistent.pem'
        ])
      ).rejects.toThrow('process.exit called');

      expect(error).toHaveBeenCalledWith('File not found: /nonexistent.pem');
    });

    it('should pass custom reason', async () => {
      const { apiPost } = await import('../../src/lib/mode.js');
      const fs = await import('node:fs');

      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(Buffer.from('new cert data'));
      vi.mocked(apiPost).mockResolvedValue({ ...mockCertificate, version: 2 });

      await program.parseAsync([
        'node', 'test', 'cert', 'rotate', 'cert-123',
        '--file', '/path/to/new-cert.pem',
        '--reason', 'Key compromise'
      ]);

      expect(apiPost).toHaveBeenCalledWith('/v1/certificates/cert-123/rotate', expect.objectContaining({
        reason: 'Key compromise',
      }));
    });
  });

  // ===== cert delete =====
  describe('cert delete', () => {
    it('should delete certificate with --force flag', async () => {
      const { apiDelete } = await import('../../src/lib/mode.js');

      vi.mocked(apiDelete).mockResolvedValue(undefined);

      await program.parseAsync(['node', 'test', 'cert', 'delete', 'cert-123', '--force']);

      expect(apiDelete).toHaveBeenCalledWith('/v1/certificates/cert-123');
      expect(consoleSpy).toHaveBeenCalledWith('Certificate deleted successfully');
    });

    it('should handle delete errors', async () => {
      const { apiDelete } = await import('../../src/lib/mode.js');
      const { error } = await import('../../src/lib/output.js');

      vi.mocked(apiDelete).mockRejectedValue(new Error('Certificate not found'));

      await expect(
        program.parseAsync(['node', 'test', 'cert', 'delete', 'cert-123', '--force'])
      ).rejects.toThrow('process.exit called');

      expect(error).toHaveBeenCalledWith('Certificate not found');
    });
  });
});
