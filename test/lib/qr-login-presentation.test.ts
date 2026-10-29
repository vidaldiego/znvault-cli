import {randomUUID} from 'node:crypto';
import {stripVTControlCharacters} from 'node:util';
import {afterEach, describe, expect, it, vi} from 'vitest';
import {renderTerminalQr, terminalQrLogin} from '../../src/lib/qr-login-presentation.js';
import {qrLogin} from '../../src/lib/qr-login.js';
vi.mock('../../src/lib/qr-login.js', () => ({qrLogin: vi.fn()}));
const locator = 'znvault-authenticator://login?v=1&origin=https%3A%2F%2Fvault.example.test&installationId=' + randomUUID() + '&challengeId=' + randomUUID();
const ttyDescriptors = [process.stdin, process.stdout].map(stream => Object.getOwnPropertyDescriptor(stream, 'isTTY'));
const sizeDescriptors = ['columns', 'rows'].map(key => Object.getOwnPropertyDescriptor(process.stdout, key));
afterEach(() => {
  [process.stdin, process.stdout].forEach((stream, index) => {
    const descriptor = ttyDescriptors[index];
    if (descriptor) Object.defineProperty(stream, 'isTTY', descriptor);
    else Reflect.deleteProperty(stream, 'isTTY');
  });
  ['columns', 'rows'].forEach((key, index) => {
    const descriptor = sizeDescriptors[index];
    if (descriptor) Object.defineProperty(process.stdout, key, descriptor);
    else Reflect.deleteProperty(process.stdout, key);
  });
  vi.restoreAllMocks(); vi.clearAllMocks();
});
describe('terminal QR presentation', () => {
  it('renders a compact QR with at least four modules of white quiet zone', () => {
    const rendered = stripVTControlCharacters(renderTerminalQr(locator, 120, 80));
    const lines = rendered.split('\n').filter((_, index, all) => index < all.length - 1);
    expect(lines.length).toBeGreaterThan(20);
    expect(lines[0].trim()).toBe(''); expect(lines[1].trim()).toBe('');
    expect(lines.at(-1)?.trim()).toBe(''); expect(lines.at(-2)?.trim()).toBe('');
    expect(lines.every(line => line.startsWith('    ') && line.endsWith('    '))).toBe(true);
    expect(rendered).not.toContain('claimant');
    expect(rendered).not.toContain(locator);
  });
  it('reports insufficient terminal width without returning a truncated QR', () => {
    expect(() => renderTerminalQr(locator, 20, 80)).toThrow(/columns/);
  });
  it('reports insufficient terminal height', () => {
    expect(() => renderTerminalQr(locator, 120, 10)).toThrow(/rows/);
  });
  it('requires exactly enough rows for a wrapped preamble, QR and final cursor', () => {
    const graphic = stripVTControlCharacters(renderTerminalQr(locator, 100, 100));
    const qrRows = graphic.split('\n').length - 1, preamble = ['x'.repeat(101)];
    expect(() => renderTerminalQr(locator, 100, qrRows + 2, preamble)).toThrow(/rows/);
    const fitted = stripVTControlCharacters(renderTerminalQr(locator, 100, qrRows + 3, preamble));
    expect(fitted.startsWith(preamble[0] + '\n')).toBe(true);
    expect(fitted.split('\n').slice(1).join('\n')).toBe(graphic);
  });
  it('rejects non-interactive output before creating an attempt', async () => {
    Object.defineProperty(process.stdout, 'isTTY', {configurable: true, value: false});
    const peer = {getBaseUrl: () => 'https://vault.example.test', request: vi.fn()};
    expect(await terminalQrLogin(peer)).toMatchObject({success: false});
    expect(qrLogin).not.toHaveBeenCalled();
  });
  it('cleans up the SIGINT listener after login', async () => {
    for (const stream of [process.stdin, process.stdout]) Object.defineProperty(stream, 'isTTY', {configurable: true, value: true});
    const before = process.listenerCount('SIGINT');
    vi.mocked(qrLogin).mockResolvedValue({success: false, error: 'cancelled'});
    const peer = {getBaseUrl: () => 'https://vault.example.test', request: vi.fn()};
    await terminalQrLogin(peer);
    expect(process.listenerCount('SIGINT')).toBe(before);
  });
  it('rejects dimensions that fit the QR but clip it after wrapped instructions', async () => {
    for (const stream of [process.stdin, process.stdout]) Object.defineProperty(stream, 'isTTY', {configurable: true, value: true});
    const graphic = stripVTControlCharacters(renderTerminalQr(locator, 120, 100));
    const qrRows = graphic.split('\n').length - 1;
    const width = graphic.split('\n')[0].length;
    Object.defineProperty(process.stdout, 'columns', {configurable: true, value: width});
    Object.defineProperty(process.stdout, 'rows', {configurable: true, value: qrRows + 4});
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    vi.mocked(qrLogin).mockImplementation(async (_peer, options) => {
      try {
        await options.onPending({locator, origin: 'https://vault.example.test', expiresAt: Date.now() / 1000 + 120});
        return {success: true, user: {id: 'fixture', username: 'fixture', role: 'superadmin', tenantId: null, mfaVerified: true}};
      } catch {return {success: false, error: 'renderer declined'};}
    });
    const peer = {getBaseUrl: () => 'https://vault.example.test', request: vi.fn()};
    expect(await terminalQrLogin(peer)).toMatchObject({success: false, error: expect.stringMatching(/rows/)});
  });
  it('keeps all instructions before the final QR and reserves the cursor row', async () => {
    for (const stream of [process.stdin, process.stdout]) Object.defineProperty(stream, 'isTTY', {configurable: true, value: true});
    Object.defineProperty(process.stdout, 'columns', {configurable: true, value: 80});
    Object.defineProperty(process.stdout, 'rows', {configurable: true, value: 80});
    const write = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    vi.mocked(qrLogin).mockImplementation(async (_peer, options) => {
      await options.onPending({locator, origin: 'https://vault.example.test', expiresAt: Date.now() / 1000 + 120});
      return {success: true, user: {id: 'fixture', username: 'fixture', role: 'superadmin', tenantId: null, mfaVerified: true}};
    });
    const peer = {getBaseUrl: () => 'https://vault.example.test', request: vi.fn()};
    expect(await terminalQrLogin(peer)).toMatchObject({success: true});
    const rendered = write.mock.calls.map(([chunk]) => String(chunk)).join('');
    expect(rendered).toContain('The session will be stored');
    expect(rendered.indexOf('The session will be stored')).toBeLessThan(rendered.indexOf('\x1b[47m'));
  });
});
