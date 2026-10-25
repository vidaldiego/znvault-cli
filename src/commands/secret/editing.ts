import inquirer from 'inquirer';
import {parseTotpInput, readTotpConfig} from '../../lib/totp.js';
import {readStdinUtf8} from '../../lib/stdin.js';
import {interactiveSecretValuePromptType} from './input-policy.js';
import type {DecryptedSecret} from './types.js';

/** Only messages authored here may pass through secret-value error output. */
export class SecretInputError extends Error {}

export function safeSecretError(error: unknown): string {
  if (error instanceof SecretInputError) return error.message;
  if (error instanceof Error && error.message === 'Invalid TOTP configuration.') return error.message;
  const details = error as {statusCode?: number; errorCode?: string} | undefined;
  if (details?.errorCode === 'SECRET_VERSION_CONFLICT') return 'SECRET_VERSION_CONFLICT: Secret changed; read the latest version and retry.';
  if (details?.statusCode === 401 || details?.statusCode === 403) return 'Secret access denied.';
  if (details?.statusCode === 404) return 'Secret or conditional-write endpoint not found. Check the identifier and server support.';
  return 'Secret operation failed.';
}

export function requireSecretObject(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new SecretInputError('Secret data must be a JSON object.');
  }
  return value as Record<string, unknown>;
}

export function requireEditableSecret(secret: DecryptedSecret, allowLink = false): void {
  if (secret.replication?.readonly === true || secret.replication?.role === 'replica') {
    throw new SecretInputError('Replicated secrets are read-only; edit the source secret.');
  }
  if (!allowLink && secret.subType === 'link') throw new SecretInputError('Link pointers cannot be edited with this command.');
  if (!Number.isInteger(secret.version) || secret.version < 1) throw new SecretInputError('Secret decrypt did not return a valid version.');
  requireSecretObject(secret.data);
}

export async function readSecretJsonStdin(): Promise<Record<string, unknown>> {
  try {
    return requireSecretObject(JSON.parse(await readStdinUtf8()));
  } catch {
    throw new SecretInputError('Invalid JSON received by --data-stdin');
  }
}

/** Hide the canonical authenticator from tempfile-backed content editors. */
export function secretEditorData(data: Record<string, unknown>): Record<string, unknown> {
  const result = {...data};
  if (readTotpConfig(data)) delete result.totp;
  return result;
}

/** Merge only edited fields and keep the authenticator outside generic editors. */
export function mergeSecretEdits(data: Record<string, unknown>, edits: Record<string, unknown>): Record<string, unknown> {
  const config = readTotpConfig(data);
  if (config && Object.hasOwn(edits, 'totp') && JSON.stringify(edits.totp) !== JSON.stringify(data.totp)) {
    throw new SecretInputError('Use secret totp import --attach to replace an attached authenticator.');
  }
  return {...data, ...edits, ...(config ? {totp: data.totp} : {})};
}

export async function promptSecretReplacement(current: DecryptedSecret): Promise<Record<string, unknown>> {
  if (current.subType === 'totp') {
    const {seedOrUri} = await inquirer.prompt<{seedOrUri: string}>([{
      type: 'password', name: 'seedOrUri', message: 'New TOTP seed or otpauth URI:', mask: '*',
    }]);
    return {...current.data, totp: parseTotpInput(seedOrUri)};
  }
  const {dataJson} = await inquirer.prompt<{dataJson: string}>([{
    type: interactiveSecretValuePromptType(current.protectionMode, 'editor'),
    name: 'dataJson', message: 'Edit secret data (JSON; attached authenticator is preserved):',
    ...(current.protectionMode === 'USER_SESSION_ONLY'
      ? {mask: '*'}
      : {default: JSON.stringify(secretEditorData(current.data), null, 2)}),
  }]);
  try {
    return mergeSecretEdits(current.data, requireSecretObject(JSON.parse(dataJson)));
  } catch (error) {
    if (error instanceof SecretInputError) throw error;
    throw new SecretInputError('Invalid JSON data');
  }
}
