import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

const REPO_ROOT = resolve(__dirname, '../..');
const CLI = join(REPO_ROOT, 'dist', 'index.js');
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
      secretEmitted: false,
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
