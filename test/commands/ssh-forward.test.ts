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
