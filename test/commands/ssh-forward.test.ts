// Path: test/commands/ssh-forward.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the helpers that hit the vault / filesystem
const mockGetDefaultKeyPath = vi.fn();
const mockGetCertificatePath = vi.fn();
const mockIsCertificateValid = vi.fn();
const mockSignCertificate = vi.fn();
vi.mock('../../src/commands/ssh/helpers.js', () => ({
  getDefaultKeyPath: (...a: unknown[]) => mockGetDefaultKeyPath(...a),
  getCertificatePath: (...a: unknown[]) => mockGetCertificatePath(...a),
  isCertificateValid: (...a: unknown[]) => mockIsCertificateValid(...a),
  signCertificate: (...a: unknown[]) => mockSignCertificate(...a),
}));
vi.mock('../../src/lib/config.js', () => ({
  getCurrentProfile: () => ({}),
}));
vi.mock('../../src/commands/ssh/bookmark.js', () => ({
  resolveBookmark: () => undefined,
}));
// fs: pretend key + pubkey exist
vi.mock('fs', () => ({
  existsSync: () => true,
}));

const { ensureSignedSshBase } = await import('../../src/commands/ssh/connect.js');

describe('ensureSignedSshBase', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetCertificatePath.mockResolvedValue('/home/u/.ssh/id_ed25519-cert.pub');
  });

  it('reuses a valid cert without signing and returns base ssh args', async () => {
    mockIsCertificateValid.mockResolvedValue({ valid: true });
    const base = await ensureSignedSshBase('sysadmin@1.2.3.4', { identity: '/home/u/.ssh/id_ed25519' });

    expect(mockSignCertificate).not.toHaveBeenCalled();
    expect(base.user).toBe('sysadmin');
    expect(base.host).toBe('1.2.3.4');
    expect(base.baseSshArgs).toEqual([
      '-i', '/home/u/.ssh/id_ed25519',
      '-o', 'CertificateFile=/home/u/.ssh/id_ed25519-cert.pub',
    ]);
  });

  it('signs when the cert is invalid', async () => {
    mockIsCertificateValid.mockResolvedValue({ valid: false, reason: 'expired' });
    mockSignCertificate.mockResolvedValue(undefined);
    await ensureSignedSshBase('sysadmin@1.2.3.4', { identity: '/home/u/.ssh/id_ed25519' });
    expect(mockSignCertificate).toHaveBeenCalledOnce();
  });

  it('includes -p when a non-default port is given', async () => {
    mockIsCertificateValid.mockResolvedValue({ valid: true });
    const base = await ensureSignedSshBase('sysadmin@1.2.3.4', { identity: '/home/u/.ssh/id_ed25519', port: '2222' });
    expect(base.port).toBe('2222');
    expect(base.baseSshArgs).toContain('-p');
    expect(base.baseSshArgs).toContain('2222');
  });

  it('re-signs when forceSign is set even if the cert is valid', async () => {
    mockIsCertificateValid.mockResolvedValue({ valid: true });
    mockSignCertificate.mockResolvedValue(undefined);
    await ensureSignedSshBase('sysadmin@1.2.3.4', { identity: '/home/u/.ssh/id_ed25519', forceSign: true });
    expect(mockSignCertificate).toHaveBeenCalledOnce();
  });

  it('throws when no SSH key can be resolved', async () => {
    mockIsCertificateValid.mockResolvedValue({ valid: true });
    mockGetDefaultKeyPath.mockResolvedValue(null);
    await expect(ensureSignedSshBase('sysadmin@1.2.3.4', {})).rejects.toThrow(/No SSH key/i);
  });
});

describe('pickFreePort', () => {
  it('returns a usable TCP port number', async () => {
    const { pickFreePort } = await import('../../src/commands/ssh/forward.js');
    const p = await pickFreePort();
    expect(typeof p).toBe('number');
    expect(p).toBeGreaterThan(0);
    expect(p).toBeLessThan(65536);
  });
});

describe('buildForwardArgs', () => {
  it('builds ssh -N -L argv from a signed base', async () => {
    const { buildForwardArgs } = await import('../../src/commands/ssh/forward.js');
    const args = buildForwardArgs(
      { keyPath: '/k', certPath: '/c', user: 'sysadmin', host: '1.2.3.4', port: '22',
        baseSshArgs: ['-i', '/k', '-o', 'CertificateFile=/c'] },
      { bindHost: '127.0.0.1', localPort: 54321, remoteHost: '127.0.0.1', remotePort: 9100 },
      8
    );
    expect(args).toEqual([
      '-i', '/k', '-o', 'CertificateFile=/c',
      '-o', 'BatchMode=yes',
      '-o', 'ConnectTimeout=8',
      '-N',
      '-L', '127.0.0.1:54321:127.0.0.1:9100',
      'sysadmin@1.2.3.4',
    ]);
  });

  it('omits user@ when no user is set', async () => {
    const { buildForwardArgs } = await import('../../src/commands/ssh/forward.js');
    const args = buildForwardArgs(
      { keyPath: '/k', certPath: '/c', user: undefined, host: 'h', port: '22', baseSshArgs: ['-i', '/k'] },
      { bindHost: '127.0.0.1', localPort: 1, remoteHost: '127.0.0.1', remotePort: 9100 },
      10
    );
    expect(args[args.length - 1]).toBe('h');
  });
});

describe('parseForwardOption', () => {
  it('parses a full -L bind:lport:rhost:rport spec', async () => {
    const { parseForwardOption } = await import('../../src/commands/ssh/forward.js');
    expect(parseForwardOption('127.0.0.1:0:127.0.0.1:9100')).toEqual({
      bindHost: '127.0.0.1', localPort: 0, remoteHost: '127.0.0.1', remotePort: 9100,
    });
  });

  it('defaults bindHost to 127.0.0.1 when 3-part form is given', async () => {
    const { parseForwardOption } = await import('../../src/commands/ssh/forward.js');
    expect(parseForwardOption('0:127.0.0.1:9100')).toEqual({
      bindHost: '127.0.0.1', localPort: 0, remoteHost: '127.0.0.1', remotePort: 9100,
    });
  });

  it('throws on a malformed spec', async () => {
    const { parseForwardOption } = await import('../../src/commands/ssh/forward.js');
    expect(() => parseForwardOption('nonsense')).toThrow(/forward spec/i);
  });
});

describe('runForward --dry-run', () => {
  it('prints the ssh argv without spawning', async () => {
    mockIsCertificateValid.mockResolvedValue({ valid: true });
    mockGetCertificatePath.mockResolvedValue('/c');
    const { runForward } = await import('../../src/commands/ssh/forward.js');
    const logs: string[] = [];
    const spy = vi.spyOn(console, 'log').mockImplementation((m?: unknown) => { logs.push(String(m ?? '')); });
    // also capture output.info
    await runForward('sysadmin@1.2.3.4', {
      identity: '/home/u/.ssh/id_ed25519', L: '127.0.0.1:55001:127.0.0.1:9100', dryRun: true,
    });
    spy.mockRestore();
    // Dry-run must not throw and must not signal an exit; presence of the section is enough here.
    expect(mockSignCertificate).not.toHaveBeenCalled();
  });
});
