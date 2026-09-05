// Path: znvault-cli/src/commands/lmk-preflight.ts
//
// `znvault lmk preflight` obtains its snapshot through the authenticated server
// API. The CLI validates that response, constructs the evidence document and
// exits nonzero for blocking gates. Database access and server-side audit
// behavior belong to the core endpoint, not to this command.

import { hostname } from 'node:os';
import { writeFileSync } from 'node:fs';
import { type Command } from 'commander';

import * as output from '../lib/output.js';
import {
  buildEvidence,
  type PreflightBody,
  type PreflightEvidence,
  type PreflightSnapshotResponse,
} from '../lib/preflight.js';
import { client } from '../lib/client.js';
import { getVersion } from '../lib/version.js';

interface PreflightOptions {
  json?: boolean;
  out?: string;
}

function currentOperator(): string {
  return (
    process.env.SUDO_USER ??
    process.env.USER ??
    `uid-${String(process.getuid?.() ?? 'unknown')}`
  );
}

function renderHuman(evidence: PreflightEvidence): void {
  output.section('BSK Rotation Preflight');
  output.keyValue({
    Database: evidence.database.databaseName,
    PostgreSQL: evidence.database.postgresVersion,
    'Latest migration': evidence.database.latestMigration ?? 'unknown',
    'WAL LSN': evidence.database.walLsn,
    'Captured at': evidence.capturedAt,
    Operator: `${evidence.operator}@${evidence.hostname}`,
  });

  output.table(
    ['Gate', 'Severity', 'Status', 'Detail'],
    evidence.gates.map((g) => [g.id, g.severity, g.status, g.detail]),
  );

  if (evidence.verdict === 'GREEN') {
    output.success(
      'GREEN — every blocking gate passed. Informational findings above are ' +
      'recorded, not ignored.',
    );
  } else {
    output.error(
      'RED — at least one blocking gate failed. Do not start a key-lifecycle ' +
      'operation until every one of them is resolved.',
    );
  }
}

/**
 * Validate the wire, then narrow. Takes `unknown` ON PURPOSE.
 *
 * `client.get<PreflightSnapshotResponse>()` is a type ASSERTION, not a
 * validation: TypeScript believes the annotation and nothing verifies the wire.
 * That is how a missing `hasWrappedLmk` became `undefined`, read as false, and
 * produced a production preflight reporting RED on a blocking gate — "the
 * ACTIVE LMK has no wrapped material" — that was not true.
 *
 * Typing the parameter as the response would make every check below
 * "unnecessary" to the compiler, which is the same false confidence that caused
 * the bug. So it takes `unknown` and earns the type.
 *
 * A preflight exists to be believed, and a wrong RED is not the safe direction:
 * it stops a ceremony that should proceed and tells the operator their key
 * hierarchy is unrecoverable. An incomplete response is an explicit error
 * naming what is missing, never a verdict.
 */
function validateSnapshot(raw: unknown): PreflightSnapshotResponse {
  if (raw === null || typeof raw !== 'object') {
    throw new Error('The vault returned no preflight inventory.');
  }
  const snapshot = raw as Record<string, unknown>;
  const missing: string[] = [];
  for (const field of ['capturedAt', 'databaseName', 'walLsn', 'lmkVersions']) {
    if (snapshot[field] === undefined || snapshot[field] === null) missing.push(field);
  }

  const versions = snapshot.lmkVersions;
  if (Array.isArray(versions)) {
    for (const entry of versions as Array<Record<string, unknown>>) {
      if (typeof entry.hasWrappedLmk !== 'boolean') {
        missing.push(`lmkVersions[version=${String(entry.version)}].hasWrappedLmk`);
      }
    }
  }

  if (missing.length > 0) {
    throw new Error(
      `The vault did not send fields this preflight reads: ${missing.join(', ')}. ` +
      'Refusing to produce a verdict from an incomplete inventory — a gate ' +
      'evaluated over a missing field reports a failure that is not real. This ' +
      'usually means the vault is older than the CLI; check its version.',
    );
  }
  return raw as PreflightSnapshotResponse;
}

export function registerLmkPreflightCommand(lmk: Command): void {
  lmk
    .command('preflight')
    .description(
      'Read-only key-hierarchy snapshot through the authenticated API with ' +
      'pass/fail gates and JSON evidence. The server records an audit event.',
    )
    .option('--json', 'Output only the evidence artefact as JSON')
    .option('--out <path>', 'Also write the evidence artefact to this path')
    .action(async (options: PreflightOptions) => {
      // NO LONGER LOCAL-ONLY. This used to refuse anything but a direct
      // database connection, on the grounds that reading the state through the
      // API would write audit rows and "zero writes" was the property being
      // demonstrated. The server now captures the whole inventory inside ONE
      // read-only repeatable-read transaction (`GET /v1/superadmin/lmk/preflight`),
      // so the two properties that mattered — a single instant, and reads the
      // database itself refuses to let write — are intact. What changed is that
      // the deployment records that a preflight ran, which is not a perturbation
      // of the custody state it inspects.
      const snapshot = validateSnapshot(
        await client.get<unknown>('/v1/superadmin/lmk/preflight'),
      );
      const body: PreflightBody = {
          artifact: 'znvault-preflight-v1',
          capturedAt: snapshot.capturedAt,
          cliVersion: getVersion(),
          operator: currentOperator(),
          hostname: hostname(),
          database: {
            databaseName: snapshot.databaseName,
            postgresVersion: snapshot.postgresVersion,
            walLsn: snapshot.walLsn,
            transactionSnapshot: snapshot.transactionSnapshot,
            latestMigration: snapshot.latestMigration,
          },
          lmkVersions: snapshot.lmkVersions,
          rootKeyEnvelopes: snapshot.rootKeyEnvelopes,
          rootKeyEnvelopesTablePresent: snapshot.rootKeyEnvelopesTablePresent,
          activeRotations: snapshot.activeRotations,
          auditHead: snapshot.auditHead,
          latestVerifiedBackup: snapshot.latestVerifiedBackup,
        };
      const evidence = buildEvidence(body);

      // The artefact is written whatever the verdict. A red preflight is
      // exactly the one worth keeping: it is the record of why an operation
      // was not started, and the thing to diff against once it is fixed.
      if (options.out !== undefined) {
        writeFileSync(options.out, `${JSON.stringify(evidence, null, 2)}\n`, {
          encoding: 'utf8',
          mode: 0o600,
        });
      }

      if (options.json === true) {
        output.json(evidence);
      } else {
        renderHuman(evidence);
        if (options.out !== undefined) {
          output.info(`Evidence written to ${options.out}`);
        }
      }

      if (evidence.verdict === 'RED') {
        process.exitCode = 1;
      }
    });
}
