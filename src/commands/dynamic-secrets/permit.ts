import {client} from '../../lib/client.js';
import * as output from '../../lib/output.js';
import {idempotencyUuid, positiveSafeInteger} from './recovery-parse.js';
import type {
  MintOperation,
  MintPermit,
  PermitIssueOptions,
  PermitLookupOptions,
  PermitRevokeOptions,
  PermitStatusOptions,
} from './recovery-types.js';

function printPermit(permit: MintPermit): void {
  output.keyValue({
    'Permit ID': permit.permitId,
    'Fence ID': permit.fenceId,
    'Fence epoch': permit.fenceEpoch,
    'State': permit.state,
    'Consumer API key': permit.consumerApiKeyId,
    'Phase': permit.phase,
    'Overlay': permit.privilegeOverlay,
    'Mints': `${permit.mintsConsumed.toString()}/${permit.maxMints.toString()}`,
    'Credential TTL': `${permit.credentialTtlSeconds.toString()}s`,
    'Expires': permit.expiresAt,
    'Role revision': permit.roleRevision,
    'Role config SHA-256': permit.roleConfigSha256,
    'Effective grant plan SHA-256': permit.effectiveGrantPlanSha256,
  });
}

function printOperation(operation: MintOperation): void {
  output.keyValue({
    'Operation ID': operation.operationId,
    'Permit ID': operation.permitId,
    'Request ID': operation.requestId,
    'State': operation.state,
    'Fence ID': operation.fenceId,
    'Fence epoch': operation.fenceEpoch,
    'Role ID': operation.roleId,
    'Role revision': operation.roleRevision,
    'Lease ID': operation.leaseId ?? '-',
    'Credential expires': operation.credentialExpiresAt ?? '-',
    'Last error': operation.lastErrorCode ?? '-',
  });
}

export async function issueMintPermit(roleId: string, options: PermitIssueOptions): Promise<void> {
  const spinner = output.spinner('Issuing one-shot recovery mint permit...').start();
  try {
    if (
      options.privilegeOverlay !== 'NONE'
      && options.privilegeOverlay !== 'MYSQL_SCHEMA_LOCK_TABLES'
    ) {
      throw new Error(
        '--privilege-overlay must be NONE or MYSQL_SCHEMA_LOCK_TABLES',
      );
    }
    const privilegeOverlay = options.privilegeOverlay;
    const response = await client.request<MintPermit>({
      method: 'POST',
      path: `/v1/dynamic-secrets/roles/${encodeURIComponent(roleId)}/mint-permits`,
      headers: {'Idempotency-Key': idempotencyUuid(options.idempotencyKey)},
      body: {
        fenceId: options.fenceId,
        consumerApiKeyId: options.consumerApiKeyId,
        phase: options.phase,
        expiresInSeconds: positiveSafeInteger(options.expiresInSeconds, '--expires-in-seconds'),
        credentialTtlSeconds: positiveSafeInteger(
          options.credentialTtlSeconds,
          '--credential-ttl-seconds',
        ),
        privilegeOverlay,
        reason: options.reason,
      },
    });
    spinner.succeed('Recovery mint permit issued');
    if (options.json) output.json(response);
    else printPermit(response);
  } catch (err) {
    spinner.fail('Failed to issue recovery mint permit');
    output.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}

export async function lookupMintPermit(
  roleId: string,
  options: PermitLookupOptions,
): Promise<void> {
  const spinner = output.spinner('Looking up recovery mint permit...').start();
  try {
    const response = await client.request<MintPermit>({
      method: 'GET',
      path:
        `/v1/dynamic-secrets/roles/${encodeURIComponent(roleId)}` +
        '/mint-permits/by-idempotency-key',
      headers: {'Idempotency-Key': idempotencyUuid(options.idempotencyKey)},
    });
    spinner.stop();
    if (options.json) output.json({found: true, permit: response});
    else printPermit(response);
  } catch (err) {
    const failure = err as {statusCode?: number; errorCode?: string};
    if (failure.statusCode === 404 && failure.errorCode === 'recovery_permit_not_found') {
      spinner.stop();
      const absent = {
        found: false,
        roleId,
        idempotencyKey: idempotencyUuid(options.idempotencyKey),
      };
      if (options.json) output.json(absent);
      else output.keyValue({'Permit': 'not issued'});
      return;
    }
    spinner.fail('Failed to look up recovery mint permit');
    output.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}

export async function getMintOperationStatus(
  permitId: string,
  requestId: string,
  options: PermitStatusOptions,
): Promise<void> {
  const spinner = output.spinner('Fetching recovery mint operation...').start();
  try {
    const response = await client.get<MintOperation>(
      `/v1/dynamic-secrets/mint-permits/${encodeURIComponent(permitId)}` +
      `/operations/${encodeURIComponent(requestId)}`,
    );
    spinner.stop();
    if (options.json) output.json(response);
    else printOperation(response);
  } catch (err) {
    spinner.fail('Failed to fetch recovery mint operation');
    output.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}

export async function revokeMintOperation(
  permitId: string,
  requestId: string,
  options: PermitRevokeOptions,
): Promise<void> {
  const spinner = output.spinner('Revoking recovery mint operation...').start();
  try {
    const response = await client.put<MintOperation>(
      `/v1/dynamic-secrets/mint-permits/${encodeURIComponent(permitId)}` +
      `/operations/${encodeURIComponent(requestId)}/revoke`,
      options.reason ? {reason: options.reason} : {},
    );
    spinner.succeed('Recovery mint operation revoked');
    if (options.json) output.json(response);
    else printOperation(response);
  } catch (err) {
    spinner.fail('Failed to revoke recovery mint operation');
    output.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}
