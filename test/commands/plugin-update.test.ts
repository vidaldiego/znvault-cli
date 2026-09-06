import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Command } from 'commander';

vi.mock('chalk', () => ({
  default: {
    cyan: (value: string) => value,
    green: (value: string) => value,
    dim: (value: string) => value,
  },
}));

vi.mock('../../src/lib/config.js', () => ({
  getPlugins: vi.fn(),
}));

vi.mock('../../src/lib/output.js', () => ({
  spinner: vi.fn(() => ({
    start: vi.fn().mockReturnThis(),
    succeed: vi.fn().mockReturnThis(),
    fail: vi.fn().mockReturnThis(),
    info: vi.fn().mockReturnThis(),
    text: '',
  })),
  error: vi.fn(),
  json: vi.fn(),
}));

vi.mock('../../src/commands/plugin/helpers.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/commands/plugin/helpers.js')>();
  return {
    ...actual,
    getInstalledVersion: vi.fn(),
    getPackageVersion: vi.fn(),
    getPluginsDir: vi.fn(() => '/tmp/znvault-plugin-update-test'),
    runNpm: vi.fn(),
  };
});

import { getPlugins } from '../../src/lib/config.js';
import * as output from '../../src/lib/output.js';
import {
  getInstalledVersion,
  getPackageVersion,
  runNpm,
} from '../../src/commands/plugin/helpers.js';
import { registerUpdateCommand } from '../../src/commands/plugin/update.js';

const PACKAGE = '@zincapp/znvault-plugin-webdeploy';

describe('plugin update version direction', () => {
  let program: Command;

  beforeEach(() => {
    vi.clearAllMocks();
    program = new Command();
    program.exitOverride();
    registerUpdateCommand(program);
    vi.mocked(getPlugins).mockReturnValue([{ package: PACKAGE, enabled: true }]);
  });

  it('does not downgrade a local plugin newer than the npm latest tag', async () => {
    vi.mocked(getInstalledVersion).mockReturnValue('0.2.3');
    vi.mocked(getPackageVersion).mockReturnValue('0.2.1');

    await program.parseAsync(['node', 'test', 'update', 'webdeploy', '--json']);

    expect(runNpm).not.toHaveBeenCalled();
    expect(output.json).toHaveBeenCalledWith({ success: true, updates: [] });
  });

  it('still installs latest when npm is strictly newer', async () => {
    vi.mocked(getInstalledVersion).mockReturnValue('0.2.1');
    vi.mocked(getPackageVersion).mockReturnValue('0.2.3');
    vi.mocked(runNpm).mockResolvedValue({ success: true, output: '' });

    await program.parseAsync(['node', 'test', 'update', 'webdeploy', '--json']);

    expect(runNpm).toHaveBeenCalledWith(['install', `${PACKAGE}@latest`], '/tmp/znvault-plugin-update-test');
    expect(output.json).toHaveBeenCalledWith({
      success: true,
      updates: [{
        name: 'webdeploy',
        packageName: PACKAGE,
        from: '0.2.1',
        to: '0.2.3',
      }],
    });
  });
});
