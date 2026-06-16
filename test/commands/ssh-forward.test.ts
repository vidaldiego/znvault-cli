// Path: test/commands/ssh-forward.test.ts
import { EventEmitter } from 'node:events';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

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

// Mock output so we can capture the structured output calls (output.info etc.)
// instead of asserting on raw console.log. forward.ts and connect.ts both do
// `import * as output from '../../lib/output.js'`, so every function they touch
// (info/success/error/section/keyValue) must be present here.
const mockOutputInfo = vi.fn();
const mockOutputSuccess = vi.fn();
const mockOutputError = vi.fn();
const mockOutputSection = vi.fn();
const mockOutputKeyValue = vi.fn();
vi.mock('../../src/lib/output.js', () => ({
  info: (...a: unknown[]) => mockOutputInfo(...a),
  success: (...a: unknown[]) => mockOutputSuccess(...a),
  error: (...a: unknown[]) => mockOutputError(...a),
  section: (...a: unknown[]) => mockOutputSection(...a),
  keyValue: (...a: unknown[]) => mockOutputKeyValue(...a),
}));

// Mock child_process so --print-port never spawns a real ssh. forward.ts uses
// `await import('child_process')` (the bare specifier), so that's what we mock.
// The fake child emits NOTHING ('close'/'error' never fire), so runForward
// proceeds straight to the print step and then holds.
const mockSpawn = vi.fn();
vi.mock('child_process', () => ({
  spawn: (...a: unknown[]) => mockSpawn(...a),
}));

/** A minimal child_process.ChildProcess stand-in for spawn(). */
interface FakeChild extends EventEmitter {
  pid: number;
  kill: ReturnType<typeof vi.fn>;
}

function makeFakeChild(pid: number): FakeChild {
  const child = new EventEmitter() as FakeChild;
  child.pid = pid;
  child.kill = vi.fn();
  return child;
}

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
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('emits the would-execute ssh argv without spawning or signing', async () => {
    mockIsCertificateValid.mockResolvedValue({ valid: true });
    mockGetCertificatePath.mockResolvedValue('/c');
    const { runForward } = await import('../../src/commands/ssh/forward.js');

    await runForward('sysadmin@1.2.3.4', {
      identity: '/home/u/.ssh/id_ed25519', L: '127.0.0.1:55001:127.0.0.1:9100', dryRun: true,
    });

    // Dry-run must not sign and must not spawn.
    expect(mockSignCertificate).not.toHaveBeenCalled();
    expect(mockSpawn).not.toHaveBeenCalled();

    // The dry-run must actually report the ssh command it would run. That line
    // goes through output.info (not raw console.log), so assert on the captured
    // output.info calls.
    const infoMessages = mockOutputInfo.mock.calls.map((c) => String(c[0]));
    const wouldExecute = infoMessages.find((m) => m.startsWith('Would execute: ssh'));
    expect(wouldExecute).toBeDefined();
    expect(wouldExecute).toContain('-N');
    expect(wouldExecute).toContain('-L 127.0.0.1:55001:127.0.0.1:9100');
    expect(wouldExecute).toContain('sysadmin@1.2.3.4');
  });
});

describe('runForward --print-port', () => {
  let stdoutSpy: ReturnType<typeof vi.spyOn>;
  let exitSpy: ReturnType<typeof vi.spyOn>;
  const sigListeners = { SIGINT: 0, SIGTERM: 0 };

  beforeEach(() => {
    vi.clearAllMocks();
    sigListeners.SIGINT = process.listenerCount('SIGINT');
    sigListeners.SIGTERM = process.listenerCount('SIGTERM');
    // Guard the runner: a stray process.exit (e.g. from an unexpected child
    // event) must not kill the test process. No throw — runForward keeps going.
    exitSpy = vi.spyOn(process, 'exit').mockImplementation(((): never => undefined as never));
    stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  });

  afterEach(() => {
    stdoutSpy.mockRestore();
    exitSpy.mockRestore();
    // Drop the SIGINT/SIGTERM handlers runForward registered so they don't leak
    // across tests or fire on real signals during the run.
    const trim = (sig: 'SIGINT' | 'SIGTERM'): void => {
      const listeners = process.listeners(sig);
      for (let i = sigListeners[sig]; i < listeners.length; i++) {
        process.removeListener(sig, listeners[i] as (...args: unknown[]) => void);
      }
    };
    trim('SIGINT');
    trim('SIGTERM');
  });

  it('writes exactly one JSON contract line {localPort,pid,forwardUp} to stdout', async () => {
    mockIsCertificateValid.mockResolvedValue({ valid: true });
    mockGetCertificatePath.mockResolvedValue('/c');
    // -L pins lport=55005, so pickFreePort is NOT used and localPort is deterministic.
    const fakeChild = makeFakeChild(4242);
    mockSpawn.mockReturnValue(fakeChild);

    const { runForward } = await import('../../src/commands/ssh/forward.js');

    // runForward holds in print mode (never resolves), so don't await it. Kick
    // it off, then wait past the internal 300ms establish delay before asserting.
    void runForward('sysadmin@1.2.3.4', {
      identity: '/home/u/.ssh/id_ed25519', L: '127.0.0.1:55005:127.0.0.1:9100', printPort: true,
    });
    await new Promise((r) => setTimeout(r, 400));

    expect(mockSpawn).toHaveBeenCalledOnce();
    expect(mockSpawn).toHaveBeenCalledWith('ssh', expect.any(Array), expect.any(Object));

    // Exactly one stdout write, and it must be the JSON contract line a separate
    // plugin parses. forwardUp + the pinned port + the fake child's pid.
    const lines = stdoutSpy.mock.calls.map((c) => String(c[0]));
    expect(lines).toHaveLength(1);
    expect(lines[0].endsWith('\n')).toBe(true);
    const parsed: unknown = JSON.parse(lines[0]);
    expect(parsed).toEqual({ localPort: 55005, pid: 4242, forwardUp: true });

    // Never exited; the held tunnel is still "running" from runForward's view.
    expect(exitSpy).not.toHaveBeenCalled();
  });
});
