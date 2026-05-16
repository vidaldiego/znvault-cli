// Path: znvault-cli/src/commands/lmk.ts
//
// LMK rotation operational commands. Today this is just `rotation resume`
// (M4 of the zn-api integration hardening plan); future LMK admin
// subcommands (status, list versions, etc.) belong under this same
// `lmk` namespace.

import { type Command } from 'commander';

import { client } from '../lib/client.js';
import * as output from '../lib/output.js';

interface RotationResumeOptions {
  json?: boolean;
}

interface RotationResumeResponse {
  resumed: boolean;
  rotationId?: string;
  fromVersion?: number;
  toVersion?: number;
  total?: number;
  migrated?: number;
  skipped?: number;
  failed?: number;
}

export function registerLmkCommands(program: Command): void {
  const lmk = program
    .command('lmk')
    .description('Local Master Key (LMK) management commands');

  const rotation = lmk
    .command('rotation')
    .description('LMK rotation operations');

  rotation
    .command('resume')
    .description(
      'Resume an interrupted LMK rotation. Use after /v1/health/ready returns ' +
      '503 with reason=lmk_rotation_stuck (operator-visible at startup as a ' +
      'WARN log line).'
    )
    .option('--json', 'Output as JSON')
    .action(async (options: RotationResumeOptions) => {
      const spinner = output.spinner('Resuming LMK rotation...').start();

      try {
        const result = await client.post<RotationResumeResponse>(
          '/v1/admin/lmk/rotation/resume',
          {}
        );
        spinner.stop();

        if (options.json) {
          output.json(result);
          return;
        }

        if (!result.resumed) {
          output.info('No interrupted LMK rotation to resume.');
          return;
        }

        output.section('LMK Rotation Resumed');
        output.keyValue({
          'Rotation ID': result.rotationId ?? '-',
          'From LMK version': result.fromVersion ?? '-',
          'To LMK version': result.toVersion ?? '-',
          'Total DEKs': result.total ?? 0,
          'Migrated (this pass)': result.migrated ?? 0,
          'Skipped (already done)': result.skipped ?? 0,
          'Failed': result.failed ?? 0,
        });

        if ((result.failed ?? 0) > 0) {
          output.warn(
            'Rotation partial: re-wrap completed with failures. complete() was ' +
            'NOT called. Inspect dek_rotation_history and retry once the ' +
            'underlying failures are resolved.'
          );
        } else {
          output.success(
            'Rotation completed. /v1/health/ready should return 200 once the ' +
            'next probe runs.'
          );
        }
      } catch (err) {
        spinner.fail('Failed to resume LMK rotation');
        throw err;
      }
    });
}
