import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { closeSync, mkdtempSync, openSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

const REPO_ROOT = resolve(__dirname, '../..');
const CLI = join(REPO_ROOT, 'dist', 'index.js');
const AUTH_WORKER = join(REPO_ROOT, 'test', 'fixtures', 'profile-auth-worker.mjs');
const STORE_WRITER = join(REPO_ROOT, 'test', 'fixtures', 'profile-store-writer.mjs');
const VALID_KEY = `znv_${'a'.repeat(64)}`;
const SECOND_KEY = `znv_${'b'.repeat(64)}`;

let configDir: string;

function run(
  args: string[],
  input?: string,
): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync('node', [CLI, '--plain', '--quiet', '--no-plugins', ...args], {
    env: { ...process.env, ZNVAULT_CONFIG_DIR: configDir, NO_COLOR: '1' },
    encoding: 'utf8',
    input,
  });
  return {
    status: result.status,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  };
}

function runAsync(
  args: string[],
  input: string,
): Promise<{ status: number | null; stdout: string; stderr: string }> {
  return new Promise((resolveRun, reject) => {
    const child = spawn('node', [CLI, '--plain', '--quiet', '--no-plugins', ...args], {
      env: { ...process.env, ZNVAULT_CONFIG_DIR: configDir, NO_COLOR: '1' },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8').on('data', (chunk) => { stdout += chunk; });
    child.stderr.setEncoding('utf8').on('data', (chunk) => { stderr += chunk; });
    child.on('error', reject);
    child.on('exit', (status) => resolveRun({ status, stdout, stderr }));
    child.stdin.end(input);
  });
}

function runAuthWorker(profileName: string): Promise<{ status: number | null; stdout: string }> {
  return new Promise((resolveRun, reject) => {
    const child = spawn('node', [AUTH_WORKER, configDir, profileName], {
      stdio: ['ignore', 'pipe', 'inherit'],
    });
    let stdout = '';
    child.stdout.setEncoding('utf8').on('data', (chunk) => { stdout += chunk; });
    child.on('error', reject);
    child.on('exit', (status) => resolveRun({ status, stdout }));
  });
}

function runStoreWriter(
  mode: 'plugins' | 'switch',
  firstProfile = '',
  secondProfile = '',
): Promise<{ status: number | null; stdout: string; stderr: string }> {
  return new Promise((resolveRun, reject) => {
    const child = spawn(
      'node',
      [STORE_WRITER, configDir, mode, firstProfile, secondProfile],
      { stdio: ['ignore', 'pipe', 'pipe'] },
    );
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8').on('data', (chunk) => { stdout += chunk; });
    child.stderr.setEncoding('utf8').on('data', (chunk) => { stderr += chunk; });
    child.on('error', reject);
    child.on('exit', (status) => resolveRun({ status, stdout, stderr }));
  });
}

function createEmptyProfile(name = 'consumer'): void {
  const result = run(['profile', 'create', name, '--vault-url', 'https://vault.example.com']);
  expect(result.status).toBe(0);
}

describe('profile api-key import --stdin (real CLI process)', () => {
  beforeAll(() => {
    execFileSync('npm', ['run', 'build'], { cwd: REPO_ROOT, stdio: 'inherit' });
  }, 180_000);

  beforeEach(() => {
    configDir = mkdtempSync(join(tmpdir(), 'znvault-api-key-import-'));
  });

  afterEach(() => {
    rmSync(configDir, { recursive: true, force: true });
  });

  it('stores one exact key in a 0600 config and emits only a secret-free receipt', () => {
    createEmptyProfile();

    const imported = run(
      ['profile', 'api-key', 'import', 'consumer', '--stdin', '--json'],
      `${VALID_KEY}\n`,
    );

    expect(imported.status).toBe(0);
    expect(JSON.parse(imported.stdout)).toEqual({
      success: true,
      profile: 'consumer',
      authMethod: 'api-key',
      secretsEmitted: false,
    });
    expect(imported.stdout + imported.stderr).not.toContain(VALID_KEY);

    const shown = run(['profile', 'show', 'consumer', '--json']);
    expect(shown.status).toBe(0);
    expect(JSON.parse(shown.stdout)).toMatchObject({
      name: 'consumer',
      authMethod: 'API Key',
      hasApiKey: true,
      hasCredentials: false,
    });

    const configPath = run(['config', 'path']).stdout.trim();
    expect(statSync(configPath).mode & 0o777).toBe(0o600);
    expect(readFileSync(configPath, 'utf8')).toContain(VALID_KEY);
  });

  it.each([VALID_KEY, `${VALID_KEY}\r\n`])(
    'accepts an exact key with no terminator or one CRLF',
    (input) => {
      createEmptyProfile();
      const imported = run(
        ['profile', 'api-key', 'import', 'consumer', '--stdin', '--json'],
        input,
      );

      expect(imported.status).toBe(0);
      expect(imported.stdout + imported.stderr).not.toContain(VALID_KEY);
    },
  );

  it('requires the explicit --stdin acknowledgement', () => {
    createEmptyProfile();
    const result = run(['profile', 'api-key', 'import', 'consumer'], VALID_KEY);

    expect(result.status).toBe(1);
    expect(result.stdout + result.stderr).toContain('Refusing API key import without --stdin');
    expect(result.stdout + result.stderr).not.toContain(VALID_KEY);
  });

  it('rejects stdin backed by a regular file rather than a pipe', () => {
    createEmptyProfile();
    const keyPath = join(configDir, 'forbidden-key-file');
    writeFileSync(keyPath, VALID_KEY, { mode: 0o600 });
    const fd = openSync(keyPath, 'r');
    try {
      const result = spawnSync(
        'node',
        [
          CLI,
          '--plain',
          '--quiet',
          '--no-plugins',
          'profile',
          'api-key',
          'import',
          'consumer',
          '--stdin',
        ],
        {
          env: { ...process.env, ZNVAULT_CONFIG_DIR: configDir, NO_COLOR: '1' },
          encoding: 'utf8',
          stdio: [fd, 'pipe', 'pipe'],
        },
      );
      expect(result.status).toBe(1);
      expect((result.stdout ?? '') + (result.stderr ?? '')).toContain(
        'API key import requires piped stdin',
      );
      expect((result.stdout ?? '') + (result.stderr ?? '')).not.toContain(VALID_KEY);
    } finally {
      closeSync(fd);
    }
  });

  it.each([
    ['', 'empty'],
    [` ${VALID_KEY}\n`, 'leading whitespace'],
    [`${VALID_KEY} \n`, 'trailing whitespace'],
    [`${VALID_KEY}\n${SECOND_KEY}\n`, 'multiple lines'],
    [`znv_${'A'.repeat(64)}\n`, 'uppercase hex'],
    [`znv_${'g'.repeat(64)}\n`, 'non-hex'],
    [`znv_${'a'.repeat(63)}\n`, 'wrong length'],
  ])('rejects %s input without reflecting it (%s)', (input) => {
    createEmptyProfile();
    const result = run(
      ['profile', 'api-key', 'import', 'consumer', '--stdin', '--json'],
      input,
    );

    expect(result.status).toBe(1);
    expect(result.stdout + result.stderr).toContain('Invalid API key input');
    if (input.trim().length > 0) {
      expect(result.stdout + result.stderr).not.toContain(input.trim());
    }
    const shown = JSON.parse(run(['profile', 'show', 'consumer', '--json']).stdout);
    expect(shown.hasApiKey).toBe(false);
  });

  it('refuses to overwrite an existing API-key principal', () => {
    createEmptyProfile();
    expect(run(
      ['profile', 'api-key', 'import', 'consumer', '--stdin'],
      VALID_KEY,
    ).status).toBe(0);

    const second = run(
      ['profile', 'api-key', 'import', 'consumer', '--stdin'],
      SECOND_KEY,
    );
    expect(second.status).toBe(1);
    expect(second.stdout + second.stderr).toContain('already has authentication configured');
    expect(second.stdout + second.stderr).not.toContain(SECOND_KEY);

    const configPath = run(['config', 'path']).stdout.trim();
    const stored = readFileSync(configPath, 'utf8');
    expect(stored).toContain(VALID_KEY);
    expect(stored).not.toContain(SECOND_KEY);
  });

  it('serializes concurrent imports so exactly one principal wins', async () => {
    createEmptyProfile();
    const args = ['profile', 'api-key', 'import', 'consumer', '--stdin', '--json'];

    const [first, second] = await Promise.all([
      runAsync(args, VALID_KEY),
      runAsync(args, SECOND_KEY),
    ]);

    expect([first.status, second.status].sort()).toEqual([0, 1]);
    const success = first.status === 0 ? first : second;
    const refused = first.status === 1 ? first : second;
    expect(JSON.parse(success.stdout)).toMatchObject({
      success: true,
      secretsEmitted: false,
    });
    expect(refused.stdout + refused.stderr).toContain('already has authentication configured');
    const allOutput = first.stdout + first.stderr + second.stdout + second.stderr;
    expect(allOutput).not.toContain(VALID_KEY);
    expect(allOutput).not.toContain(SECOND_KEY);

    const configPath = run(['config', 'path']).stdout.trim();
    const stored = readFileSync(configPath, 'utf8');
    expect(Number(stored.includes(VALID_KEY)) + Number(stored.includes(SECOND_KEY))).toBe(1);
  });

  it('serializes an import against a concurrent JWT credential write', async () => {
    createEmptyProfile();
    const args = ['profile', 'api-key', 'import', 'consumer', '--stdin', '--json'];

    const [imported, jwt] = await Promise.all([
      runAsync(args, VALID_KEY),
      runAuthWorker('consumer'),
    ]);

    expect([imported.status, jwt.status].sort()).toEqual([0, 1]);
    const configPath = run(['config', 'path']).stdout.trim();
    const stored = readFileSync(configPath, 'utf8');
    expect(stored.includes(VALID_KEY)).not.toBe(stored.includes('test-access-token'));
    expect(imported.stdout + imported.stderr + jwt.stdout).not.toContain(VALID_KEY);
  });

  it('preserves imported authentication across a concurrent generic config write', async () => {
    createEmptyProfile();
    const [imported, configured] = await Promise.all([
      runAsync(
        ['profile', 'api-key', 'import', 'consumer', '--stdin', '--json'],
        VALID_KEY,
      ),
      runAsync(['--profile', 'consumer', 'config', 'set', 'timeout', '45000'], ''),
    ]);

    expect(imported.status).toBe(0);
    expect(configured.status).toBe(0);
    const configPath = run(['config', 'path']).stdout.trim();
    const profile = JSON.parse(readFileSync(configPath, 'utf8')).profiles.consumer;
    expect(profile.apiKey).toBe(VALID_KEY);
    expect(profile.timeout).toBe(45000);
    expect(imported.stdout + imported.stderr + configured.stdout + configured.stderr).not.toContain(VALID_KEY);
  });

  it('serializes imports against concurrent plugin and active-profile writers', async () => {
    const profileNames = Array.from({ length: 8 }, (_, index) => `consumer-${index}`);
    for (const profileName of profileNames) createEmptyProfile(profileName);
    createEmptyProfile('switch-a');
    createEmptyProfile('switch-b');

    const results = await Promise.all([
      ...profileNames.map((profileName) => runAsync(
        ['profile', 'api-key', 'import', profileName, '--stdin', '--json'],
        VALID_KEY,
      )),
      runStoreWriter('plugins'),
      runStoreWriter('switch', 'switch-a', 'switch-b'),
    ]);

    expect(results.every((result) => result.status === 0)).toBe(true);
    const allOutput = results.map((result) => result.stdout + result.stderr).join('');
    expect(allOutput).not.toContain(VALID_KEY);

    const configPath = run(['config', 'path']).stdout.trim();
    const config = JSON.parse(readFileSync(configPath, 'utf8'));
    for (const profileName of profileNames) {
      expect(config.profiles[profileName].apiKey).toBe(VALID_KEY);
      expect(config.profiles[profileName].credentials).toBeUndefined();
    }
    expect(['switch-a', 'switch-b']).toContain(config.activeProfile);
    expect(config.plugins).toHaveLength(5);
  }, 30_000);

  it('forbids whole-store replacement through the exported proxy', async () => {
    createEmptyProfile();
    expect(run(
      ['profile', 'api-key', 'import', 'consumer', '--stdin'],
      VALID_KEY,
    ).status).toBe(0);

    const replacement = spawnSync(
      'node',
      [
        '--input-type=module',
        '--eval',
        "import { store } from './dist/lib/config/index.js'; store.store = { activeProfile: 'default', profiles: {}, plugins: [] };",
      ],
      {
        cwd: REPO_ROOT,
        env: { ...process.env, ZNVAULT_CONFIG_DIR: configDir },
        encoding: 'utf8',
      },
    );

    expect(replacement.status).toBe(1);
    expect((replacement.stdout ?? '') + (replacement.stderr ?? '')).toContain(
      'Direct CLI config store replacement is forbidden',
    );
    const configPath = run(['config', 'path']).stdout.trim();
    expect(readFileSync(configPath, 'utf8')).toContain(VALID_KEY);
  });

  it('refuses an unknown target profile without consuming or reflecting the key', () => {
    const result = run(
      ['profile', 'api-key', 'import', 'missing', '--stdin'],
      VALID_KEY,
    );

    expect(result.status).toBe(1);
    expect(result.stdout + result.stderr).toContain("Profile 'missing' not found");
    expect(result.stdout + result.stderr).not.toContain(VALID_KEY);
  });
});
