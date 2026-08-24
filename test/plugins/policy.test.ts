import { existsSync, mkdtempSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { areCLIPluginsDisabled } from '../../src/plugins/policy.js';

const temporaryDirectories: string[] = [];

// Building the whole CLI takes well over vitest's default 10s hookTimeout on a
// cold CI runner (it passes locally only because the tsc cache is warm).
beforeAll(() => {
  execFileSync('npm', ['run', 'build'], { cwd: process.cwd(), stdio: 'pipe' });
}, 180_000);

function createTemporaryDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), 'znvault-no-plugins-'));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe('CLI plugin invocation policy', () => {
  it('fails closed on a flag-shaped argument before the child-command separator', () => {
    expect(areCLIPluginsDisabled(['--no-plugins', 'ssh', 'connect'], {})).toBe(true);
    expect(areCLIPluginsDisabled(['ssh', 'connect', '--no-plugins'], {})).toBe(true);
    expect(areCLIPluginsDisabled(['--no-plugins=true', '--version'], {})).toBe(true);
  });

  it('does not consume a child command argument after the separator', () => {
    expect(
      areCLIPluginsDisabled(
        ['ssh', 'connect', 'sysadmin@example', '--', 'probe', '--no-plugins'],
        {}
      )
    ).toBe(false);
  });

  it('supports an explicit environment closure without accepting false-like values', () => {
    expect(areCLIPluginsDisabled([], { ZNVAULT_NO_PLUGINS: '1' })).toBe(true);
    expect(areCLIPluginsDisabled([], { ZNVAULT_NO_PLUGINS: 'TRUE' })).toBe(true);
    expect(areCLIPluginsDisabled([], { ZNVAULT_NO_PLUGINS: '0' })).toBe(false);
    expect(areCLIPluginsDisabled([], { ZNVAULT_NO_PLUGINS: 'false' })).toBe(false);
  });

  it('prevents an enabled configured plugin module from being imported', () => {
    const directory = createTemporaryDirectory();
    const marker = join(directory, 'plugin-imported');
    const plugin = join(directory, 'hostile-plugin.mjs');
    const configDirectory = directory;
    const distEntrypoint = resolve(process.cwd(), 'dist/index.js');

    writeFileSync(
      plugin,
      [
        "import { writeFileSync } from 'node:fs';",
        "writeFileSync(process.env.ZNVAULT_PLUGIN_TEST_MARKER, 'imported', { flag: 'wx' });",
        "export default { name: 'hostile-test', version: '1.0.0', registerCommands() {} };",
        '',
      ].join('\n'),
      { mode: 0o600 }
    );
    writeFileSync(
      join(directory, 'config.json'),
      JSON.stringify({
        activeProfile: 'default',
        profiles: {},
        plugins: [{ path: plugin, enabled: true }],
      }),
      { mode: 0o600 }
    );

    const childEnvironment = {
      ...process.env,
      CI: '1',
      ZNVAULT_CONFIG_DIR: configDirectory,
      ZNVAULT_NO_UPDATE_CHECK: '1',
      ZNVAULT_PLUGIN_TEST_MARKER: marker,
    };
    delete childEnvironment.ZNVAULT_NO_PLUGINS;
    const control = spawnSync(process.execPath, [distEntrypoint, '--version'], {
      encoding: 'utf8',
      env: childEnvironment,
    });

    expect(control.status, control.stderr).toBe(0);
    expect(existsSync(marker)).toBe(true);
    unlinkSync(marker);

    const childArgument = spawnSync(
      process.execPath,
      [distEntrypoint, '--version', '--', '--no-plugins'],
      { encoding: 'utf8', env: childEnvironment }
    );

    expect(childArgument.status, childArgument.stderr).toBe(0);
    expect(existsSync(marker)).toBe(true);
    unlinkSync(marker);

    const result = spawnSync(process.execPath, [distEntrypoint, '--no-plugins', '--version'], {
      encoding: 'utf8',
      env: childEnvironment,
    });

    expect(result.status, result.stderr).toBe(0);
    expect(existsSync(marker)).toBe(false);

    const environmentResult = spawnSync(process.execPath, [distEntrypoint, '--version'], {
      encoding: 'utf8',
      env: { ...childEnvironment, ZNVAULT_NO_PLUGINS: '1' },
    });

    expect(environmentResult.status, environmentResult.stderr).toBe(0);
    expect(existsSync(marker)).toBe(false);

    const malformedFlag = spawnSync(
      process.execPath,
      [distEntrypoint, '--no-plugins=true', 'completion', 'bash'],
      { encoding: 'utf8', env: childEnvironment }
    );

    expect(malformedFlag.status).not.toBe(0);
    expect(existsSync(marker)).toBe(false);
  }, 20_000);
});
