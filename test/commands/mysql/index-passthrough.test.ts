import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {Command} from 'commander';

const mocks = vi.hoisted(() => ({
  assertPassthrough: vi.fn(),
  assertMysqlOnPath: vi.fn(),
  resolveTarget: vi.fn(),
  runBrokered: vi.fn(),
  runMysql: vi.fn(),
  outputError: vi.fn(),
}));

vi.mock('../../../src/commands/mysql/run.js', async importOriginal => {
  const actual = await importOriginal<typeof import('../../../src/commands/mysql/run.js')>();
  return {
    ...actual,
    assertPassthroughAllowed(tokens: readonly string[]): void {
      mocks.assertPassthrough(tokens);
      actual.assertPassthroughAllowed(tokens);
    },
    assertMysqlOnPath: mocks.assertMysqlOnPath,
    runMysql: mocks.runMysql,
  };
});

vi.mock('../../../src/commands/mysql/resolve.js', () => ({
  resolveTarget: mocks.resolveTarget,
}));

vi.mock('../../../src/commands/mysql/broker.js', () => ({
  runBrokered: mocks.runBrokered,
}));

vi.mock('../../../src/lib/output.js', () => ({
  error: mocks.outputError,
}));

import {registerMysqlCommands} from '../../../src/commands/mysql/index.js';

describe('mysql command passthrough preflight', () => {
  let exitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    exitSpy = vi.spyOn(process, 'exit').mockImplementation(code => {
      throw new Error(`process.exit:${String(code)}`);
    });
  });

  afterEach(() => {
    exitSpy.mockRestore();
  });

  it.each([
    ['exec', ['--sql', 'SELECT 1'], ['--print-defaults']],
    ['connect', [], ['-vh127.0.0.1']],
    ['exec', ['--sql', 'SELECT 1', '--database=--print-defaults'], []],
  ])(
    '%s rejects invalid passthrough before PATH, target resolution or lease generation',
    async (subcommand, commandOptions, passthrough) => {
      const program = new Command().enablePositionalOptions().exitOverride();
      registerMysqlCommands(program);

      await expect(program.parseAsync([
        'mysql', subcommand, 'staging-mysql',
        ...commandOptions,
        '--',
        ...passthrough,
      ], {from: 'user'})).rejects.toThrow(/process\.exit:1/);

      expect(mocks.assertPassthrough).toHaveBeenCalledWith(passthrough);
      expect(mocks.assertMysqlOnPath).not.toHaveBeenCalled();
      expect(mocks.resolveTarget).not.toHaveBeenCalled();
      expect(mocks.runBrokered).not.toHaveBeenCalled();
      expect(mocks.runMysql).not.toHaveBeenCalled();
      expect(mocks.outputError).toHaveBeenCalledWith(
        expect.stringMatching(/not allowed|Invalid MySQL database/),
      );
    },
  );
});
