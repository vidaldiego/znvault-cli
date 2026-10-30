import {Command} from 'commander';
import {afterEach, describe, expect, it, vi} from 'vitest';
import {registerSuperadminCommands} from '../../src/commands/superadmin/index.js';
import {client} from '../../src/lib/client.js';
import * as output from '../../src/lib/output.js';
afterEach(() => {vi.restoreAllMocks();process.exitCode = undefined;});
function program() {const p = new Command();p.exitOverride();registerSuperadminCommands(p);return p;}
describe('superadmin CLI recovery gate adapter', () => {
  it('exposes status and epoch-guarded enable/disable without another authority', () => {
    const command = program().commands[0].commands.find(x => x.name() === 'cli-recovery');
    expect(command).toBeDefined();
    expect(command?.commands.map(x => x.name())).toEqual(['status', 'enable', 'disable']);
    expect(command?.commands.filter(x => x.name() !== 'status').every(x => x.options.some(o => o.long === '--expected-epoch' && o.mandatory))).toBe(true);
  });
  it('forwards only enabled and expectedEpoch to the existing server route', async () => {
    vi.spyOn(output, 'json').mockImplementation(() => {});
    const post = vi.spyOn(client, 'post').mockResolvedValue({enabled: true, epoch: 7, rollbackReady: false});
    await program().parseAsync(['node', 'test', 'superadmin', 'cli-recovery', 'enable', '--expected-epoch', '6', '--json']);
    expect(post).toHaveBeenCalledExactlyOnceWith('/v1/superadmin/auth/cli-recovery-protocol', {enabled: true, expectedEpoch: 6});
    await expect(program().parseAsync(['node', 'test', 'superadmin', 'cli-recovery', 'disable']))
      .rejects.toMatchObject({code: 'commander.missingMandatoryOptionValue'});
  });
});
