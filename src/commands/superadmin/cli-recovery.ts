import {InvalidArgumentError, type Command} from 'commander';
import {client} from '../../lib/client.js';
import * as output from '../../lib/output.js';
interface Status {enabled: boolean; epoch: number; rollbackReady: boolean}
const path = '/v1/superadmin/auth/cli-recovery-protocol';
function epoch(value: string): number {
  const number = Number(value);
  if (!/^[1-9][0-9]*$/.test(value) || !Number.isSafeInteger(number)) throw new InvalidArgumentError('Expected a positive integer epoch.');
  return number;
}
async function show(operation: () => Promise<Status>, json?: boolean): Promise<void> {
  try {
    const result = await operation();
    if (typeof result.enabled !== 'boolean' || !Number.isSafeInteger(result.epoch) || result.epoch < 1 || typeof result.rollbackReady !== 'boolean') throw new Error('Invalid status');
    const safe = {enabled: result.enabled, epoch: result.epoch, rollbackReady: result.rollbackReady};
    if (json) output.json(safe);else output.keyValue(safe);
  } catch {output.error('CLI recovery protocol operation failed. Check the Vault status and expected epoch.');process.exitCode = 1;}
}
export function registerCliRecoveryCommands(parent: Command): void {
  const group = parent.command('cli-recovery').description('Inspect or change bounded CLI recovery (superadmin only)');
  group.command('status').option('--json', 'Output public protocol status').action(async (options: {json?: boolean}) => {
    await show(async () => await client.get<Status>(path), options.json);
  });
  for (const enabled of [true, false]) {
    group.command(enabled ? 'enable' : 'disable').requiredOption('--expected-epoch <number>', 'Current protocol epoch', epoch)
      .option('--json', 'Output public protocol status').action(async (options: {expectedEpoch: number; json?: boolean}) => {
        await show(async () => await client.post<Status>(path, {enabled, expectedEpoch: options.expectedEpoch}), options.json);
      });
  }
}
