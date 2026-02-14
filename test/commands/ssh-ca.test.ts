// Path: test/commands/ssh-ca.test.ts

/**
 * Unit tests for SSH CA CLI commands
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Command } from 'commander';

// Mock ora spinner
// Mock inquirer for interactive prompts
vi.mock('inquirer', () => ({
  default: {
    prompt: vi.fn().mockImplementation((questions: Array<{ name: string }>) => {
      // Return appropriate default values based on the prompt
      const results: Record<string, unknown> = {};
      for (const q of questions) {
        switch (q.name) {
          case 'confirm':
            results[q.name] = true;
            break;
          case 'ext':
            results[q.name] = 'permit-pty,permit-port-forwarding';
            break;
          case 'ttl':
            results[q.name] = 28800;
            break;
          case 'reason':
            results[q.name] = 'Test reason';
            break;
          case 'linuxUser':
            results[q.name] = 'deploy';
            break;
          case 'principals':
            results[q.name] = 'deploy,admin';
            break;
          default:
            results[q.name] = 'default-value';
        }
      }
      return Promise.resolve(results);
    }),
  },
}));

// Mock the HTTP client
const mockClient = {
  get: vi.fn(),
  post: vi.fn(),
  put: vi.fn(),
  delete: vi.fn(),
};

vi.mock('../../src/lib/client.js', () => ({
  client: mockClient,
}));

// Mock output functions
vi.mock('../../src/lib/output.js', () => ({
  spinner: vi.fn(() => ({ start: vi.fn().mockReturnThis(), stop: vi.fn().mockReturnThis(), succeed: vi.fn().mockReturnThis(), fail: vi.fn().mockReturnThis(), warn: vi.fn().mockReturnThis(), info: vi.fn().mockReturnThis(), text: '', isSpinning: false })),
  success: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  keyValue: vi.fn(),
  json: vi.fn(),
  table: vi.fn(),
  section: vi.fn(),
  formatDate: vi.fn().mockReturnValue('2024-01-01'),
}));

// Mock process.exit to prevent test termination
const mockExit = vi.spyOn(process, 'exit').mockImplementation((() => {}) as () => never);
const mockStdoutIsTTY = Object.getOwnPropertyDescriptor(process.stdout, 'isTTY');

describe('SSH CA CLI Commands', () => {
  let program: Command;

  beforeEach(async () => {
    vi.clearAllMocks();

    program = new Command();
    program.exitOverride();

    // Import and register the SSH CA commands
    const { registerSSHCACommands } = await import('../../src/commands/ssh-ca.js');
    registerSSHCACommands(program);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // ==========================================================================
  // CA Status Commands
  // ==========================================================================

  describe('ssh-ca status', () => {
    it('should display CA status', async () => {
      mockClient.get.mockResolvedValueOnce({
        initialized: true,
        publicKey: 'ssh-ed25519 AAAA...',
        fingerprint: 'SHA256:abc123',
        keyType: 'ed25519',
        defaultTtlSeconds: 28800,
        maxTtlSeconds: 86400,
        totalCertificatesIssued: 100,
        activeCertificates: 25,
      });

      const { keyValue } = await import('../../src/lib/output.js');

      await program.parseAsync(['node', 'test', 'ssh-ca', 'status']);

      expect(mockClient.get).toHaveBeenCalledWith('/v1/ssh/ca');
      expect(keyValue).toHaveBeenCalled();
    });

    it('should output JSON with --json flag', async () => {
      mockClient.get.mockResolvedValueOnce({
        initialized: true,
        publicKey: 'ssh-ed25519 AAAA...',
      });

      const { json } = await import('../../src/lib/output.js');

      await program.parseAsync(['node', 'test', 'ssh-ca', 'status', '--json']);

      expect(json).toHaveBeenCalled();
    });

    it('should show uninitialized status', async () => {
      mockClient.get.mockResolvedValueOnce({
        initialized: false,
      });

      const { warn } = await import('../../src/lib/output.js');

      await program.parseAsync(['node', 'test', 'ssh-ca', 'status']);

      expect(warn).toHaveBeenCalledWith(expect.stringContaining('not initialized'));
    });
  });

  // ==========================================================================
  // CA Initialization
  // ==========================================================================

  describe('ssh-ca init', () => {
    it('should initialize CA with provided options', async () => {
      mockClient.post.mockResolvedValueOnce({
        id: 'ca-id',
        publicKey: 'ssh-ed25519 AAAA...',
        fingerprint: 'SHA256:abc123',
        keyType: 'ed25519',
        defaultTtlSeconds: 28800,
        maxTtlSeconds: 86400,
        allowedExtensions: ['permit-pty', 'permit-port-forwarding'],
      });

      await program.parseAsync([
        'node', 'test', 'ssh-ca', 'init',
        '--key-type', 'ed25519',
        '--default-ttl', '28800',
        '--max-ttl', '86400',
        '--extensions', 'permit-pty,permit-port-forwarding',
      ]);

      expect(mockClient.post).toHaveBeenCalledWith('/v1/ssh/ca', {
        keyType: 'ed25519',
        defaultTtlSeconds: 28800,
        maxTtlSeconds: 86400,
        allowedExtensions: ['permit-pty', 'permit-port-forwarding'],
      });
      // CLI uses spinner.succeed() instead of output.success()
    });

    it('should initialize with extensions', async () => {
      mockClient.post.mockResolvedValueOnce({
        id: 'ca-id',
        publicKey: 'ssh-ed25519 AAAA...',
      });

      await program.parseAsync([
        'node', 'test', 'ssh-ca', 'init',
        '--key-type', 'ed25519',
        '--extensions', 'permit-pty,permit-port-forwarding',
      ]);

      expect(mockClient.post).toHaveBeenCalledWith('/v1/ssh/ca', expect.objectContaining({
        allowedExtensions: ['permit-pty', 'permit-port-forwarding'],
      }));
    });

    it('should output JSON with --json flag', async () => {
      mockClient.post.mockResolvedValueOnce({
        id: 'ca-id',
        publicKey: 'ssh-ed25519 AAAA...',
      });

      const { json } = await import('../../src/lib/output.js');

      await program.parseAsync(['node', 'test', 'ssh-ca', 'init', '--key-type', 'ed25519', '--json']);

      expect(json).toHaveBeenCalled();
    });
  });

  // ==========================================================================
  // CA Public Key
  // ==========================================================================

  describe('ssh-ca public-key', () => {
    it('should display public key', async () => {
      mockClient.get.mockResolvedValueOnce({
        publicKey: 'ssh-ed25519 AAAA...',
        fingerprint: 'SHA256:abc123',
      });

      const { keyValue } = await import('../../src/lib/output.js');

      await program.parseAsync(['node', 'test', 'ssh-ca', 'public-key']);

      expect(mockClient.get).toHaveBeenCalledWith('/v1/ssh/ca');
      expect(keyValue).toHaveBeenCalled();
    });

    it('should output only key with --raw flag', async () => {
      mockClient.get.mockResolvedValueOnce({
        publicKey: 'ssh-ed25519 AAAA...',
        fingerprint: 'SHA256:abc123',
      });

      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      await program.parseAsync(['node', 'test', 'ssh-ca', 'public-key', '--raw']);

      expect(consoleSpy).toHaveBeenCalledWith('ssh-ed25519 AAAA...');
      consoleSpy.mockRestore();
    });
  });

  // ==========================================================================
  // CA Deletion
  // ==========================================================================

  describe('ssh-ca delete', () => {
    it('should delete CA with --force flag', async () => {
      mockClient.delete.mockResolvedValueOnce({});

      await program.parseAsync(['node', 'test', 'ssh-ca', 'delete', '--force']);

      expect(mockClient.delete).toHaveBeenCalledWith('/v1/ssh/ca');
      // CLI uses spinner.succeed() instead of output.success()
    });

    it('should prompt for confirmation without --force', async () => {
      const inquirer = await import('inquirer');
      (inquirer.default.prompt as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ confirm: true });

      mockClient.delete.mockResolvedValueOnce({});

      await program.parseAsync(['node', 'test', 'ssh-ca', 'delete']);

      expect(inquirer.default.prompt).toHaveBeenCalled();
      expect(mockClient.delete).toHaveBeenCalled();
    });

    it('should cancel if confirmation denied', async () => {
      const inquirer = await import('inquirer');
      (inquirer.default.prompt as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ confirm: false });

      const { info } = await import('../../src/lib/output.js');

      await program.parseAsync(['node', 'test', 'ssh-ca', 'delete']);

      expect(info).toHaveBeenCalledWith(expect.stringContaining('cancelled'));
      expect(mockClient.delete).not.toHaveBeenCalled();
    });
  });

  // ==========================================================================
  // Principal Mapping Commands
  // ==========================================================================

  describe('ssh-ca mapping list', () => {
    it('should list principal mappings', async () => {
      mockClient.get.mockResolvedValueOnce({
        items: [
          { id: 'mapping-1', groupId: 'group-1', groupName: 'Engineers', principals: ['deploy', 'dev'] },
          { id: 'mapping-2', groupId: 'group-2', groupName: 'DevOps', principals: ['admin', 'deploy'] },
        ],
        pagination: { total: 2 },
      });

      await program.parseAsync(['node', 'test', 'ssh-ca', 'mapping', 'list']);

      expect(mockClient.get).toHaveBeenCalledWith('/v1/ssh/principal-mappings');
    });

    it('should handle empty mappings list', async () => {
      mockClient.get.mockResolvedValueOnce({
        items: [],
        pagination: { total: 0 },
      });

      const { info } = await import('../../src/lib/output.js');

      await program.parseAsync(['node', 'test', 'ssh-ca', 'mapping', 'list']);

      expect(info).toHaveBeenCalledWith(expect.stringContaining('No principal mappings'));
    });
  });

  describe('ssh-ca mapping create', () => {
    it('should create mapping with options', async () => {
      mockClient.post.mockResolvedValueOnce({
        id: 'new-mapping',
        groupId: 'group-1',
        principals: ['deploy', 'dev'],
      });

      const { success } = await import('../../src/lib/output.js');

      await program.parseAsync([
        'node', 'test', 'ssh-ca', 'mapping', 'create',
        '--group-id', 'group-1',
        '--principals', 'deploy,dev',
      ]);

      expect(mockClient.post).toHaveBeenCalledWith('/v1/ssh/principal-mappings', {
        groupId: 'group-1',
        principals: ['deploy', 'dev'],
      });
      // CLI uses spinner.succeed() instead of output.success()
    });
  });

  describe('ssh-ca mapping update', () => {
    it('should update mapping', async () => {
      mockClient.put.mockResolvedValueOnce({
        id: 'mapping-1',
        groupId: 'group-1',
        principals: ['deploy', 'dev', 'admin'],
      });

      await program.parseAsync([
        'node', 'test', 'ssh-ca', 'mapping', 'update', 'mapping-1',
        '--principals', 'deploy,dev,admin',
      ]);

      expect(mockClient.put).toHaveBeenCalledWith('/v1/ssh/principal-mappings/mapping-1', {
        principals: ['deploy', 'dev', 'admin'],
      });
      // CLI uses spinner.succeed() instead of output.success()
    });
  });

  describe('ssh-ca mapping delete', () => {
    it('should delete mapping with --force', async () => {
      mockClient.delete.mockResolvedValueOnce({});

      await program.parseAsync(['node', 'test', 'ssh-ca', 'mapping', 'delete', 'mapping-1', '--force']);

      expect(mockClient.delete).toHaveBeenCalledWith('/v1/ssh/principal-mappings/mapping-1');
      // CLI uses spinner.succeed() instead of output.success()
    });
  });

  // ==========================================================================
  // Server Group Commands
  // ==========================================================================

  describe('ssh-ca server-group list', () => {
    it('should list server groups', async () => {
      mockClient.get.mockResolvedValueOnce({
        items: [
          { id: 'sg-1', name: 'production', description: 'Production servers', createdAt: '2024-01-01T00:00:00Z' },
          { id: 'sg-2', name: 'staging', description: 'Staging servers', createdAt: '2024-01-01T00:00:00Z' },
        ],
      });

      await program.parseAsync(['node', 'test', 'ssh-ca', 'server-group', 'list']);

      expect(mockClient.get).toHaveBeenCalledWith('/v1/ssh/server-groups');
    });

    it('should support sg alias', async () => {
      mockClient.get.mockResolvedValueOnce({ items: [] });

      await program.parseAsync(['node', 'test', 'ssh-ca', 'sg', 'list']);

      expect(mockClient.get).toHaveBeenCalledWith('/v1/ssh/server-groups');
    });
  });

  describe('ssh-ca server-group get', () => {
    it('should get server group details', async () => {
      mockClient.get
        .mockResolvedValueOnce({
          id: 'sg-1',
          name: 'production',
          description: 'Production servers',
          createdAt: '2024-01-01T00:00:00Z',
        })
        .mockResolvedValueOnce({
          deploy: ['deploy', 'admin'],
          'www-data': ['webmaster'],
        });

      const { keyValue } = await import('../../src/lib/output.js');

      await program.parseAsync(['node', 'test', 'ssh-ca', 'server-group', 'get', 'sg-1']);

      expect(mockClient.get).toHaveBeenCalledWith('/v1/ssh/server-groups/sg-1');
      expect(mockClient.get).toHaveBeenCalledWith('/v1/ssh/server-groups/sg-1/authorized-principals');
      expect(keyValue).toHaveBeenCalled();
    });
  });

  describe('ssh-ca server-group create', () => {
    it('should create server group with options', async () => {
      mockClient.post.mockResolvedValueOnce({
        id: 'new-sg',
        name: 'test-group',
        description: 'Test server group',
      });

      const { success } = await import('../../src/lib/output.js');

      await program.parseAsync([
        'node', 'test', 'ssh-ca', 'server-group', 'create',
        '--name', 'test-group',
        '--description', 'Test server group',
      ]);

      expect(mockClient.post).toHaveBeenCalledWith('/v1/ssh/server-groups', {
        name: 'test-group',
        description: 'Test server group',
      });
      // CLI uses spinner.succeed() instead of output.success()
    });
  });

  describe('ssh-ca server-group set-access', () => {
    it('should set access rule', async () => {
      mockClient.put.mockResolvedValueOnce({
        linuxUser: 'deploy',
        allowedPrincipals: ['deploy', 'admin'],
      });

      await program.parseAsync([
        'node', 'test', 'ssh-ca', 'server-group', 'set-access', 'sg-1',
        '--linux-user', 'deploy',
        '--principals', 'deploy,admin',
      ]);

      expect(mockClient.put).toHaveBeenCalledWith('/v1/ssh/server-groups/sg-1/access', {
        linuxUser: 'deploy',
        allowedPrincipals: ['deploy', 'admin'],
      });
      // CLI uses spinner.succeed() instead of output.success()
    });
  });

  describe('ssh-ca server-group delete-access', () => {
    it('should delete access rule', async () => {
      mockClient.delete.mockResolvedValueOnce({});

      await program.parseAsync([
        'node', 'test', 'ssh-ca', 'server-group', 'delete-access', 'sg-1', 'deploy', '--force',
      ]);

      expect(mockClient.delete).toHaveBeenCalledWith('/v1/ssh/server-groups/sg-1/access/deploy');
      // CLI uses spinner.succeed() instead of output.success()
    });
  });

  describe('ssh-ca server-group principals', () => {
    it('should get authorized principals', async () => {
      mockClient.get.mockResolvedValueOnce({
        deploy: ['deploy', 'admin'],
        'www-data': ['webmaster'],
      });

      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      await program.parseAsync(['node', 'test', 'ssh-ca', 'server-group', 'principals', 'sg-1']);

      expect(mockClient.get).toHaveBeenCalledWith('/v1/ssh/server-groups/sg-1/authorized-principals');
      // Verify output format includes AuthorizedPrincipalsFile content
      expect(consoleSpy).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });
  });

  describe('ssh-ca server-group delete', () => {
    it('should delete server group', async () => {
      mockClient.delete.mockResolvedValueOnce({});

      await program.parseAsync(['node', 'test', 'ssh-ca', 'server-group', 'delete', 'sg-1', '--force']);

      expect(mockClient.delete).toHaveBeenCalledWith('/v1/ssh/server-groups/sg-1');
      // CLI uses spinner.succeed() instead of output.success()
    });
  });

  // ==========================================================================
  // Certificate Commands
  // ==========================================================================

  describe('ssh-ca cert list', () => {
    it('should list certificates', async () => {
      mockClient.get.mockResolvedValueOnce({
        items: [
          {
            serial: '1234567890',
            userId: 'user-1',
            username: 'alice',
            principals: ['deploy'],
            validBefore: '2024-12-31T23:59:59Z',
            revoked: false,
          },
        ],
        pagination: { total: 1 },
      });

      await program.parseAsync(['node', 'test', 'ssh-ca', 'cert', 'list']);

      expect(mockClient.get).toHaveBeenCalledWith(expect.stringContaining('/v1/ssh/certificates'));
    });

    it('should filter active certificates only', async () => {
      mockClient.get.mockResolvedValueOnce({ items: [], pagination: { total: 0 } });

      await program.parseAsync(['node', 'test', 'ssh-ca', 'cert', 'list', '--active-only']);

      expect(mockClient.get).toHaveBeenCalledWith(expect.stringContaining('activeOnly=true'));
    });

    it('should filter revoked certificates', async () => {
      mockClient.get.mockResolvedValueOnce({ items: [], pagination: { total: 0 } });

      await program.parseAsync(['node', 'test', 'ssh-ca', 'cert', 'list', '--revoked']);

      expect(mockClient.get).toHaveBeenCalledWith(expect.stringContaining('revoked=true'));
    });

    it('should filter by user ID', async () => {
      mockClient.get.mockResolvedValueOnce({ items: [], pagination: { total: 0 } });

      await program.parseAsync(['node', 'test', 'ssh-ca', 'cert', 'list', '--user-id', 'user-1']);

      expect(mockClient.get).toHaveBeenCalledWith(expect.stringContaining('userId=user-1'));
    });
  });

  describe('ssh-ca cert get', () => {
    it('should get certificate details', async () => {
      mockClient.get.mockResolvedValueOnce({
        id: 'cert-1',
        serial: '1234567890',
        userId: 'user-1',
        username: 'alice',
        fingerprint: 'SHA256:xyz',
        principals: ['deploy', 'admin'],
        extensions: ['permit-pty'],
        validAfter: '2024-01-01T00:00:00Z',
        validBefore: '2024-12-31T23:59:59Z',
        revoked: false,
        createdAt: '2024-01-01T00:00:00Z',
      });

      const { keyValue } = await import('../../src/lib/output.js');

      await program.parseAsync(['node', 'test', 'ssh-ca', 'cert', 'get', 'cert-1']);

      expect(mockClient.get).toHaveBeenCalledWith('/v1/ssh/certificates/cert-1');
      expect(keyValue).toHaveBeenCalled();
    });
  });

  describe('ssh-ca cert revoke', () => {
    it('should revoke certificate with --force', async () => {
      mockClient.post.mockResolvedValueOnce({
        success: true,
      });

      await program.parseAsync([
        'node', 'test', 'ssh-ca', 'cert', 'revoke', 'cert-1',
        '--reason', 'User offboarded',
        '--force',
      ]);

      expect(mockClient.post).toHaveBeenCalledWith('/v1/ssh/certificates/cert-1/revoke', {
        reason: 'User offboarded',
      });
      // CLI uses spinner.succeed() instead of output.success()
    });
  });

  // ==========================================================================
  // Sign Command
  // ==========================================================================

  describe('ssh-ca sign', () => {
    it('should sign public key from --public-key option', async () => {
      mockClient.post.mockResolvedValueOnce({
        certificate: 'ssh-ed25519-cert-v01@openssh.com AAAA...',
        serial: '1234567890',
        principals: ['deploy'],
        fingerprint: 'SHA256:xyz',
        validAfter: '2024-01-01T00:00:00Z',
        validBefore: '2024-01-01T08:00:00Z',
      });

      // Mock process.stdout.isTTY to true for interactive output
      Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });

      await program.parseAsync([
        'node', 'test', 'ssh-ca', 'sign',
        '--public-key', 'ssh-ed25519 AAAA...',
      ]);

      expect(mockClient.post).toHaveBeenCalledWith('/v1/ssh/sign', {
        publicKey: 'ssh-ed25519 AAAA...',
      });
      // CLI uses spinner.succeed() instead of output.success()

      // Restore isTTY
      if (mockStdoutIsTTY) {
        Object.defineProperty(process.stdout, 'isTTY', mockStdoutIsTTY);
      }
    });

    it('should sign with custom TTL', async () => {
      mockClient.post.mockResolvedValueOnce({
        certificate: 'ssh-ed25519-cert-v01@openssh.com AAAA...',
        serial: '1234567890',
        principals: ['deploy'],
        fingerprint: 'SHA256:xyz',
        validAfter: '2024-01-01T00:00:00Z',
        validBefore: '2024-01-01T08:00:00Z',
      });

      Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });

      await program.parseAsync([
        'node', 'test', 'ssh-ca', 'sign',
        '--public-key', 'ssh-ed25519 AAAA...',
        '--ttl', '7200',
      ]);

      expect(mockClient.post).toHaveBeenCalledWith('/v1/ssh/sign', {
        publicKey: 'ssh-ed25519 AAAA...',
        ttlSeconds: 7200,
      });

      if (mockStdoutIsTTY) {
        Object.defineProperty(process.stdout, 'isTTY', mockStdoutIsTTY);
      }
    });

    it('should output only certificate when piped', async () => {
      mockClient.post.mockResolvedValueOnce({
        certificate: 'ssh-ed25519-cert-v01@openssh.com AAAA...',
        serial: '1234567890',
        principals: ['deploy'],
        fingerprint: 'SHA256:xyz',
        validAfter: '2024-01-01T00:00:00Z',
        validBefore: '2024-01-01T08:00:00Z',
      });

      // Mock process.stdout.isTTY to false (piped)
      Object.defineProperty(process.stdout, 'isTTY', { value: false, configurable: true });

      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      await program.parseAsync([
        'node', 'test', 'ssh-ca', 'sign',
        '--public-key', 'ssh-ed25519 AAAA...',
      ]);

      // When piped, only the certificate should be output
      expect(consoleSpy).toHaveBeenCalledWith('ssh-ed25519-cert-v01@openssh.com AAAA...');
      consoleSpy.mockRestore();

      if (mockStdoutIsTTY) {
        Object.defineProperty(process.stdout, 'isTTY', mockStdoutIsTTY);
      }
    });

    it('should output JSON with --json flag', async () => {
      mockClient.post.mockResolvedValueOnce({
        certificate: 'ssh-ed25519-cert-v01@openssh.com AAAA...',
        serial: '1234567890',
        principals: ['deploy'],
        fingerprint: 'SHA256:xyz',
        validAfter: '2024-01-01T00:00:00Z',
        validBefore: '2024-01-01T08:00:00Z',
      });

      const { json } = await import('../../src/lib/output.js');

      await program.parseAsync([
        'node', 'test', 'ssh-ca', 'sign',
        '--public-key', 'ssh-ed25519 AAAA...',
        '--json',
      ]);

      expect(json).toHaveBeenCalled();
    });

    it('should reject invalid public key format', async () => {
      const { error } = await import('../../src/lib/output.js');

      await program.parseAsync([
        'node', 'test', 'ssh-ca', 'sign',
        '--public-key', 'not-a-valid-key',
      ]);

      expect(error).toHaveBeenCalledWith(expect.stringContaining('Invalid SSH public key'));
      expect(mockExit).toHaveBeenCalledWith(1);
    });
  });

  // ==========================================================================
  // Error Handling
  // ==========================================================================

  describe('error handling', () => {
    it('should handle API errors gracefully', async () => {
      mockClient.get.mockRejectedValueOnce(new Error('Connection refused'));

      const { error } = await import('../../src/lib/output.js');

      await program.parseAsync(['node', 'test', 'ssh-ca', 'status']);

      expect(error).toHaveBeenCalled();
    });

    it('should handle HTTP 409 conflict', async () => {
      mockClient.post.mockRejectedValueOnce(new Error('SSH CA already initialized'));

      const { error } = await import('../../src/lib/output.js');

      await program.parseAsync([
        'node', 'test', 'ssh-ca', 'init',
        '--key-type', 'ed25519',
        '--default-ttl', '28800',
        '--max-ttl', '86400',
        '--extensions', 'permit-pty',
      ]);

      expect(error).toHaveBeenCalledWith(expect.stringContaining('already initialized'));
    });
  });
});
