// Path: src/lib/db/key-lifecycle.ts
//
// CLI-side access to the durable key-lifecycle state (zn-vault migration 093).
//
// WHY THE CEREMONY WRITES HERE AND NOT TO A LOG FILE. The owner's requirement
// was that a ceremony leave a record of who ran it, when, and how far it got —
// the thing a shell script cannot give you, because a script that dies leaves
// nothing and a script that is edited leaves no trace of the edit.
//
// `key_lifecycle_operations` gives all three, and two more that matter:
//
//   EXCLUSION IS IN THE DATABASE. A partial unique index means a second
//   ceremony — or a ceremony during an LMK rotation — is refused by PostgreSQL,
//   not by an `if` that both processes evaluate to false at the same instant.
//
//   THE HISTORY CANNOT BE REWRITTEN. `key_lifecycle_phase_events` is
//   append-only by trigger and is written in the SAME transaction as the state
//   change, so a ceremony that dies at phase 5 still shows how it reached
//   phase 5.
//
// PORT NOTICE. The server has a richer repository for these tables
// (`zn-vault/src/db/repo.key-lifecycle.ts`) with compare-and-swap on `epoch`.
// This package ships to npm on its own and cannot import it. The contract is
// the SCHEMA, pinned by the migration — not this file and not that one. What is
// duplicated here is deliberately the minimum: claim, advance, finish, read.

import { BaseDBClient } from './client.js';

export type CeremonyPhase =
  | 'preflight'
  | 'workspace'
  | 'material'
  | 'write-a'
  | 'write-b'
  | 'verify'
  | 'teardown';

export interface PhaseEvent {
  seq: number;
  phase: string;
  state: string;
  at: string;
  detail: Record<string, unknown> | null;
}

export interface LifecycleOperation {
  operationId: string;
  kind: string;
  state: string;
  phase: string;
  epoch: number;
  ownerNodeId: string;
  ownerPrincipal: string;
  minRelease: string;
  startedAt: string;
  finishedAt: string | null;
  lastError: string | null;
}

interface OperationRow {
  operation_id: string;
  kind: string;
  state: string;
  phase: string;
  epoch: string | number;
  owner_node_id: string;
  owner_principal: string;
  min_release: string;
  started_at: string;
  finished_at: string | null;
  last_error: string | null;
}

const COLUMNS = `operation_id, kind, state, phase, epoch, owner_node_id,
  owner_principal, min_release, started_at, finished_at, last_error`;

const PG_UNIQUE_VIOLATION = '23505';

function toOperation(r: OperationRow): LifecycleOperation {
  return {
    operationId: r.operation_id,
    kind: r.kind,
    state: r.state,
    phase: r.phase,
    // BIGINT arrives as a string from some drivers, a number from others.
    epoch: Number(r.epoch),
    ownerNodeId: r.owner_node_id,
    ownerPrincipal: r.owner_principal,
    minRelease: r.min_release,
    startedAt: r.started_at,
    finishedAt: r.finished_at,
    lastError: r.last_error,
  };
}

export class KeyLifecycleOperations extends BaseDBClient {
  /**
   * Is the schema present?
   *
   * The CLI ships independently of the server, so it can meet a deployment that
   * predates migration 093. Saying so plainly beats a `relation does not exist`
   * in the middle of a ceremony.
   */
  async schemaPresent(): Promise<boolean> {
    await this.connect();
    const r = await this.getRawClient().query<{ present: string | null }>(
      `SELECT to_regclass('public.key_lifecycle_operations')::text AS present`,
    );
    return (r.rows[0]?.present ?? null) !== null;
  }

  /** The operation currently holding the exclusion slot, if any. */
  async active(): Promise<LifecycleOperation | null> {
    await this.connect();
    const r = await this.getRawClient().query<OperationRow>(
      `SELECT ${COLUMNS} FROM key_lifecycle_operations WHERE state = 'IN_PROGRESS' LIMIT 1`,
    );
    const row = r.rows.at(0);
    return row === undefined ? null : toOperation(row);
  }

  /**
   * Start a ceremony, or find out who already holds the slot.
   *
   * Does NOT look before it leaps: a "is anything running?" SELECT followed by
   * an INSERT is exactly the race the index exists to close. The INSERT is the
   * check, and 23505 is the answer.
   */
  async claim(input: {
    phase: CeremonyPhase;
    ownerNodeId: string;
    ownerPrincipal: string;
    minRelease: string;
    detail?: Record<string, unknown>;
  }): Promise<{ ok: true; operation: LifecycleOperation } | { ok: false; active: LifecycleOperation | null }> {
    await this.connect();
    const c = this.getRawClient();
    try {
      await c.query('BEGIN');
      const r = await c.query<OperationRow>(
        `INSERT INTO key_lifecycle_operations
           (kind, state, phase, epoch, owner_node_id, owner_principal, min_release)
         VALUES ('ESCROW_SNAPSHOT', 'IN_PROGRESS', $1, 0, $2, $3, $4)
         RETURNING ${COLUMNS}`,
        [input.phase, input.ownerNodeId, input.ownerPrincipal, input.minRelease],
      );
      const row = r.rows.at(0);
      if (row === undefined) throw new Error('claim: INSERT ... RETURNING produced no row');
      // Same transaction: an operation whose history starts one commit late is
      // an operation whose first phase can vanish.
      await c.query(
        `INSERT INTO key_lifecycle_phase_events
           (operation_id, seq, phase, state, node_id, detail)
         VALUES ($1, 0, $2, 'IN_PROGRESS', $3, $4)`,
        [row.operation_id, input.phase, input.ownerNodeId,
         input.detail ? JSON.stringify(input.detail) : null],
      );
      await c.query('COMMIT');
      return { ok: true, operation: toOperation(row) };
    } catch (error) {
      await c.query('ROLLBACK').catch(() => undefined);
      if ((error as { code?: string }).code !== PG_UNIQUE_VIOLATION) throw error;
      return { ok: false, active: await this.active() };
    }
  }

  /**
   * Move to the next phase, recording it in the same transaction.
   *
   * Compare-and-swap on `epoch`: a caller holding a stale read is refused
   * rather than silently overwriting whoever moved first.
   */
  async advance(input: {
    operationId: string;
    expectedEpoch: number;
    phase: CeremonyPhase;
    nodeId: string;
    detail?: Record<string, unknown>;
  }): Promise<LifecycleOperation> {
    await this.connect();
    const c = this.getRawClient();
    const next = input.expectedEpoch + 1;
    try {
      await c.query('BEGIN');
      const r = await c.query<OperationRow>(
        `UPDATE key_lifecycle_operations
            SET phase = $1, epoch = $2, updated_at = now()
          WHERE operation_id = $3 AND epoch = $4 AND state = 'IN_PROGRESS'
        RETURNING ${COLUMNS}`,
        [input.phase, next, input.operationId, input.expectedEpoch],
      );
      const row = r.rows.at(0);
      if (row === undefined) {
        await c.query('ROLLBACK');
        throw new Error(
          `Could not advance operation ${input.operationId} to '${input.phase}': it is ` +
          'no longer IN_PROGRESS at the expected epoch. Someone or something else ' +
          "moved it. Run 'ceremony status' before deciding what to do.",
        );
      }
      await c.query(
        `INSERT INTO key_lifecycle_phase_events
           (operation_id, seq, phase, state, node_id, detail)
         VALUES ($1, $2, $3, 'IN_PROGRESS', $4, $5)`,
        [input.operationId, next, input.phase, input.nodeId,
         input.detail ? JSON.stringify(input.detail) : null],
      );
      await c.query('COMMIT');
      return toOperation(row);
    } catch (error) {
      await c.query('ROLLBACK').catch(() => undefined);
      throw error;
    }
  }

  /**
   * Close the operation, releasing the slot.
   *
   * `ABANDONED` is a real transition with a reason rather than a DELETE: why a
   * ceremony was abandoned is exactly what the next person needs to read, and a
   * global exclusion with no escape hatch is a deadlock waiting for its first
   * interrupted ceremony.
   */
  async finish(input: {
    operationId: string;
    expectedEpoch: number;
    outcome: 'COMPLETED' | 'FAILED' | 'ABANDONED';
    nodeId: string;
    error?: string;
    detail?: Record<string, unknown>;
  }): Promise<LifecycleOperation> {
    await this.connect();
    const c = this.getRawClient();
    const next = input.expectedEpoch + 1;
    try {
      await c.query('BEGIN');
      const r = await c.query<OperationRow>(
        `UPDATE key_lifecycle_operations
            SET state = $1, epoch = $2, last_error = COALESCE($3, last_error),
                updated_at = now(), finished_at = now()
          WHERE operation_id = $4 AND epoch = $5 AND state = 'IN_PROGRESS'
        RETURNING ${COLUMNS}`,
        [input.outcome, next, input.error ?? null, input.operationId, input.expectedEpoch],
      );
      const row = r.rows.at(0);
      if (row === undefined) {
        await c.query('ROLLBACK');
        throw new Error(
          `Could not close operation ${input.operationId}: it is no longer IN_PROGRESS ` +
          'at the expected epoch.',
        );
      }
      await c.query(
        `INSERT INTO key_lifecycle_phase_events
           (operation_id, seq, phase, state, node_id, detail)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [input.operationId, next, row.phase, input.outcome, input.nodeId,
         input.detail ? JSON.stringify(input.detail) : null],
      );
      await c.query('COMMIT');
      return toOperation(row);
    } catch (error) {
      await c.query('ROLLBACK').catch(() => undefined);
      throw error;
    }
  }

  /** The full route travelled, oldest first. */
  async history(operationId: string): Promise<PhaseEvent[]> {
    await this.connect();
    const r = await this.getRawClient().query<PhaseEvent>(
      `SELECT seq, phase, state, at::text AS at, detail
         FROM key_lifecycle_phase_events
        WHERE operation_id = $1 ORDER BY seq ASC`,
      [operationId],
    );
    return r.rows;
  }
}
