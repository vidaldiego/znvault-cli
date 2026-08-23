// Path: znvault-cli/src/commands/lmk.ts
//
// LMK rotation operational commands.
//
// Subcommands under `znvault lmk rotation`:
//   start    POST /v1/admin/lmk/rotate (initiate, with destructive-confirm)
//   resume   POST /v1/admin/lmk/rotation/resume
//   list     GET  /v1/admin/lmk/rotations
//   show     GET  /v1/admin/lmk/rotation/:rotationId
//   cancel   POST /v1/admin/lmk/rotation/:rotationId/cancel
//
// Direct alias: `znvault lmk rotate` → same as `lmk rotation start`.

import { type Command } from 'commander';

import { client } from '../lib/client.js';
import * as output from '../lib/output.js';
import { promptConfirm } from '../lib/prompts.js';
import { registerLmkEscrowCommands } from './lmk-escrow.js';
import { registerLmkRestoreDrillCommands } from './lmk-restore-drill.js';

interface JsonOption {
  json?: boolean;
}

interface RotateOptions extends JsonOption {
  description?: string;
  manual?: boolean;
  force?: boolean;
}

interface CancelOptions extends JsonOption {
  reason?: string;
  force?: boolean;
}

interface ListOptions extends JsonOption {
  limit?: string;
  offset?: string;
}

interface RotateAutomaticResponse {
  success: boolean;
  rotationId: string;
  newLmkVersion: number;
  deksMigrated?: number;
  deksFailed?: number;
  status: string;
}

interface RotateManualResponse {
  success: boolean;
  rotationId: string;
  newLmkVersion: number;
  deksToMigrate?: number;
  status: string;
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

interface RotationProgress {
  rotationId: string;
  status: string;
  startedAt: string;
  completedAt?: string;
  newLmkVersion: number;
  oldLmkVersion: number;
  totalDeks: number;
  deksMigrated: number;
  deksFailed: number;
  errors?: unknown[];
  description?: string;
  initiatedBy?: string;
}

interface RotationListItem {
  rotationId: string;
  status: string;
  startedAt: string;
  completedAt?: string;
  newLmkVersion: number;
  oldLmkVersion: number;
  totalDeks: number;
  migratedDeks: number;
  failedDeks: number;
  description?: string;
  initiatedBy?: string;
}

interface RotationListResponse {
  rotations: RotationListItem[];
  total: number;
  limit: number;
  offset: number;
}

interface CancelResponse {
  success: boolean;
  message: string;
}

interface RootCAUpgradeResponse {
  result: 'upgraded' | 'already-v2' | 'no-root-ca';
}

interface RootCAReissueResponse {
  applied: boolean;
  plan: {
    oldRoot: { id: string; fingerprint: string; unrecoverable: boolean };
    newRoot: { subjectDn: string; keyType: string; validityYears: number };
    intermediates: Array<{
      caId: string;
      tenantId: string;
      oldFingerprint: string;
      newFingerprint: string;
      chainVerified: boolean;
    }>;
  };
}

interface ReissueOptions extends JsonOption {
  apply?: boolean;
  force?: boolean;
  fingerprint?: string;
}

export function registerLmkCommands(program: Command): void {
  const lmk = program
    .command('lmk')
    .description('Local Master Key (LMK) management commands');

  registerLmkEscrowCommands(lmk);
  registerLmkRestoreDrillCommands(lmk);

  const rotation = lmk
    .command('rotation')
    .description('LMK rotation operations');

  // -------------------------------------------------------------------------
  // lmk rotation start
  // -------------------------------------------------------------------------
  rotation
    .command('start')
    .description(
      'Start an LMK rotation. Creates a new LMK version and re-wraps all ' +
      'DEKs. Operator-only; requires confirmation unless --force.'
    )
    .option('-d, --description <text>', 'Free-text description of why this rotation is being run')
    .option(
      '--manual',
      'Only initiate (do not auto-run re-wrap or complete). Useful for ' +
      'staged rotations on large clusters; follow up with `lmk rotation resume`.'
    )
    .option('-f, --force', 'Skip confirmation prompt')
    .option('--json', 'Output as JSON')
    .action(async (options: RotateOptions) => {
      await runStart(options);
    });

  // -------------------------------------------------------------------------
  // lmk rotate  (top-level alias for `lmk rotation start`)
  // -------------------------------------------------------------------------
  lmk
    .command('rotate')
    .description('Alias for `lmk rotation start`')
    .option('-d, --description <text>', 'Free-text description of why this rotation is being run')
    .option('--manual', 'Only initiate (do not auto-run re-wrap or complete)')
    .option('-f, --force', 'Skip confirmation prompt')
    .option('--json', 'Output as JSON')
    .action(async (options: RotateOptions) => {
      await runStart(options);
    });

  // -------------------------------------------------------------------------
  // lmk rotation resume
  // -------------------------------------------------------------------------
  rotation
    .command('resume')
    .description(
      'Resume an interrupted LMK rotation. Use after /v1/health/ready returns ' +
      '503 with reason=lmk_rotation_stuck (operator-visible at startup as a ' +
      'WARN log line).'
    )
    .option('--json', 'Output as JSON')
    .action(async (options: JsonOption) => {
      const spinner = output.spinner('Resuming LMK rotation...').start();

      try {
        const result = await client.post<RotationResumeResponse>(
          '/v1/admin/lmk/rotation/resume',
          {}
        );
        spinner.stop();

        if (options.json === true) {
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

  // -------------------------------------------------------------------------
  // lmk rotation list
  // -------------------------------------------------------------------------
  rotation
    .command('list')
    .description('List historical LMK rotations.')
    .option('--limit <n>', 'Page size (default 50)')
    .option('--offset <n>', 'Page offset (default 0)')
    .option('--json', 'Output as JSON')
    .action(async (options: ListOptions) => {
      const limit = options.limit !== undefined ? parseInt(options.limit, 10) : 50;
      const offset = options.offset !== undefined ? parseInt(options.offset, 10) : 0;
      const query = `?limit=${limit}&offset=${offset}`;

      const result = await client.get<RotationListResponse>(
        `/v1/admin/lmk/rotations${query}`
      );

      if (options.json === true) {
        output.json(result);
        return;
      }

      if (result.rotations.length === 0) {
        output.info('No LMK rotations recorded.');
        return;
      }

      output.section(`LMK Rotations (${result.rotations.length}/${result.total})`);
      output.table(
        ['Rotation ID', 'Status', 'Old → New', 'DEKs (mig/fail/total)', 'Started', 'By'],
        result.rotations.map((r) => [
          r.rotationId,
          r.status,
          `${r.oldLmkVersion} → ${r.newLmkVersion}`,
          `${r.migratedDeks}/${r.failedDeks}/${r.totalDeks}`,
          output.formatDate(r.startedAt),
          r.initiatedBy ?? '-',
        ])
      );
    });

  // -------------------------------------------------------------------------
  // lmk rotation show <rotationId>
  // -------------------------------------------------------------------------
  rotation
    .command('show <rotationId>')
    .description('Show details of a single LMK rotation.')
    .option('--json', 'Output as JSON')
    .action(async (rotationId: string, options: JsonOption) => {
      const result = await client.get<RotationProgress>(
        `/v1/admin/lmk/rotation/${rotationId}`
      );

      if (options.json === true) {
        output.json(result);
        return;
      }

      output.section(`LMK Rotation ${result.rotationId}`);
      output.keyValue({
        'Status': result.status,
        'Old LMK version': result.oldLmkVersion,
        'New LMK version': result.newLmkVersion,
        'DEKs total': result.totalDeks,
        'DEKs migrated': result.deksMigrated,
        'DEKs failed': result.deksFailed,
        'Started': output.formatDate(result.startedAt),
        'Completed': result.completedAt !== undefined ? output.formatDate(result.completedAt) : '-',
        'Description': result.description ?? '-',
        'Initiated by': result.initiatedBy ?? '-',
      });

      if (result.errors !== undefined && result.errors.length > 0) {
        output.warn(`${result.errors.length} per-DEK errors recorded; see audit log / dek_rotation_history.`);
      }
    });

  // -------------------------------------------------------------------------
  // lmk rotation cancel <rotationId>
  // -------------------------------------------------------------------------
  rotation
    .command('cancel <rotationId>')
    .description(
      'Cancel an in-progress LMK rotation. DEKs already re-wrapped to the new ' +
      'LMK version remain on the new version — cancel does NOT roll those ' +
      'back. Use with care.'
    )
    .option('-r, --reason <text>', 'Reason recorded in the rotation row (audit trail)')
    .option('-f, --force', 'Skip confirmation prompt')
    .option('--json', 'Output as JSON')
    .action(async (rotationId: string, options: CancelOptions) => {
      if (options.force !== true) {
        output.warn(
          'Cancellation will NOT roll back DEKs already re-wrapped to the ' +
          'new LMK version. Those DEKs remain on the new version and the ' +
          'cluster will keep both LMK versions in lmk_versions for them.'
        );
        const proceed = await promptConfirm(
          `Cancel rotation ${rotationId}?`,
          false
        );
        if (!proceed) {
          output.info('Aborted.');
          return;
        }
      }

      const result = await client.post<CancelResponse>(
        `/v1/admin/lmk/rotation/${rotationId}/cancel`,
        { reason: options.reason ?? 'Cancelled by operator via CLI' }
      );

      if (options.json === true) {
        output.json(result);
        return;
      }

      output.success(result.message);
    });

  // -------------------------------------------------------------------------
  // lmk upgrade-root-ca (R-LMK-005)
  // -------------------------------------------------------------------------
  lmk
    .command('upgrade-root-ca')
    .description(
      'Upgrade the Vault Root CA private key from the legacy raw-LMK envelope ' +
      'to the rotation-safe system-DEK (v2) envelope (R-LMK-005). Run ONCE, ' +
      'after the whole fleet is on >= v1.45.3. Idempotent. An LMK rotation is ' +
      'refused until this has run.'
    )
    .option('--json', 'Output as JSON')
    .action(async (options: JsonOption) => {
      const spinner = output.spinner('Upgrading root CA key envelope...').start();
      try {
        const result = await client.post<RootCAUpgradeResponse>(
          '/v1/admin/root-ca/upgrade-key-envelope',
          {}
        );
        spinner.stop();

        if (options.json === true) {
          output.json(result);
          return;
        }

        switch (result.result) {
          case 'upgraded':
            output.success(
              'Root CA private key upgraded to the rotation-safe system-DEK (v2) ' +
              'envelope. LMK rotation is now permitted.'
            );
            break;
          case 'already-v2':
            output.info('Root CA is already on the v2 envelope — nothing to do.');
            break;
          case 'no-root-ca':
            output.warn('No active root CA found — nothing to upgrade.');
            break;
        }
      } catch (err) {
        spinner.fail('Failed to upgrade root CA key envelope');
        throw err;
      }
    });

  // -------------------------------------------------------------------------
  // lmk reissue-root-ca (INC-2026-06-13-01 recovery)
  // -------------------------------------------------------------------------
  lmk
    .command('reissue-root-ca')
    .description(
      'Reissue the Vault Root CA: mint a NEW root, archive the old (ROTATED), ' +
      'and re-sign active intermediates under the new root. Use when the current ' +
      'root private key is unrecoverable. Defaults to a DRY-RUN plan; pass --apply ' +
      'to execute. --force reissues a healthy root (new trust anchor — disruptive).'
    )
    .option('--apply', 'Execute the reissue (default is a dry-run plan)')
    .option('--force', 'Reissue even if the current root key is still healthy')
    .option('--fingerprint <fp>', 'Current active root fingerprint (auto-fetched if omitted)')
    .option('--json', 'Output as JSON')
    .action(async (options: ReissueOptions) => {
      // Resolve the current active root fingerprint (auto-fetch unless provided).
      let fingerprint = options.fingerprint;
      if (fingerprint === undefined || fingerprint === '') {
        const info = await client.get<{ fingerprintSha256?: string }>('/v1/pki/root-ca/info');
        fingerprint = info.fingerprintSha256;
        if (fingerprint === undefined || fingerprint === '') {
          output.error('Could not determine the active root CA fingerprint; pass --fingerprint.');
          return;
        }
      }

      const apply = options.apply === true;
      const spinner = output
        .spinner(apply ? 'Reissuing root CA...' : 'Planning root CA reissue (dry-run)...')
        .start();
      try {
        const result = await client.post<RootCAReissueResponse>('/v1/superadmin/root-ca/reissue', {
          dryRun: !apply,
          confirmFingerprint: fingerprint,
          confirm: 'REISSUE-ROOT-CA',
          force: options.force === true,
        });
        spinner.stop();

        if (options.json === true) {
          output.json(result);
          return;
        }

        output.section(result.applied ? 'Root CA Reissued' : 'Root CA Reissue Plan (dry-run)');
        output.keyValue({
          'Old root fingerprint': result.plan.oldRoot.fingerprint,
          'Old root unrecoverable': String(result.plan.oldRoot.unrecoverable),
          'New root subject': result.plan.newRoot.subjectDn,
          'New root key type': result.plan.newRoot.keyType,
          'Intermediates re-signed': result.plan.intermediates.length,
        });
        for (const im of result.plan.intermediates) {
          output.info(`  ${im.caId} (tenant ${im.tenantId}) chainVerified=${String(im.chainVerified)}`);
        }
        if (result.applied) {
          output.success(
            'Reissue applied. Re-distribute the new root cert (GET /v1/pki/root-ca/cert) ' +
            'to any external trust stores. LMK rotation is now permitted.'
          );
        } else {
          output.info('Dry-run only — nothing was written. Re-run with --apply to execute.');
        }
      } catch (err) {
        spinner.fail('Root CA reissue failed');
        throw err;
      }
    });
}

// ---------------------------------------------------------------------------
// Shared start handler — used by both `lmk rotation start` and the
// top-level `lmk rotate` alias.
// ---------------------------------------------------------------------------
async function runStart(options: RotateOptions): Promise<void> {
  const automatic = options.manual !== true;

  if (options.force !== true) {
    output.warn(
      'LMK rotation is a cluster-wide cryptographic operation. The readiness ' +
      'gate will refuse traffic with a 503 while DEK re-wrap runs. Since v1.40, ' +
      'data/lmk.bin is the stable BSK and versioned LMKs live wrapped in ' +
      'PostgreSQL; no lmk.bin.v<N> file is created. The current rotation API is ' +
      'not yet automatically commit-gated on offline escrow.'
    );
    if (!automatic) {
      output.info(
        'Manual mode: only initiate() will run. You will need to follow up ' +
        'with `znvault lmk rotation resume` to finish the rewrap + complete.'
      );
    }
    const proceed = await promptConfirm(
      automatic
        ? 'Proceed with full automatic LMK rotation?'
        : 'Proceed with manual LMK rotation initiate?',
      false
    );
    if (!proceed) {
      output.info('Aborted.');
      return;
    }
  }

  const spinner = output
    .spinner(automatic ? 'Rotating LMK (initiate + re-wrap + complete)...' : 'Initiating LMK rotation...')
    .start();

  try {
    const body: { description?: string; automatic: boolean } = { automatic };
    if (options.description !== undefined) {
      body.description = options.description;
    }

    if (automatic) {
      const result = await client.post<RotateAutomaticResponse>(
        '/v1/admin/lmk/rotate',
        body
      );
      spinner.stop();

      if (options.json === true) {
        output.json(result);
        return;
      }

      output.section('LMK Rotation Complete');
      output.keyValue({
        'Rotation ID': result.rotationId,
        'New LMK version': result.newLmkVersion,
        'Status': result.status,
        'DEKs migrated': result.deksMigrated ?? 0,
        'DEKs failed': result.deksFailed ?? 0,
      });

      if ((result.deksFailed ?? 0) > 0) {
        output.warn(
          'Rotation completed with per-DEK failures. Inspect ' +
          'dek_rotation_history for details and consider rerunning ' +
          '`znvault lmk rotation resume` after resolving the underlying cause.'
        );
      } else {
        output.success(
          `LMK now at version ${String(result.newLmkVersion)}. Create and verify ` +
          `a cumulative BSK + wrapped-LMK escrow snapshot; there is no versioned ` +
          `lmk.bin file to copy.`
        );
      }
    } else {
      const result = await client.post<RotateManualResponse>(
        '/v1/admin/lmk/rotate',
        body
      );
      spinner.stop();

      if (options.json === true) {
        output.json(result);
        return;
      }

      output.section('LMK Rotation Initiated (manual mode)');
      output.keyValue({
        'Rotation ID': result.rotationId,
        'New LMK version': result.newLmkVersion,
        'Status': result.status,
        'DEKs to migrate': result.deksToMigrate ?? 0,
      });
      output.info(
        `Next: run \`znvault lmk rotation resume\` to finish the rewrap and ` +
        `complete the rotation. /v1/health/ready will refuse traffic with 503 ` +
        `until that finishes.`
      );
    }
  } catch (err) {
    spinner.fail('LMK rotation failed');
    throw err;
  }
}
