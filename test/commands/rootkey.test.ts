// Path: test/commands/rootkey.test.ts

/**
 * Tests for `znvault superadmin rootkey status|verify|wrap`.
 *
 * Contract highlights:
 *  - no command ever prints key material (the server never returns any;
 *    the KCV fingerprint is the only identity that appears);
 *  - `verify` exits 1 when any configured provider fails or mismatches —
 *    it is the scriptable gate the migration runbook and monitoring use;
 *  - no command can remove an envelope or the cleartext file.
 *
 * Config isolation: the global test/setup.ts mocks `conf` and sets
 * ZNVAULT_CONFIG_DIR — no vi.resetModules needed here.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Command } from 'commander';

vi.mock('cli-table3', () => ({
  default: class MockTable {
    push = vi.fn();
    toString = vi.fn().mockReturnValue('table-output');
  },
}));

vi.mock('inquirer', () => ({
  default: { prompt: vi.fn() },
}));

vi.mock('../../src/lib/client.js', () => ({
  client: {
    get: vi.fn(),
    post: vi.fn(),
    delete: vi.fn(),
  },
}));

vi.mock('../../src/lib/output.js', () => ({
  spinner: vi.fn(() => ({
    start: vi.fn().mockReturnThis(),
    stop: vi.fn().mockReturnThis(),
    succeed: vi.fn().mockReturnThis(),
    fail: vi.fn().mockReturnThis(),
    warn: vi.fn().mockReturnThis(),
    info: vi.fn().mockReturnThis(),
    text: '',
    isSpinning: false,
  })),
  json: vi.fn(),
  info: vi.fn(),
  error: vi.fn(),
  success: vi.fn(),
  warn: vi.fn(),
  keyValue: vi.fn(),
  section: vi.fn(),
  isPlainMode: vi.fn().mockReturnValue(true),
}));

import { client } from '../../src/lib/client.js';
import * as output from '../../src/lib/output.js';
import { registerSuperadminCommands } from '../../src/commands/superadmin/index.js';

function makeProgram(): Command {
  const p = new Command();
  p.exitOverride();
  registerSuperadminCommands(p);
  return p;
}

const SAMPLE_STATUS = {
  resolution: {
    resolvedAt: '2026-08-20T16:00:00.000Z',
    servedBy: 'local-file',
    kcv: 'kcv1:00112233445566778899aabbccddeeff',
    degraded: false,
    totalLatencyMs: 12,
    attempts: [
      { providerId: 'aws-kms', type: 'aws-kms', outcome: 'no_material', latencyMs: 9 },
      { providerId: 'local-file', type: 'local-file', outcome: 'served', latencyMs: 3 },
    ],
    configured: [
      { id: 'aws-kms', type: 'aws-kms', priority: 1 },
      { id: 'local-file', type: 'local-file', priority: 2 },
    ],
  },
  envelopes: [
    {
      provider_id: 'aws-kms',
      provider_type: 'aws-kms',
      key_id: 'alias/example-bsk',
      kcv: 'kcv1:00112233445566778899aabbccddeeff',
      created_at: '2026-08-20T00:00:00Z',
      updated_at: '2026-08-20T00:00:00Z',
      created_by: 'admin',
    },
  ],
  localFile: { path: '/data/lmk.bin', present: true },
};

const VERIFY_OK = {
  activeKcv: 'kcv1:00112233445566778899aabbccddeeff',
  allMatchOrEmpty: true,
  results: [
    { providerId: 'aws-kms', outcome: 'match', kcv: 'kcv1:00112233445566778899aabbccddeeff', latencyMs: 40 },
    { providerId: 'local-file', outcome: 'match', kcv: 'kcv1:00112233445566778899aabbccddeeff', latencyMs: 2 },
  ],
};

const VERIFY_BAD = {
  activeKcv: 'kcv1:00112233445566778899aabbccddeeff',
  allMatchOrEmpty: false,
  results: [
    { providerId: 'aws-kms', outcome: 'error', latencyMs: 40, error: 'KMS unreachable' },
    { providerId: 'local-file', outcome: 'match', kcv: 'kcv1:00112233445566778899aabbccddeeff', latencyMs: 2 },
  ],
};

describe('superadmin rootkey commands', () => {
  let exitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    exitSpy = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`process.exit(${String(code ?? 0)})`);
    }) as never);
  });

  afterEach(() => {
    exitSpy.mockRestore();
  });

  it('registers rootkey with status, verify and wrap subcommands', () => {
    const p = makeProgram();
    const superadmin = p.commands.find((c) => c.name() === 'superadmin');
    const rootkey = superadmin?.commands.find((c) => c.name() === 'rootkey');
    expect(rootkey).toBeDefined();
    const names = rootkey?.commands.map((c) => c.name()) ?? [];
    expect(names).toContain('status');
    expect(names).toContain('verify');
    expect(names).toContain('wrap');
    // Nothing in this group may be able to remove anything.
    expect(names.join(',')).not.toMatch(/rm|remove|delete|retire/);
  });

  describe('status', () => {
    it('GETs the status route and emits raw JSON with --json', async () => {
      vi.mocked(client.get).mockResolvedValue(SAMPLE_STATUS);
      const p = makeProgram();

      await p.parseAsync(['node', 'test', 'superadmin', 'rootkey', 'status', '--json']);

      expect(client.get).toHaveBeenCalledWith('/v1/superadmin/rootkey/status');
      expect(output.json).toHaveBeenCalledWith(SAMPLE_STATUS);
    });

    it('renders a human summary including the KCV and the degraded flag', async () => {
      vi.mocked(client.get).mockResolvedValue(SAMPLE_STATUS);
      const p = makeProgram();

      await p.parseAsync(['node', 'test', 'superadmin', 'rootkey', 'status']);

      const keyValueArg = vi.mocked(output.keyValue).mock.calls[0]?.[0] as Record<string, unknown>;
      expect(JSON.stringify(keyValueArg)).toContain('kcv1:');
      expect(JSON.stringify(keyValueArg)).toContain('local-file');
    });

    it('exits 1 on request failure', async () => {
      vi.mocked(client.get).mockRejectedValue(new Error('boom'));
      const p = makeProgram();

      await expect(
        p.parseAsync(['node', 'test', 'superadmin', 'rootkey', 'status']),
      ).rejects.toThrow('process.exit(1)');
      expect(output.error).toHaveBeenCalledWith('boom');
    });
  });

  describe('verify', () => {
    it('POSTs the verify route and succeeds when every provider matches', async () => {
      vi.mocked(client.post).mockResolvedValue(VERIFY_OK);
      const p = makeProgram();

      await p.parseAsync(['node', 'test', 'superadmin', 'rootkey', 'verify']);

      expect(client.post).toHaveBeenCalledWith('/v1/superadmin/rootkey/verify', {});
      expect(output.success).toHaveBeenCalled();
      expect(exitSpy).not.toHaveBeenCalled();
    });

    it('exits 1 when any provider fails or mismatches (the migration gate)', async () => {
      vi.mocked(client.post).mockResolvedValue(VERIFY_BAD);
      const p = makeProgram();

      await expect(
        p.parseAsync(['node', 'test', 'superadmin', 'rootkey', 'verify']),
      ).rejects.toThrow('process.exit(1)');
      const errText = vi.mocked(output.error).mock.calls.map((c) => c[0]).join(' ');
      expect(errText).toContain('aws-kms');
    });

    it('with --json emits the raw result and still exits 1 on failure', async () => {
      vi.mocked(client.post).mockResolvedValue(VERIFY_BAD);
      const p = makeProgram();

      await expect(
        p.parseAsync(['node', 'test', 'superadmin', 'rootkey', 'verify', '--json']),
      ).rejects.toThrow('process.exit(1)');
      expect(output.json).toHaveBeenCalledWith(VERIFY_BAD);
    });
  });

  describe('wrap', () => {
    it('POSTs the wrap route with the named provider and prints the receipt', async () => {
      const receipt = {
        providerId: 'aws-kms',
        keyId: 'alias/example-bsk',
        kcv: 'kcv1:00112233445566778899aabbccddeeff',
        createdAt: '2026-08-20T16:00:00.000Z',
      };
      vi.mocked(client.post).mockResolvedValue(receipt);
      const p = makeProgram();

      await p.parseAsync([
        'node', 'test', 'superadmin', 'rootkey', 'wrap', '--provider', 'aws-kms',
      ]);

      expect(client.post).toHaveBeenCalledWith('/v1/superadmin/rootkey/wrap', {
        provider: 'aws-kms',
      });
      expect(output.success).toHaveBeenCalled();
    });

    it('emits the raw receipt with --json', async () => {
      const receipt = { providerId: 'aws-kms', keyId: null, kcv: 'kcv1:aa', createdAt: 'x' };
      vi.mocked(client.post).mockResolvedValue(receipt);
      const p = makeProgram();

      await p.parseAsync([
        'node', 'test', 'superadmin', 'rootkey', 'wrap', '--provider', 'aws-kms', '--json',
      ]);

      expect(output.json).toHaveBeenCalledWith(receipt);
    });

    it('requires --provider', async () => {
      const p = makeProgram();

      await expect(
        p.parseAsync(['node', 'test', 'superadmin', 'rootkey', 'wrap']),
      ).rejects.toThrow();
      expect(client.post).not.toHaveBeenCalled();
    });

    it('exits 1 and surfaces the server refusal (e.g. cross-key envelope protection)', async () => {
      vi.mocked(client.post).mockRejectedValue(
        new Error('Refusing to overwrite the envelope: recorded under a different key'),
      );
      const p = makeProgram();

      await expect(
        p.parseAsync([
          'node', 'test', 'superadmin', 'rootkey', 'wrap', '--provider', 'aws-kms',
        ]),
      ).rejects.toThrow('process.exit(1)');
      expect(output.error).toHaveBeenCalledWith(
        'Refusing to overwrite the envelope: recorded under a different key',
      );
    });
  });
});
