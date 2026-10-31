import type {Command} from 'commander';
import type {Readable} from 'node:stream';
import {promptPassword} from '../lib/prompts.js';
import * as output from '../lib/output.js';
import {withApprovalSession, approveWithIPhone, approveWithTOTP, getApprovalStatus, closeUserSealedAccess,
  type ApprovalKind, type ApprovalResult, type UnsealScope} from '../lib/session-approval.js';

interface ApprovalOptions {iphone?: boolean; iphoneDevice?: string; otp?: boolean; otpStdin?: boolean; json?: boolean; scope?: UnsealScope}

export async function readApprovalCode(fromStdin: boolean, input: Readable = process.stdin): Promise<string> {
  if (!fromStdin) {
    if (!process.stdin.isTTY) throw new Error('SESSION_APPROVAL_OTP_STDIN_REQUIRED');
    return await promptPassword('TOTP code');
  }
  if (input === process.stdin && process.stdin.isTTY) throw new Error('SESSION_APPROVAL_OTP_STDIN_REQUIRED');
  let text = '';
  for await (const chunk of input) {
    text += String(chunk);
    if (Buffer.byteLength(text) > 64) throw new Error('SESSION_APPROVAL_INVALID_TOTP');
  }
  if (!/^\d{6}(?:\r?\n)?$/.test(text)) throw new Error('SESSION_APPROVAL_INVALID_TOTP');
  return text.trim();
}

const guidance: Record<string, string> = {
  SECRET_REQUIRES_USER_SESSION: 'Run znvault login with password or a linked PRF passkey to make the primary key available.',
  USER_SEALED_APPROVAL_REQUIRED: 'Run znvault user-sealed approve --iphone or --otp, then explicitly repeat the operation.',
  SESSION_APPROVAL_HUMAN_SESSION_REQUIRED: 'Use a named profile with a HUMAN login; remove ambient API key or password authentication.',
  SESSION_APPROVAL_CONTEXT_CHANGED: 'The profile, Vault or login changed. Start a new approval in the intended profile.',
  SESSION_APPROVAL_METHOD_REQUIRED: 'Choose exactly one method: --iphone or --otp. Use --otp-stdin for automation input.',
  SESSION_APPROVAL_OTP_STDIN_REQUIRED: 'Interactive OTP requires a terminal. Pipe one six-digit code with --otp-stdin.',
  SESSION_APPROVAL_SELECT_IPHONE: 'More than one iPhone is ready. Select one with --iphone-device <id>.',
  SESSION_APPROVAL_OUTCOME_UNKNOWN: 'The response was lost. Check status before starting another approval.',
};

export function reportApprovalError(error: unknown, json?: boolean): void {
  const value = error as {name?: string; errorCode?: string; message?: string};
  const code = value.name === 'AbortError' ? 'SESSION_APPROVAL_CANCELLED'
    : value.errorCode?.match(/^[A-Z][A-Z0-9_]+$/)?.[0]
      ?? value.message?.match(/^[A-Z][A-Z0-9_]+(?=:|$)/)?.[0] ?? 'SESSION_APPROVAL_FAILED';
  const message = guidance[code] ?? code;
  if (json) output.json({error: code, message});
  else output.error(`${code}: ${message}`);
  process.exitCode = 1;
}

function displayResult(result: ApprovalResult, json?: boolean): void {
  if (json) {output.json(result); return;}
  if (result.approval) {
    output.info(`Primary key: ${result.unlocked === undefined ? 'unchanged' : result.unlocked ? 'available' : 'locked'}`);
    output.info(`User-Sealed approval: ${result.approval.approved ? `until ${result.approval.expiresAt ?? 'unknown'}` : 'closed'}`);
  } else output.info(`Unseal: ${result.unsealed ? `until ${result.unsealedUntil ?? 'unknown'}` : 'closed'}`);
}

/** SIGINT cancels only this request; it never clears the profile's login or pairing. */
export async function runIPhoneApproval(kind: ApprovalKind, options: ApprovalOptions): Promise<void> {
  const controller = new AbortController();
  const interrupt = (): void => {controller.abort();};
  process.on('SIGINT', interrupt);
  try {
    const result = await withApprovalSession(async session => await approveWithIPhone(session, kind, {
      deviceId: options.iphoneDevice, scope: options.scope, signal: controller.signal,
      onPending: value => {
        console.error(`Approve ${kind === 'unseal' ? `${options.scope ?? 'crypto'} unseal` : 'User-Sealed access'} for ${JSON.stringify(value.account)} at ${value.origin}.`);
        console.error(`Approve on your iPhone; if an older app requests a number, use ${value.comparisonNumber}. Expires ${new Date(value.expiresAt * 1000).toISOString()}.`);
      },
    }));
    displayResult(result, options.json);
  } finally {process.removeListener('SIGINT', interrupt);}
}

export function registerUserSealedCommands(program: Command): void {
  const command = program.command('user-sealed').description('Manage the additional approval window in this HUMAN session');
  command.command('approve').description('Approve User-Sealed access for 15 minutes; the primary key must already be available')
    .option('--iphone', 'Approve with a paired iPhone')
    .option('--iphone-device <id>', 'Select a ready iPhone')
    .option('--otp', 'Prompt for the current TOTP code; never use a stored seed')
    .option('--otp-stdin', 'Read one six-digit TOTP code from stdin explicitly')
    .option('--json', 'Output one JSON result; iPhone instructions go to stderr')
    .action(async (options: ApprovalOptions) => {
      try {
        if (Number(!!options.iphone) + Number(options.otp === true || options.otpStdin === true) !== 1
          || (options.iphoneDevice && !options.iphone)) throw new Error('SESSION_APPROVAL_METHOD_REQUIRED');
        if (options.iphone) await runIPhoneApproval('user-sealed', options);
        else {
          const result = await withApprovalSession(async session => await approveWithTOTP(session, 'user-sealed',
            async () => await readApprovalCode(!!options.otpStdin)));
          displayResult(result, options.json);
        }
      } catch (error) {reportApprovalError(error, options.json);}
    });
  for (const action of ['status', 'close'] as const) {
    command.command(action).description(action === 'status' ? 'Check primary key and approval independently' : 'Close User-Sealed approval, preserving the primary key')
      .option('--json', 'Output as JSON')
      .action(async (options: ApprovalOptions) => {
        try {
          const result = await withApprovalSession(async session => action === 'status'
            ? await getApprovalStatus(session, 'user-sealed') : await closeUserSealedAccess(session));
          displayResult(result, options.json);
        } catch (error) {reportApprovalError(error, options.json);}
      });
  }
}
