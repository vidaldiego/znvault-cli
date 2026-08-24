// Path: test/lib/profile-guard.test.ts

/**
 * Regression tests for the `--profile` fail-closed guard.
 *
 * Bug: `getCurrentProfile()` falls back to CONFIG_DEFAULTS (https://localhost:8443)
 * for a profile name it does not know. That default is correct for a fresh
 * install, and wrong for an explicit `--profile <name>`: every runbook in
 * zn-vault writes its verification steps as `znvault --profile prod ...`, while
 * the profile on the operator's machine is called `production`. The command
 * then reported on the operator's own laptop instead of the production
 * cluster — a verification that answers about the wrong host, which is worse
 * than one that refuses to answer.
 *
 * Fix: the root preAction hook rejects an explicit `--profile` naming a
 * profile that is not configured, listing the ones that are. The `profile`
 * command group is exempt so profile management is never locked out by its own
 * guard.
 *
 * These tests drive the real built CLI in a real child process against an
 * isolated ZNVAULT_CONFIG_DIR, because the guard lives in the Commander hook —
 * a unit test of the config layer would not exercise it.
 */

import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const REPO_ROOT = resolve(__dirname, '../..');
const CLI = join(REPO_ROOT, 'dist', 'index.js');

let configDir: string;

function run(args: string[]): { status: number | null; stdout: string; stderr: string } {
  const r = spawnSync('node', [CLI, ...args], {
    env: { ...process.env, ZNVAULT_CONFIG_DIR: configDir, NO_COLOR: '1' },
    encoding: 'utf8',
  });
  return { status: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

describe('--profile fail-closed guard (real CLI process)', () => {
  beforeAll(() => {
    // The tests drive dist/, so the suite is coupled to a fresh build.
    execFileSync('npm', ['run', 'build'], { cwd: REPO_ROOT, stdio: 'inherit' });
  }, 180000);

  beforeEach(() => {
    configDir = mkdtempSync(join(tmpdir(), 'znvault-profile-guard-'));
  });

  afterEach(() => {
    rmSync(configDir, { recursive: true, force: true });
  });

  it('refuses an explicit --profile that is not configured, instead of silently using localhost', () => {
    const { status, stderr, stdout } = run(['--profile', 'prod', 'health']);

    expect(status).toBe(1);
    const out = stderr + stdout;
    expect(out).toContain("unknown profile 'prod'");
    // The failure must never look like a health result for some other host.
    expect(out).not.toContain('localhost:8443');
  });

  it('names the profiles that DO exist so the operator can correct the command', () => {
    run(['profile', 'create', 'production', '--vault-url', 'https://vault.example.com']);
    run(['profile', 'create', 'lab', '--vault-url', 'https://lab.example.com']);

    const { status, stderr, stdout } = run(['--profile', 'prod', 'health']);
    const out = stderr + stdout;

    expect(status).toBe(1);
    expect(out).toContain('Configured profiles:');
    expect(out).toContain('production');
    expect(out).toContain('lab');
  });

  it('lets a configured profile through', () => {
    run(['profile', 'create', 'production', '--vault-url', 'https://vault.example.com']);

    const { stderr, stdout } = run(['--profile', 'production', 'health']);
    const out = stderr + stdout;

    // The health call itself cannot succeed against example.com; what matters
    // is that the guard did not reject the profile and the CLI targeted it.
    expect(out).not.toContain('unknown profile');
    expect(out).toContain('vault.example.com');
  });

  it('exempts the profile command group so profile management is never locked out', () => {
    const { status, stdout, stderr } = run(['--profile', 'does-not-exist', 'profile', 'list']);

    expect(status).toBe(0);
    expect(stdout + stderr).not.toContain('unknown profile');
  });

  it('leaves a fresh install with no profiles working when --profile is not passed', () => {
    const { stdout, stderr } = run(['profile', 'list']);

    expect(stdout + stderr).not.toContain('unknown profile');
  });
});
