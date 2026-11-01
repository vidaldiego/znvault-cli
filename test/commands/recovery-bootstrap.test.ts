import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fixture, invalidS3Configs } from '../helpers/recovery-fixture.js';
const root = resolve(import.meta.dirname, '../..');
const directory = mkdtempSync(join(tmpdir(), 'recovery-bootstrap-'));
const imports = join(directory, 'imports.jsonl');
const network = join(directory, 'network.jsonl');
const loader = join(directory, 'guard.mjs');
const input = join(directory, 'dump.arcn');
const manifest = join(directory, 'manifest.json');
let installedCli: string;
let verifiedFixture: Awaited<ReturnType<typeof fixture>>;
const run = (args: string[], cli = join(root, 'dist/index.js')) => {
  writeFileSync(imports, ''); writeFileSync(network, '');
  const env = { ...process.env, HOME: directory, ZNVAULT_CONFIG_DIR: join(directory, 'config'), ZNVAULT_URL: 'http://127.0.0.1:1', ZNVAULT_PROFILE: 'hostile', ZNVAULT_LOCAL: '1' };
  delete env.ZNVAULT_NO_PLUGINS; delete env.ZNVAULT_NO_UPDATE_CHECK;
  return spawnSync(process.execPath, ['--import', loader, cli, ...args], { cwd: directory, env, encoding: 'utf8', timeout: 15000 });
};
beforeAll(async () => {
  mkdirSync(join(directory, 'verify'));
  verifiedFixture = await fixture(join(directory, 'verify'), { companion:true, managedKeys:true });
  mkdirSync(join(directory, 'config'));
  writeFileSync(join(directory, 'config/config.json'), 'invalid config that must never be parsed');
  writeFileSync(loader, `import { registerHooks, syncBuiltinESMExports } from 'node:module';
import { appendFileSync } from 'node:fs';
import http from 'node:http'; import https from 'node:https'; import net from 'node:net'; import tls from 'node:tls';
const deny = () => { appendFileSync(${JSON.stringify(network)}, 'request\\n'); throw Error('OUTBOUND_FORBIDDEN'); };
http.request = deny; http.get = deny; https.request = deny; https.get = deny; net.connect = deny; net.createConnection = deny; tls.connect = deny; globalThis.fetch = deny; syncBuiltinESMExports();
registerHooks({load(url, context, next) { if (url.includes('/@aws-sdk/client-s3/') || /\\/dist\\/(?:main\\.js|lib\\/(?:config|client|cli-update|qr-login-presentation)|plugins\\/|services\\/update)/.test(url)) { appendFileSync(${JSON.stringify(imports)}, JSON.stringify(url)+'\\n'); throw Error('FORBIDDEN_IMPORT:'+url); } return next(url, context); }});`);
  // Header-only inspection still validates the ARCN1 structural header.
  const header = Buffer.alloc(40); header.write('ARCN1'); header.writeUInt16BE(1, 8); header[10] = 1; writeFileSync(input, header);
  writeFileSync(manifest, JSON.stringify({ manifestVersion: 2, backupId: 42, serviceName: 'synthetic' }));
});
beforeAll(() => {
  const packed = spawnSync('npm', ['pack', '--json', '--pack-destination', directory], { cwd: root, encoding: 'utf8', timeout: 60000 });
  expect(packed.status, packed.stderr).toBe(0);
  const [{ filename }] = JSON.parse(packed.stdout);
  const prefix = join(directory, 'installed');
  const install = spawnSync('npm', ['install', '--prefix', prefix, '--offline', '--ignore-scripts', '--no-audit', '--no-fund', join(directory, filename)], { cwd: directory, encoding: 'utf8', timeout: 120000 });
  expect(install.status, install.stderr).toBe(0);
  installedCli = join(prefix, 'node_modules/@zincapp/znvault-cli/dist/index.js');
}, 180000);
afterAll(() => rmSync(directory, { recursive: true, force: true }));

describe('early offline bootstrap', () => {
  // Catches routing local key requests through connected initialization.
  it('inspects without importing configuration, client, plugin, updates or QR/session code or making requests', () => {
    const result = run(['recovery', 'inspect', '--input', input, '--manifest', manifest]);
    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout).authenticated).toBe(false);
    const forbiddenImports = readFileSync(imports, 'utf8').trim().split('\n').filter(Boolean);
    const outboundRequests = readFileSync(network, 'utf8').trim().split('\n').filter(Boolean).length;
    expect(forbiddenImports).toEqual([]); expect(outboundRequests).toBe(0);
  });
  it('executes the packed and independently installed CLI with no connected imports or network', () => {
    const result = run(['recovery', 'inspect', '--input', input, '--manifest', manifest], installedCli);
    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout).authenticated).toBe(false);
    const forbiddenImports = readFileSync(imports, 'utf8').trim().split('\n').filter(Boolean);
    const outboundRequests = readFileSync(network, 'utf8').trim().split('\n').filter(Boolean).length;
    expect(forbiddenImports).toEqual([]); expect(outboundRequests).toBe(0);
  });
  it.each(['--profile=other' , '--url=http://127.0.0.1:1', '--insecure', '--local', '--key-source=vault'])(`refuses mixed connected/offline option %s before connected imports`, option => {
    const result = run(['recovery', 'verify', '--key-file', 'never-read', option]);
    expect(result.status).not.toBe(0); expect(result.stderr).toMatch(/incompatible|unknown option/);
    expect(readFileSync(imports, 'utf8')).toBe(''); expect(readFileSync(network, 'utf8')).toBe('');
  });
  it('fails closed for unreadable trusted selection without claiming authenticated recovery', () => {
    for (const operation of ['verify', 'extract']) {
      const result = run(['recovery', operation, '--input', input, '--manifest', manifest, '--expect', 'never-read', '--key-file', 'never-read']);
      expect(result.status).not.toBe(0); expect(result.stderr).toMatch(/Recovery/);
      expect(result.stdout).toBe(''); expect(readFileSync(imports, 'utf8')).toBe('');
    }
  });
  it('verifies and extracts both components with repeated key files from source and installed CLI without imports or outbound requests', () => {
    for (const [i, cli] of [join(root,'dist/index.js'), installedCli].entries()) {
      const base = ['--input', verifiedFixture.paths.dump, '--companion-input', verifiedFixture.paths.companion, '--manifest', join(directory,'verify/manifest.json'), '--expect', join(directory,'verify/selection.json'), ...verifiedFixture.keyFiles.flatMap(path => ['--key-file',path]), '--json', '--debug'];
      for (const operation of ['verify','extract']) {
        const result = run(['recovery',operation,...base,...(operation==='extract'?['--output',join(directory,`published-${i}`)]:[])],cli);
        expect(result.status,result.stderr).toBe(0); expect(JSON.parse(result.stdout).authenticated).toBe(true);
        expect(result.stdout+result.stderr).not.toContain('SYNTHETIC_SQL_MARKER'); expect(result.stdout+result.stderr).not.toContain('vault/bsk');
        expect(readFileSync(imports,'utf8')).toBe(''); expect(readFileSync(network,'utf8')).toBe('');
      }
    }
  });
  it('rejects another complete valid set against an independently pinned selection before key or source reads', async () => {
    const alternativeDir=join(directory,'substitute');mkdirSync(alternativeDir);const alternative=await fixture(alternativeDir,{companion:true,plain:Buffer.from('OTHER_VALID_SET')});
    const result=run(['recovery','extract','--input',alternative.paths.dump,'--companion-input',alternative.paths.companion,'--manifest',join(alternativeDir,'manifest.json'),'--expect',join(directory,'verify/selection.json'),'--key-file','never-read','--output',join(directory,'substitute-output'),'--json','--debug']);
    expect(result.status).not.toBe(0);expect(result.stdout).toBe('');expect(result.stderr).not.toContain('OTHER_VALID_SET');expect(readFileSync(imports,'utf8')).toBe('');expect(readFileSync(network,'utf8')).toBe('');
  });
  it('redacts malformed key contents and unrecognized argument values in JSON/debug error paths', () => {
    const key=join(directory,'invalid-key');writeFileSync(key,'KEY_SECRET_MARKER',{mode:0o600});
    for(const more of [[],['--unknown=ARG_SECRET_MARKER']]) {
      const result=run(['recovery','verify','--input',verifiedFixture.paths.dump,'--companion-input',verifiedFixture.paths.companion,'--manifest',join(directory,'verify/manifest.json'),'--expect',join(directory,'verify/selection.json'),'--key-file',key,'--json','--debug',...more]);
      expect(result.status).not.toBe(0);expect(result.stdout+result.stderr).not.toMatch(/KEY_SECRET_MARKER|ARG_SECRET_MARKER|SYNTHETIC_SQL_MARKER/);expect(result.stdout).toBe('');
    }
  });
  it.each(invalidS3Configs)('rejects malformed protected S3 config %s before any SDK import or outbound request', (name,value) => {
    const config=join(directory,'invalid-s3.json');
      writeFileSync(config,JSON.stringify(value),{mode:0o600});
      const result=run(['recovery','verify','--s3-config',config,'--manifest',join(directory,'verify/manifest.json'),'--expect',join(directory,'verify/selection.json'),...verifiedFixture.keyFiles.flatMap(path=>['--key-file',path]),'--json','--debug']);
      expect(result.status,name).not.toBe(0);expect(result.stdout,name).toBe('');expect(result.stderr,name).not.toContain('S3_SECRET_MARKER');expect(readFileSync(imports,'utf8'),name).toBe('');expect(readFileSync(network,'utf8'),name).toBe('');
  });
  it('does not let delimiters or option values masquerade as command or key selector', async () => {
    const { selectRecoveryBootstrap } = await import('../../src/commands/recovery/bootstrap.js');
    const cases: Array<[string[], string]> = [
      [['recovery','inspect'], 'offline-recovery'], [['recovery','verify','--key-file=a'], 'offline-recovery'],
      [['--profile','recovery','secret','list'], 'normal'], [['secret','list','--','recovery','--key-file=a'], 'normal'],
      [['--','recovery','verify','--key-file=a'], 'normal'], [['recovery','verify','--','--key-file=a'], 'offline-recovery'],
      [['--profile','x','recovery','verify','--key-file=a'], 'offline-recovery'],
    ];
    for (const [args, expected] of cases) expect(selectRecoveryBootstrap(args)).toBe(expected);
  });
});
