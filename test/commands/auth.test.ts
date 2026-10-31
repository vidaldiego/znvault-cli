// Path: znvault-cli/test/commands/auth.test.ts

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Command } from 'commander';

// Mock dependencies
// Mock React and Ink for ProfileManager
vi.mock('react', () => ({
  default: { createElement: vi.fn() },
}));

vi.mock('ink', () => ({
  render: vi.fn(() => ({
    waitUntilExit: vi.fn().mockResolvedValue(undefined),
  })),
}));

vi.mock('../../src/tui/ProfileManager.js', () => ({
  ProfileManager: vi.fn(),
}));

vi.mock('../../src/lib/prompts.js', () => ({
  promptUsername: vi.fn().mockResolvedValue('admin'),
  promptPassword: vi.fn().mockResolvedValue('password'),
  promptTotp: vi.fn().mockResolvedValue(undefined),
  promptSelect: vi.fn().mockResolvedValue('default'),
}));

vi.mock('../../src/lib/client.js', () => ({
  client: {
    login: vi.fn().mockResolvedValue({
      accessToken: 'mock-token',
      refreshToken: 'mock-refresh',
      expiresIn: 3600,
      user: { id: '123', username: 'admin', role: 'superadmin', tenantId: null },
    }),
    get: vi.fn().mockResolvedValue({
      authMethod: 'jwt',
      user: {
        id: '123',
        username: 'admin',
        role: 'superadmin',
        tenantId: 'zincapp',
      },
    }),
    getBaseUrl: vi.fn().mockReturnValue('https://vault.example.com/ignored/path'),
    getTlsSpkiSha256: vi.fn().mockReturnValue('a'.repeat(64)),
    configure: vi.fn(),
    post: vi.fn().mockResolvedValue({}),
  },
}));

vi.mock('../../src/lib/config.js', async () => ({
  ...(await vi.importActual<typeof import('../../src/lib/config.js')>('../../src/lib/config.js')),
  getCredentials: vi.fn().mockReturnValue({
    userId: '123',
    username: 'admin',
    role: 'superadmin',
    tenantId: null,
    expiresAt: Date.now() + 3600000,
  }),
  clearCredentials: vi.fn(),
  clearApiKey: vi.fn(),
  setConfigValue: vi.fn(),
  getAllConfig: vi.fn().mockReturnValue({
    url: 'https://localhost:8443',
    insecure: false,
    timeout: 30000,
  }),
  getConfigPath: vi.fn().mockReturnValue('/path/to/config'),
  getStoredApiKey: vi.fn().mockReturnValue(null),
  getActiveProfileName: vi.fn().mockReturnValue('default'),
  saveCredentials: vi.fn(),
  listProfiles: vi.fn().mockReturnValue([{ name: 'default', isActive: true }]),
  createProfile: vi.fn(),
  deleteProfile: vi.fn(),
  switchProfile: vi.fn(),
  renameProfile: vi.fn(),
  getProfile: vi.fn().mockReturnValue({url:'https://localhost:8443',insecure:false,timeout:30000,authGeneration:'fixture-generation'}),
  DEFAULT_PROFILE: 'default',
  getConfig: vi.fn().mockReturnValue({ url: 'https://localhost:8443', insecure: false, timeout: 30000 }),
}));

vi.mock('../../src/lib/output.js', () => ({
  spinner: vi.fn(() => ({ start: vi.fn().mockReturnThis(), stop: vi.fn().mockReturnThis(), succeed: vi.fn().mockReturnThis(), fail: vi.fn().mockReturnThis(), warn: vi.fn().mockReturnThis(), info: vi.fn().mockReturnThis(), text: '', isSpinning: false })),
  success: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  keyValue: vi.fn(),
  json: vi.fn(),
}));

vi.mock('../../src/lib/web-login.js', () => ({
  isWebLoginSupported: vi.fn().mockReturnValue(true),
  webLogin: vi.fn().mockResolvedValue({
    success: true,
    user: { id: '123', username: 'admin', role: 'superadmin', tenantId: null },
  }),
}));
vi.mock('../../src/lib/qr-login-presentation.js', () => ({
  terminalCliRecovery: vi.fn().mockResolvedValue({success: true, user: {id: '123', username: 'admin', role: 'superadmin', tenantId: null, mfaVerified: true}}),
  terminalQrLogin: vi.fn().mockResolvedValue({
    success: true, user: {id: '123', username: 'admin', role: 'superadmin', tenantId: null, mfaVerified: true},
  }),
}));

vi.mock('../../src/lib/cli-recovery.js', async () => ({
  ...(await vi.importActual<typeof import('../../src/lib/cli-recovery.js')>('../../src/lib/cli-recovery.js')),
  coordinateCliRecovery: vi.fn(async (peer, present) => {await present(peer);return {profileName:'default',authGeneration:'fixture-generation',grantId:'fixture-grant',expiresAtSec:2000000000};}),
}));

describe('auth commands', () => {
  let program: Command;
  let consoleSpy: ReturnType<typeof vi.spyOn>;
  const tty = [process.stdin, process.stdout].map(s => Object.getOwnPropertyDescriptor(s, 'isTTY'));

  beforeEach(async () => {
    program = new Command();
    program.exitOverride();
    for (const stream of [process.stdin, process.stdout]) Object.defineProperty(stream, 'isTTY', {configurable: true, value: true});

    const { registerAuthCommands } = await import('../../src/commands/auth.js');
    registerAuthCommands(program);

    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleSpy.mockRestore();
    vi.clearAllMocks();
    process.exitCode = undefined;
    [process.stdin, process.stdout].forEach((stream, index) => {
      if (tty[index]) Object.defineProperty(stream, 'isTTY', tty[index]!);else Reflect.deleteProperty(stream, 'isTTY');
    });
  });

  describe('login', () => {
    it('uses explicit recovery without a browser, QR or password login', async () => {
      const {terminalCliRecovery,terminalQrLogin} = await import('../../src/lib/qr-login-presentation.js');
      const {webLogin} = await import('../../src/lib/web-login.js');const {client} = await import('../../src/lib/client.js');
      await program.parseAsync(['node','test','login','--recover']);
      expect(terminalCliRecovery).toHaveBeenCalledExactlyOnceWith(client);
      expect(terminalQrLogin).not.toHaveBeenCalled();expect(webLogin).not.toHaveBeenCalled();expect(client.login).not.toHaveBeenCalled();
    });
    it('allows explicit recovery with JSON in a nonTTY agent invocation', async () => {
      for (const stream of [process.stdin,process.stdout]) Object.defineProperty(stream,'isTTY',{configurable:true,value:false});
      const output = await import('../../src/lib/output.js');
      await program.parseAsync(['node','test','login','--recover','--json']);
      expect(output.json).toHaveBeenCalledWith(expect.objectContaining({success:true,user:expect.objectContaining({id:'123'})}));
    });
    it('does not report a replacement login as the completed recovery', async () => {
      const config = await import('../../src/lib/config.js'), recovery = await import('../../src/lib/cli-recovery.js');
      const initial = vi.mocked(config.getProfile).getMockImplementation()!;
      vi.mocked(recovery.coordinateCliRecovery).mockImplementationOnce(async () => {
        vi.mocked(config.getProfile).mockReturnValue({url:'https://localhost:8443',insecure:false,timeout:30000,authGeneration:'unrelated-generation'});
        return {profileName:'default',authGeneration:'fixture-generation',grantId:'fixture-grant',expiresAtSec:2000000000,origin:'https://localhost:8443'};
      });
      const exit = vi.spyOn(process,'exit').mockImplementation(() => {throw new Error('Expected failure');});
      try {
        await expect(program.parseAsync(['node','test','login','--recover','--json'])).rejects.toThrow('Expected failure');
        const output = await import('../../src/lib/output.js');
        expect(output.json).toHaveBeenCalledWith(expect.objectContaining({success:false,error:expect.stringMatching(/session changed/)}));
      } finally {exit.mockRestore();vi.mocked(config.getProfile).mockImplementation(initial);}
    });
    it('offers terminal QR login alongside existing methods', () => {
      const login = program.commands.find(command => command.name() === 'login');
      expect(login?.options.some(option => option.long === '--qr')).toBe(true);
      expect(login?.options.some(option => option.long === '--remember-iphone')).toBe(true);
      expect(login?.options.some(option => option.long === '--recover')).toBe(true);
    });
    it('requires an explicit QR method for remembering the iPhone', async () => {
      await expect(program.parseAsync(['node', 'test', 'login', '--remember-iphone']))
        .rejects.toThrow(/requires --qr/);
      const {client} = await import('../../src/lib/client.js');
      expect(client.login).not.toHaveBeenCalled();
    });
    it.each(['--web', '--qr', '--username', '--password', '--password-file', '--totp', '--remember-iphone'])('rejects recovery combined with %s', async option => {
      const args = ['node', 'test', 'login', '--recover', option];
      if (['--username', '--password', '--password-file', '--totp'].includes(option)) args.push('fixture');
      await expect(program.parseAsync(args)).rejects.toMatchObject({code: 'commander.conflictingOption'});
    });
    it('uses the existing client for terminal QR login without opening the browser', async () => {
      const {client} = await import('../../src/lib/client.js');
      const {terminalQrLogin} = await import('../../src/lib/qr-login-presentation.js');
      const {webLogin} = await import('../../src/lib/web-login.js');
      await program.parseAsync(['node', 'test', 'login', '--qr']);
      expect(terminalQrLogin).toHaveBeenCalledWith(client);
      expect(webLogin).not.toHaveBeenCalled();
      expect(client.login).not.toHaveBeenCalled();
    });
    it.each(['--web', '--json', '--username', '--password', '--password-file', '--totp'])('rejects QR combined with %s', async option => {
      const {terminalQrLogin} = await import('../../src/lib/qr-login-presentation.js');
      const args = ['node', 'test', 'login', '--qr', option];
      if (!['--web', '--json'].includes(option)) args.push('fixture');
      await expect(program.parseAsync(args)).rejects.toMatchObject({code: 'commander.conflictingOption'});
      expect(terminalQrLogin).not.toHaveBeenCalled();
    });
    it('should call client.login with provided credentials', async () => {
      const { client } = await import('../../src/lib/client.js');

      await program.parseAsync(['node', 'test', 'login', '-u', 'admin', '-p', 'password']);

      expect(client.login).toHaveBeenCalledWith('admin', 'password', undefined, expect.any(Function));
    });

    it('passes the effective global URL to browser login', async () => {
      const { webLogin } = await import('../../src/lib/web-login.js');

      await program.parseAsync(['node', 'test', 'login', '--web']);

      expect(webLogin).toHaveBeenCalledWith('https://vault.example.com/ignored/path');
    });
  });

  it.each(['delete-default','rename-existing'])('does not retire a session for an impossible profile operation: %s', async kind => {
    const recovery = await import('../../src/lib/cli-recovery.js');const cfg = await import('../../src/lib/config.js');
    const retire = vi.spyOn(recovery,'retireStoredCliRecovery').mockResolvedValue(undefined);
    const exit = vi.spyOn(process,'exit').mockImplementation(() => {throw new Error('fixture exit');});
    vi.mocked(cfg.getProfile).mockImplementation(() => ({url:'https://vault.example.test',insecure:false,timeout:1000}));
    const mutation = kind === 'delete-default' ? vi.mocked(cfg.deleteProfile) : vi.mocked(cfg.renameProfile);
    mutation.mockImplementationOnce(() => {throw new Error('invalid profile operation');});
    try {
      const args = kind === 'delete-default' ? ['profile','delete','default','--force'] : ['profile','rename','remembered','existing'];
      await expect(program.parseAsync(['node','test',...args])).rejects.toThrow('fixture exit');
      expect(retire).not.toHaveBeenCalled();
    } finally {
      retire.mockRestore();exit.mockRestore();vi.mocked(cfg.getProfile).mockReturnValue({url:'https://localhost:8443',insecure:false,timeout:30000});
      mutation.mockReset();
    }
  });
  it('does not retire a recovery binding when its URL is set to the same value', async () => {
    const recovery = await import('../../src/lib/cli-recovery.js');const cfg = await import('../../src/lib/config.js');
    const retire = vi.spyOn(recovery,'retireStoredCliRecovery').mockResolvedValue(undefined);
    vi.mocked(cfg.getProfile).mockReturnValue({url:'https://vault.example.test',insecure:false,timeout:1000});
    try {
      await program.parseAsync(['node','test','config','set','url','https://vault.example.test']);
      expect(retire).not.toHaveBeenCalled();
    } finally {retire.mockRestore();vi.mocked(cfg.getProfile).mockReturnValue({url:'https://localhost:8443',insecure:false,timeout:30000});}
  });

  describe('logout', () => {
    it('retires a remembered grant even after normal credentials expire without attempting token refresh', async () => {
      const recovery = await import('../../src/lib/cli-recovery.js');const cfg = await import('../../src/lib/config.js');
      const {client} = await import('../../src/lib/client.js');
      const retire = vi.spyOn(recovery,'retireStoredCliRecovery').mockResolvedValue(undefined);
      vi.mocked(cfg.getCredentials).mockReturnValueOnce({accessToken:'public-expired',refreshToken:'public-expired-refresh',expiresAt:1,
        userId:'fixture',username:'fixture/alice',role:'user',tenantId:'fixture'});
      vi.mocked(cfg.getProfile).mockReturnValueOnce({url:'https://vault.example.test',insecure:false,timeout:1000,
        cliRecovery:{state:'active',grantId:'11111111-1111-4111-8111-111111111111',credential:'A'.repeat(43),origin:'https://vault.example.test',expiresAtSec:2000000000}});
      try {
        await program.parseAsync(['node','test','logout']);
        expect(retire).toHaveBeenCalledExactlyOnceWith('default');expect(client.post).not.toHaveBeenCalled();
        expect(cfg.clearCredentials).not.toHaveBeenCalled();
      } finally {retire.mockRestore();}
    });
    it('should clear credentials', async () => {
      const { client } = await import('../../src/lib/client.js');
      const { clearCredentials } = await import('../../src/lib/config.js');
      const { success } = await import('../../src/lib/output.js');

      await program.parseAsync(['node', 'test', 'logout']);

      expect(client.post).toHaveBeenCalledWith('/auth/logout', {});
      expect(clearCredentials).toHaveBeenCalled();
      expect(success).toHaveBeenCalledWith('Logged out successfully (profile: default)');
    });

    it('revokes every server session with --all', async () => {
      const { client } = await import('../../src/lib/client.js');

      await program.parseAsync(['node', 'test', 'logout', '--all']);

      expect(client.post).toHaveBeenCalledWith('/auth/logout-all', {});
    });

    it('still clears local credentials when server revocation fails', async () => {
      const { client } = await import('../../src/lib/client.js');
      const { clearCredentials } = await import('../../src/lib/config.js');
      const { error } = await import('../../src/lib/output.js');
      vi.mocked(client.post).mockRejectedValueOnce(new Error('server unavailable'));

      await program.parseAsync(['node', 'test', 'logout']);

      expect(clearCredentials).toHaveBeenCalled();
      expect(error).toHaveBeenCalledWith(expect.stringContaining('server revocation failed'));
      expect(process.exitCode).toBe(1);
    });
  });

  describe('whoami', () => {
    it('should display current user info', async () => {
      const { keyValue } = await import('../../src/lib/output.js');

      await program.parseAsync(['node', 'test', 'whoami']);

      expect(keyValue).toHaveBeenCalled();
    });

    it('should output JSON when --json flag is used', async () => {
      const { json } = await import('../../src/lib/output.js');

      await program.parseAsync(['node', 'test', 'whoami', '--json']);

      expect(json).toHaveBeenCalled();
    });

    it('labels the access-token expiry as accessTokenExpires, not sessionExpires', async () => {
      const { json } = await import('../../src/lib/output.js');

      await program.parseAsync(['node', 'test', 'whoami', '--json']);

      expect(json).toHaveBeenCalled();
      const callArgs = (json as ReturnType<typeof vi.fn>).mock.calls[0]?.[0];
      expect(callArgs).toHaveProperty('accessTokenExpires');
      expect(callArgs).not.toHaveProperty('sessionExpires');
    });

    it('can verify the exact current identity with the server', async () => {
      const { client } = await import('../../src/lib/client.js');
      const { json } = await import('../../src/lib/output.js');

      await program.parseAsync(['node', 'test', 'whoami', '--server', '--json']);

      expect(client.get).toHaveBeenCalledWith('/auth/me');
      expect(json).toHaveBeenCalledWith({
        authMethod: 'jwt',
        profile: 'default',
        role: 'superadmin',
        serverOrigin: 'https://vault.example.com',
        serverVerified: true,
        tenantId: 'zincapp',
        tlsSpkiSha256: 'a'.repeat(64),
        userId: '123',
        username: 'admin',
      });
    });
  });

  describe('config', () => {
    it('should set config value', async () => {
      const { setConfigValue } = await import('../../src/lib/config.js');
      const { success } = await import('../../src/lib/output.js');

      await program.parseAsync(['node', 'test', 'config', 'set', 'url', 'https://example.com']);

      expect(setConfigValue).toHaveBeenCalledWith('url', 'https://example.com');
      expect(success).toHaveBeenCalled();
    });

    it('should get all config values', async () => {
      const { keyValue } = await import('../../src/lib/output.js');

      await program.parseAsync(['node', 'test', 'config', 'get']);

      expect(keyValue).toHaveBeenCalled();
    });

    it('should show config path', async () => {
      await program.parseAsync(['node', 'test', 'config', 'path']);

      expect(consoleSpy).toHaveBeenCalledWith('/path/to/config');
    });
  });
});
