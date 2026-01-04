// Path: znvault-cli/test/commands/notification.test.ts

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
    prompt: vi.fn().mockResolvedValue({
      confirm: true,
      testNow: false,
      host: 'smtp.example.com',
      port: 587,
      secure: true,
      user: 'user@example.com',
      password: 'password123',
      from: 'noreply@example.com',
      fromName: 'ZN-Vault',
    }),
  },
}));

const mockStatus = {
  configured: true,
  message: 'SMTP is configured and ready',
};

const mockConfig = {
  config: {
    host: 'smtp.example.com',
    port: 587,
    secure: true,
    auth: {
      user: 'user@example.com',
      pass: '********',
    },
    from: 'noreply@example.com',
    fromName: 'ZN-Vault',
  },
};

const mockRecipients = {
  recipients: 'admin@example.com,ops@example.com',
};

vi.mock('../../src/lib/client.js', () => ({
  client: {
    get: vi.fn().mockImplementation((path: string) => {
      if (path.includes('/status')) return Promise.resolve(mockStatus);
      if (path.includes('/config')) return Promise.resolve(mockConfig);
      if (path.includes('/recipients')) return Promise.resolve(mockRecipients);
      return Promise.resolve(mockStatus);
    }),
    post: vi.fn().mockResolvedValue({ message: 'Test email sent successfully' }),
    patch: vi.fn().mockResolvedValue({ message: 'Configuration saved', configured: true }),
    delete: vi.fn().mockResolvedValue({ message: 'Configuration removed', configured: false }),
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

describe('notification commands', () => {
  let program: Command;
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    program = new Command();
    program.exitOverride();

    const { registerNotificationCommands } = await import('../../src/commands/notification.js');
    registerNotificationCommands(program);

    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleSpy.mockRestore();
    vi.clearAllMocks();
  });

  describe('notification status', () => {
    it('should show notification status', async () => {
      const { client } = await import('../../src/lib/client.js');
      const { success } = await import('../../src/lib/output.js');

      await program.parseAsync(['node', 'test', 'notification', 'status']);

      expect(client.get).toHaveBeenCalledWith('/v1/admin/notifications/status');
      expect(success).toHaveBeenCalledWith('Email notifications are configured');
    });

    it('should output JSON when --json flag is used', async () => {
      const { json } = await import('../../src/lib/output.js');

      await program.parseAsync(['node', 'test', 'notification', 'status', '--json']);

      expect(json).toHaveBeenCalledWith(mockStatus);
    });
  });

  describe('notification config', () => {
    it('should show SMTP configuration', async () => {
      const { client } = await import('../../src/lib/client.js');

      await program.parseAsync(['node', 'test', 'notification', 'config']);

      expect(client.get).toHaveBeenCalledWith('/v1/admin/notifications/config');
    });

    it('should output JSON when --json flag is used', async () => {
      const { json } = await import('../../src/lib/output.js');

      await program.parseAsync(['node', 'test', 'notification', 'config', '--json']);

      expect(json).toHaveBeenCalledWith(mockConfig.config);
    });
  });

  describe('notification setup', () => {
    it('should setup SMTP configuration with options', async () => {
      const { client } = await import('../../src/lib/client.js');
      const { success } = await import('../../src/lib/output.js');

      await program.parseAsync([
        'node', 'test', 'notification', 'setup',
        '--host', 'smtp.test.com',
        '--port', '465',
        '--secure',
        '--user', 'test@test.com',
        '--password', 'testpass',
        '--from', 'noreply@test.com',
        '--from-name', 'Test System',
      ]);

      expect(client.patch).toHaveBeenCalledWith('/v1/admin/notifications/config', expect.objectContaining({
        host: 'smtp.test.com',
        port: 465,
        secure: true,
        auth: { user: 'test@test.com', pass: 'testpass' },
        from: 'noreply@test.com',
        fromName: 'Test System',
      }));
      expect(success).toHaveBeenCalledWith('SMTP configuration saved successfully!');
    });
  });

  describe('notification test', () => {
    it('should send test email', async () => {
      const { client } = await import('../../src/lib/client.js');
      const { success } = await import('../../src/lib/output.js');

      await program.parseAsync(['node', 'test', 'notification', 'test']);

      expect(client.post).toHaveBeenCalledWith('/v1/admin/notifications/test', {});
      expect(success).toHaveBeenCalledWith('Test email sent successfully');
    });

    it('should send test to specific email', async () => {
      const { client } = await import('../../src/lib/client.js');

      await program.parseAsync(['node', 'test', 'notification', 'test', '--email', 'test@example.com']);

      expect(client.post).toHaveBeenCalledWith('/v1/admin/notifications/test', { to: 'test@example.com' });
    });
  });

  describe('notification remove', () => {
    it('should remove SMTP configuration', async () => {
      const { client } = await import('../../src/lib/client.js');
      const { success } = await import('../../src/lib/output.js');

      await program.parseAsync(['node', 'test', 'notification', 'remove']);

      expect(client.delete).toHaveBeenCalledWith('/v1/admin/notifications/config');
      expect(success).toHaveBeenCalledWith('Configuration removed');
    });
  });

  describe('notification recipients', () => {
    it('should show notification recipients', async () => {
      const { client } = await import('../../src/lib/client.js');

      await program.parseAsync(['node', 'test', 'notification', 'recipients']);

      expect(client.get).toHaveBeenCalledWith('/v1/admin/notifications/recipients');
    });

    it('should output JSON when --json flag is used', async () => {
      const { json } = await import('../../src/lib/output.js');

      await program.parseAsync(['node', 'test', 'notification', 'recipients', '--json']);

      expect(json).toHaveBeenCalledWith(mockRecipients);
    });
  });

  describe('notification set-recipients', () => {
    it('should set notification recipients', async () => {
      const { client } = await import('../../src/lib/client.js');
      const { success } = await import('../../src/lib/output.js');

      await program.parseAsync([
        'node', 'test', 'notification', 'set-recipients',
        'admin@test.com,ops@test.com',
      ]);

      expect(client.patch).toHaveBeenCalledWith('/v1/admin/notifications/recipients', {
        recipients: 'admin@test.com,ops@test.com',
      });
      expect(success).toHaveBeenCalled();
    });
  });

  describe('notification add-recipient', () => {
    it('should add a recipient', async () => {
      const { client } = await import('../../src/lib/client.js');
      const { success } = await import('../../src/lib/output.js');

      await program.parseAsync(['node', 'test', 'notification', 'add-recipient', 'new@example.com']);

      expect(client.get).toHaveBeenCalledWith('/v1/admin/notifications/recipients');
      expect(client.patch).toHaveBeenCalledWith('/v1/admin/notifications/recipients', expect.objectContaining({
        recipients: expect.stringContaining('new@example.com'),
      }));
      expect(success).toHaveBeenCalledWith('Added new@example.com to notification recipients');
    });
  });

  describe('notification remove-recipient', () => {
    it('should remove a recipient', async () => {
      const { client } = await import('../../src/lib/client.js');
      const { success } = await import('../../src/lib/output.js');

      await program.parseAsync(['node', 'test', 'notification', 'remove-recipient', 'admin@example.com']);

      expect(client.get).toHaveBeenCalledWith('/v1/admin/notifications/recipients');
      expect(client.patch).toHaveBeenCalledWith('/v1/admin/notifications/recipients', expect.objectContaining({
        recipients: expect.not.stringContaining('admin@example.com'),
      }));
      expect(success).toHaveBeenCalledWith('Removed admin@example.com from notification recipients');
    });
  });
});
