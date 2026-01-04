// Path: znvault-cli/test/commands/audit.test.ts

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Command } from 'commander';

// Mock dependencies
vi.mock('ora', () => ({
  default: () => ({
    start: () => ({ stop: vi.fn(), succeed: vi.fn(), fail: vi.fn() }),
  }),
}));

vi.mock('node:fs', () => ({
  default: {
    writeFileSync: vi.fn(),
  },
  writeFileSync: vi.fn(),
}));

const mockAuditEntries = [
  { id: 'audit-1', action: 'SECRET_READ', ts: new Date().toISOString(), clientCn: 'alice', resource: 'secret-1', statusCode: 200, ip: '192.168.1.1' },
  { id: 'audit-2', action: 'SECRET_CREATE', ts: new Date().toISOString(), clientCn: 'bob', resource: 'secret-2', statusCode: 201, ip: '192.168.1.2' },
];

const mockVerifyResult = { valid: true, totalEntries: 100, verifiedEntries: 100 };

// Mock mode.js - this is what the commands actually use
vi.mock('../../src/lib/mode.js', () => ({
  getMode: vi.fn().mockReturnValue('api'),
  getModeDescription: vi.fn().mockReturnValue('API mode - using API key'),
  listAudit: vi.fn().mockResolvedValue(mockAuditEntries),
  verifyAuditChain: vi.fn().mockResolvedValue(mockVerifyResult),
  closeLocalClient: vi.fn().mockResolvedValue(undefined),
}));

// Mock client.js for API-only operations
vi.mock('../../src/lib/client.js', () => ({
  client: {
    exportAudit: vi.fn().mockResolvedValue(mockAuditEntries),
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
  keyValue: vi.fn(),
  json: vi.fn(),
  table: vi.fn(),
  section: vi.fn(),
  formatRelativeTime: vi.fn().mockReturnValue('1m ago'),
  formatBool: vi.fn().mockImplementation(b => b ? 'yes' : 'no'),
}));

describe('audit commands', () => {
  let program: Command;

  beforeEach(async () => {
    program = new Command();
    program.exitOverride();

    const { registerAuditCommands } = await import('../../src/commands/audit.js');
    registerAuditCommands(program);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('audit list', () => {
    it('should list audit entries', async () => {
      const mode = await import('../../src/lib/mode.js');
      const { table, info } = await import('../../src/lib/output.js');

      await program.parseAsync(['node', 'test', 'audit', 'list']);

      // startDate is calculated from days (default 7), so we check call structure
      expect(mode.listAudit).toHaveBeenCalledWith(
        expect.objectContaining({
          user: undefined,
          action: undefined,
          limit: 100,
          startDate: expect.any(String), // ISO date string calculated from days
        })
      );
      expect(table).toHaveBeenCalled();
    });

    it('should filter by user', async () => {
      const mode = await import('../../src/lib/mode.js');

      await program.parseAsync(['node', 'test', 'audit', 'list', '--user', 'alice']);

      expect(mode.listAudit).toHaveBeenCalledWith(
        expect.objectContaining({
          user: 'alice',
          action: undefined,
          limit: 100,
        })
      );
    });

    it('should filter by action', async () => {
      const mode = await import('../../src/lib/mode.js');

      await program.parseAsync(['node', 'test', 'audit', 'list', '--action', 'SECRET_READ']);

      expect(mode.listAudit).toHaveBeenCalledWith(
        expect.objectContaining({
          user: undefined,
          action: 'SECRET_READ',
          limit: 100,
        })
      );
    });

    it('should respect --limit flag', async () => {
      const mode = await import('../../src/lib/mode.js');

      await program.parseAsync(['node', 'test', 'audit', 'list', '--limit', '50']);

      expect(mode.listAudit).toHaveBeenCalledWith(
        expect.objectContaining({
          limit: 50,
        })
      );
    });

    it('should output JSON when --json flag is used', async () => {
      const { json } = await import('../../src/lib/output.js');

      await program.parseAsync(['node', 'test', 'audit', 'list', '--json']);

      expect(json).toHaveBeenCalled();
    });
  });

  describe('audit verify', () => {
    it('should verify audit chain', async () => {
      const mode = await import('../../src/lib/mode.js');
      const { success, keyValue } = await import('../../src/lib/output.js');

      await program.parseAsync(['node', 'test', 'audit', 'verify']);

      expect(mode.verifyAuditChain).toHaveBeenCalled();
      expect(success).toHaveBeenCalled();
      expect(keyValue).toHaveBeenCalled();
    });

    it('should output JSON when --json flag is used', async () => {
      const { json } = await import('../../src/lib/output.js');

      await program.parseAsync(['node', 'test', 'audit', 'verify', '--json']);

      expect(json).toHaveBeenCalled();
    });
  });

  describe('audit export', () => {
    it('should export audit to JSON by default', async () => {
      const { client } = await import('../../src/lib/client.js');
      const { success } = await import('../../src/lib/output.js');
      const fs = await import('node:fs');

      await program.parseAsync(['node', 'test', 'audit', 'export', '--output', '/tmp/audit.json']);

      expect(client.exportAudit).toHaveBeenCalledWith(
        expect.objectContaining({
          format: 'json',
          startDate: expect.any(String), // ISO date string calculated from days (default 30)
        })
      );
      expect(fs.default.writeFileSync).toHaveBeenCalledWith(
        '/tmp/audit.json',
        expect.any(String)
      );
      expect(success).toHaveBeenCalled();
    });

    it('should export audit to CSV', async () => {
      const { client } = await import('../../src/lib/client.js');
      const fs = await import('node:fs');

      await program.parseAsync(['node', 'test', 'audit', 'export', '--format', 'csv', '--output', '/tmp/audit.csv']);

      expect(client.exportAudit).toHaveBeenCalledWith(
        expect.objectContaining({
          format: 'csv',
          startDate: expect.any(String),
        })
      );
      expect(fs.default.writeFileSync).toHaveBeenCalled();
    });
  });
});
