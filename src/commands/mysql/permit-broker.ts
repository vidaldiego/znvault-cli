/** Secure consumer lifecycle for `znvault mysql exec-permit`. */

import {client} from '../../lib/client.js';
import {createMyCnf, type MyCnfHandle} from './mycnf.js';
import {runMysql} from './run.js';
import {
  generateEphemeralRecoveryRecipient,
  openRecoveryCredential,
  type RecoveryCredentialPlaintext,
} from './recovery-hpke.js';
import type {
  MintOperation,
  RecoveryHpkeCredential,
} from '../dynamic-secrets/recovery-types.js';

const RETRY_DELAYS_MS = [250, 1_000, 2_000];
const TERMINAL_STATES = new Set([
  'REVOKED',
  'EXPIRED_REVOKED',
  'CANCELLED_NO_TARGET',
  'FAILED_NO_TARGET',
]);

interface HttpError extends Error {
  statusCode?: number;
}

export interface ExecPermitOptions {
  permitId: string;
  requestId: string;
  fenceEpoch: number;
  files?: string[];
  passthrough?: string[];
  run?: (opts: {
    fd: number;
    fdPath: string;
    database: string;
    files?: string[];
    passthrough?: string[];
  }) => Promise<number>;
}

export interface ExecPermitResult {
  permitId: string;
  requestId: string;
  operationId: string;
  deliveryState: 'DELIVERED';
  mysqlExitCode: number;
  revokeState: MintOperation['state'];
  envelopeSha256: string;
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function statusCode(error: unknown): number | undefined {
  return (error as HttpError | undefined)?.statusCode;
}

function isRetryable(error: unknown): boolean {
  const status = statusCode(error);
  return status === undefined || status >= 500;
}

async function retrySameRequest<T>(request: () => Promise<T>): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    try {
      return await request();
    } catch (error) {
      lastError = error;
      if (!isRetryable(error) || attempt === RETRY_DELAYS_MS.length) throw error;
      await sleep(RETRY_DELAYS_MS[attempt] ?? 2_000);
    }
  }
  throw lastError;
}

function operationPath(permitId: string, requestId: string): string {
  return `/v1/dynamic-secrets/mint-permits/${encodeURIComponent(permitId)}` +
    `/operations/${encodeURIComponent(requestId)}`;
}

async function fetchCredential(
  permitId: string,
  requestId: string,
): Promise<RecoveryHpkeCredential> {
  return await retrySameRequest(async () => await client.get<RecoveryHpkeCredential>(
    `${operationPath(permitId, requestId)}/credential`,
  ));
}

async function acknowledgeCredential(
  permitId: string,
  requestId: string,
  envelopeSha256: string,
): Promise<MintOperation> {
  return await retrySameRequest(async () => await client.put<MintOperation>(
    `${operationPath(permitId, requestId)}/delivery-ack`,
    {envelopeSha256},
  ));
}

export async function revokePermitOperationWithRetry(
  permitId: string,
  requestId: string,
  reason: string,
): Promise<MintOperation | null> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    try {
      return await client.put<MintOperation>(`${operationPath(permitId, requestId)}/revoke`, {
        reason,
      });
    } catch (error) {
      const status = statusCode(error);
      let retry = isRetryable(error);
      // A terminal-state race is safe. Fetch the state so the receipt is exact.
      if (status === 409) {
        try {
          const current = await client.get<MintOperation>(operationPath(permitId, requestId));
          if (TERMINAL_STATES.has(current.state)) return current;
          retry = true;
        } catch {
          retry = true;
        }
      }
      lastError = error;
      if (!retry || attempt === RETRY_DELAYS_MS.length) break;
      await sleep(RETRY_DELAYS_MS[attempt] ?? 2_000);
    }
  }
  const message = lastError instanceof Error ? lastError.message : 'unknown API failure';
  console.warn(
    `[znvault] WARN: revoke by requestId did not complete for permit ${permitId}, ` +
    `request ${requestId}. Retry with 'znvault dynasec permit revoke'. Last error: ${message}`,
  );
  return null;
}

function clearCredential(credential: RecoveryCredentialPlaintext | undefined): void {
  if (!credential) return;
  credential.username = '';
  credential.password = '';
  credential.host = '';
  credential.database = '';
  credential.expiresAt = '';
  credential.port = 0;
}

function assertDeliverableOperation(
  operation: MintOperation,
  permitId: string,
  requestId: string,
  fenceEpoch: number,
): void {
  if (
    operation.permitId !== permitId
    || operation.requestId !== requestId
    || operation.fenceEpoch !== fenceEpoch
  ) {
    throw new Error('Recovery operation response does not match permit, request, or fence epoch');
  }
  if (operation.state !== 'CONSUMED' && operation.state !== 'DELIVERED') {
    throw new Error(
      `Recovery operation is ${operation.state}; no credential is safe to execute`,
    );
  }
}

/**
 * Consume, decrypt, ACK, execute, and revoke one one-shot recovery permit.
 * Password material exists only in the HPKE plaintext buffer/object and an
 * already-unlinked my.cnf inode inherited by the mysql child.
 */
export async function runExecPermit(options: ExecPermitOptions): Promise<ExecPermitResult> {
  const recipient = await generateEphemeralRecoveryRecipient();
  const consumeBody = Object.freeze({
    fenceEpoch: options.fenceEpoch,
    recipientKeyId: recipient.recipientKeyId,
    recipientPublicKey: recipient.recipientPublicKey,
    deliveryFormat: 'hpke-v1' as const,
  });

  let cleanupArmed = true;
  let cleanupPromise: Promise<boolean> | undefined;
  let operation: MintOperation | undefined;
  let delivery: RecoveryHpkeCredential | undefined;
  let credential: RecoveryCredentialPlaintext | undefined;
  let cnf: MyCnfHandle | undefined;
  let revokeState: MintOperation['state'] = 'RECOVERY_REQUIRED';

  const cleanup = (reason: string): Promise<boolean> => {
    cleanupPromise ??= (async () => {
      cnf?.cleanup();
      clearCredential(credential);
      if (!cleanupArmed) return true;
      const revoked = await revokePermitOperationWithRetry(
        options.permitId,
        options.requestId,
        reason,
      );
      if (revoked) {
        revokeState = revoked.state;
        return TERMINAL_STATES.has(revoked.state);
      }
      return false;
    })();
    return cleanupPromise;
  };

  const onSignal = (exitCode: number): (() => void) => () => {
    void (async () => {
      await cleanup('znvault_mysql_exec_permit_signal');
      process.exit(exitCode);
    })();
  };
  const onSIGINT = onSignal(130);
  const onSIGTERM = onSignal(143);
  const onSIGHUP = onSignal(129);
  const onUncaughtException = (): void => {
    console.error('[znvault] Recovery mysql execution aborted by an uncaught exception');
    void (async () => {
      await cleanup('znvault_mysql_exec_permit_uncaught_exception');
      process.exit(1);
    })();
  };

  process.once('SIGINT', onSIGINT);
  process.once('SIGTERM', onSIGTERM);
  process.once('SIGHUP', onSIGHUP);
  process.once('uncaughtException', onUncaughtException);

  try {
    const consumeAttempt = {hadUncertainFailure: false};
    try {
      operation = await retrySameRequest(async () => {
        try {
          return await client.put<MintOperation>(
            operationPath(options.permitId, options.requestId),
            consumeBody,
          );
        } catch (error) {
          if (isRetryable(error)) consumeAttempt.hadUncertainFailure = true;
          throw error;
        }
      });
    } catch (error) {
      // A definitive client error means the server rejected the consume before
      // creating this operation. Do not burn the permit with a tombstone. For
      // network/5xx ambiguity cleanup remains armed and revoke is mandatory.
      const status = statusCode(error);
      if (
        !consumeAttempt.hadUncertainFailure
        && status !== undefined
        && status >= 400
        && status < 500
      ) {
        cleanupArmed = false;
      }
      throw error;
    }
    assertDeliverableOperation(
      operation,
      options.permitId,
      options.requestId,
      options.fenceEpoch,
    );

    delivery = operation.credential ?? await fetchCredential(options.permitId, options.requestId);
    credential = await openRecoveryCredential({delivery, operation, recipient});

    // Materialize the credential only into the already-unlinked option-file
    // inode before ACK. If this fails, MySQL is never invoked and revoke runs.
    cnf = await createMyCnf({
      user: credential.username,
      password: credential.password,
      host: credential.host,
      port: credential.port,
    });

    const acknowledged = await acknowledgeCredential(
      options.permitId,
      options.requestId,
      delivery.envelopeSha256,
    );
    if (acknowledged.state !== 'DELIVERED') {
      throw new Error(`Recovery delivery ACK returned unexpected state ${acknowledged.state}`);
    }

    const run = options.run ?? (async args => await runMysql({
      fd: args.fd,
      fdPath: args.fdPath,
      database: args.database,
      mode: 'exec',
      files: args.files,
      passthrough: args.passthrough,
    }));
    const mysqlExitCode = await run({
      fd: cnf.fd,
      fdPath: cnf.fdPath,
      database: credential.database,
      files: options.files,
      passthrough: options.passthrough,
    });
    const revoked = await cleanup('znvault_mysql_exec_permit_complete');
    if (!revoked) {
      throw new Error(
        'MySQL completed, but revoke by requestId is not proven; run dynasec permit revoke immediately',
      );
    }
    return {
      permitId: options.permitId,
      requestId: options.requestId,
      operationId: operation.operationId,
      deliveryState: 'DELIVERED',
      mysqlExitCode,
      revokeState,
      envelopeSha256: delivery.envelopeSha256,
    };
  } finally {
    process.off('SIGINT', onSIGINT);
    process.off('SIGTERM', onSIGTERM);
    process.off('SIGHUP', onSIGHUP);
    process.off('uncaughtException', onUncaughtException);
    await cleanup('znvault_mysql_exec_permit_failure');
  }
}
