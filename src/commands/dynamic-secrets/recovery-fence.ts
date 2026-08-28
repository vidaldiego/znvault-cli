import {client} from '../../lib/client.js';
import * as output from '../../lib/output.js';
import {positiveSafeInteger, sha256Hex} from './recovery-parse.js';
import type {
  RecoveryFence,
  RecoveryFenceCloseOptions,
  RecoveryFenceOpenOptions,
  RecoveryFenceStatusOptions,
} from './recovery-types.js';

function fencePath(roleId: string, runId: string): string {
  return `/v1/dynamic-secrets/roles/${encodeURIComponent(roleId)}` +
    `/recovery-fences/${encodeURIComponent(runId)}`;
}

function printFence(fence: RecoveryFence): void {
  output.keyValue({
    'Fence ID': fence.fenceId,
    'Run ID': fence.runId,
    'State': fence.state,
    'Fence epoch': fence.fenceEpoch,
    'Close epoch': fence.closeEpoch ?? '-',
    'Role enabled': String(fence.roleEnabled),
    'Role revision': fence.roleRevision,
    'Role config SHA-256': fence.roleConfigSha256,
    'Grant plan SHA-256': fence.grantPlanSha256,
    'In-flight mints': fence.inFlightMints,
    'Active leases': fence.activeLeases,
    'Recovery required': fence.recoveryRequired,
    'Non-terminal operations': fence.nonterminalOperations,
    'Ready permits': fence.readyPermits,
    'Expires': fence.expiresAt,
    'Closed': fence.closedAt ?? '-',
  });
}

export async function openRecoveryFence(
  roleId: string,
  runId: string,
  options: RecoveryFenceOpenOptions,
): Promise<void> {
  const spinner = output.spinner('Opening PostgreSQL-authoritative recovery fence...').start();
  try {
    const response = await client.put<RecoveryFence>(fencePath(roleId, runId), {
      consumerApiKeyId: options.consumerApiKeyId,
      expectedRoleRevision: positiveSafeInteger(
        options.expectedRoleRevision,
        '--expected-role-revision',
      ),
      expectedRoleConfigSha256: sha256Hex(
        options.expectedRoleConfigSha256,
        '--expected-role-config-sha256',
      ),
      expiresInSeconds: positiveSafeInteger(options.expiresInSeconds, '--expires-in-seconds'),
      purpose: options.purpose,
    });
    spinner.succeed('Recovery fence opened');
    if (options.json) output.json(response);
    else printFence(response);
  } catch (err) {
    spinner.fail('Failed to open recovery fence');
    output.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}

export async function getRecoveryFenceStatus(
  roleId: string,
  runId: string,
  options: RecoveryFenceStatusOptions,
): Promise<void> {
  const spinner = output.spinner('Fetching recovery fence...').start();
  try {
    const response = await client.get<RecoveryFence>(fencePath(roleId, runId));
    spinner.stop();
    if (options.json) output.json(response);
    else printFence(response);
  } catch (err) {
    spinner.fail('Failed to fetch recovery fence');
    output.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}

export async function closeRecoveryFence(
  roleId: string,
  runId: string,
  options: RecoveryFenceCloseOptions,
): Promise<void> {
  const spinner = output.spinner('Closing and verifying recovery fence...').start();
  try {
    const response = await client.put<RecoveryFence>(`${fencePath(roleId, runId)}/close`, {
      expectedFenceEpoch: positiveSafeInteger(options.expectedFenceEpoch, '--expected-fence-epoch'),
    });
    spinner.succeed('Recovery fence closed and verified');
    if (options.json) output.json(response);
    else printFence(response);
  } catch (err) {
    spinner.fail('Failed to close recovery fence');
    output.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}
