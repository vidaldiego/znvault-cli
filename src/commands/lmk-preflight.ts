// Path: znvault-cli/src/commands/lmk-preflight.ts
//
// `znvault lmk preflight` — read-only, local, and it produces evidence.
//
// This is the command that answers "is this deployment in a state where a
// key-lifecycle operation is safe to start?", and its two hard requirements
// come from the same place: whoever reads the answer later was not in the room.
//
//   IT WRITES NOTHING. Not a row, not an audit entry. That is why it goes
//   straight to PostgreSQL instead of through the API: both
//   `/v1/superadmin/rootkey/status` and `.../verify` write an audit row, so
//   asking them would falsify the property being asserted — invisibly.
//
//   IT PRINTS A VERDICT, AND EXITS ON IT. A preflight that reports problems in
//   prose and exits 0 is a preflight that gets piped into a script and ignored.
//   Any BLOCKING gate failing means exit 1.
//
// The evidence file is the input to the detached signature (A2) and to the
// isolated-restore bench (D2). It carries the gate results AND everything the
// gates were computed from, so they can be recomputed from the artefact alone.

import { hostname } from 'node:os';
import { writeFileSync } from 'node:fs';
import { type Command } from 'commander';

import * as output from '../lib/output.js';
import { LocalDBClient, isLocalDbAvailable } from '../lib/db/index.js';
import { buildEvidence, type PreflightBody, type PreflightEvidence } from '../lib/preflight.js';
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

export function registerLmkPreflightCommand(lmk: Command): void {
  lmk
    .command('preflight')
    .description(
      'Read-only inventory of the key hierarchy with pass/fail gates. Writes ' +
      'nothing to the database and produces a JSON evidence artefact.',
    )
    .option('--json', 'Output only the evidence artefact as JSON')
    .option('--out <path>', 'Also write the evidence artefact to this path')
    .action(async (options: PreflightOptions) => {
      if (!isLocalDbAvailable()) {
        throw new Error(
          'The preflight is local-only. Run it on a Vault node with local database ' +
          'configuration: reading this state through the API would write audit rows, ' +
          'and "zero writes" is the property being demonstrated.',
        );
      }

      const database = new LocalDBClient();
      let evidence: PreflightEvidence;
      try {
        const snapshot = await database.capturePreflight();
        const body: PreflightBody = {
          artifact: 'znvault-preflight-v1',
          capturedAt: snapshot.capturedAt.toISOString(),
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
        evidence = buildEvidence(body);
      } finally {
        await database.close();
      }

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
