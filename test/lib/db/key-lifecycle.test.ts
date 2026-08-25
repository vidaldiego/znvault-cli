// Path: test/lib/db/key-lifecycle.test.ts
//
// The CLI's access to the durable ceremony state, against a REAL PostgreSQL
// carrying zn-vault migration 093.
//
// These are integration tests on purpose. The three properties that make this
// worth having over a log file are all properties of the DATABASE, and none of
// them can be shown with a mock:
//
//   the partial unique index refusing a second in-flight operation,
//   the append-only trigger refusing to rewrite history,
//   and the phase event landing in the SAME transaction as the state change.
//
// Skips without CEREMONY_TEST_DATABASE_URL; `key-lifecycle-ci-wiring.test.ts`
// always runs and fails if CI stops providing it, so the skip can be a local
// convenience without becoming a permanent one.

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import pg from 'pg';

const DB_URL = process.env.CEREMONY_TEST_DATABASE_URL;

let ops: import('../../../src/lib/db/key-lifecycle.js').KeyLifecycleOperations;
let observer: pg.Client;

describe.skipIf(DB_URL === undefined)('ceremony state against a real PostgreSQL', () => {
  beforeAll(async () => {
    process.env.DATABASE_URL = DB_URL;
    const { KeyLifecycleOperations } = await import('../../../src/lib/db/key-lifecycle.js');
    ops = new KeyLifecycleOperations();
    observer = new pg.Client({ connectionString: DB_URL });
    await observer.connect();
  }, 30000);

  afterAll(async () => {
    await ops.close();
    await observer.end();
  });

  beforeEach(async () => {
    // Children first: the FK is ON DELETE RESTRICT precisely so history cannot
    // be dropped by removing the parent.
    await observer.query(
      'TRUNCATE TABLE key_lifecycle_phase_events, key_lifecycle_operations CASCADE',
    );
  });

  const CLAIM = {
    phase: 'preflight' as const,
    ownerNodeId: 'macstudio',
    ownerPrincipal: 'operator@example.com',
    minRelease: '1.67.0',
  };

  it('reports the schema as present', async () => {
    expect(await ops.schemaPresent()).toBe(true);
  });

  it('claims a ceremony and records its first phase in the same breath', async () => {
    const r = await ops.claim(CLAIM);
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    expect(r.operation.kind).toBe('ESCROW_SNAPSHOT');
    expect(r.operation.epoch).toBe(0);
    expect(r.operation.ownerPrincipal).toBe('operator@example.com');

    const events = await ops.history(r.operation.operationId);
    expect(events).toHaveLength(1);
    expect(events[0]?.phase).toBe('preflight');
  }, 30000);

  it('REFUSES a second ceremony while one is in flight', async () => {
    // The whole reason this lives in the database. Two operators, or one
    // operator in two terminals, both see "nothing running" and both proceed.
    const first = await ops.claim(CLAIM);
    expect(first.ok).toBe(true);

    const second = await ops.claim({ ...CLAIM, ownerPrincipal: 'someone.else@example.com' });

    expect(second.ok).toBe(false);
    if (second.ok) return;
    // And it says WHO holds it, so it can be chased rather than guessed at.
    expect(second.active?.ownerPrincipal).toBe('operator@example.com');
  }, 30000);

  it('REFUSES a ceremony while an LMK rotation holds the slot', async () => {
    // The dangerous overlap is not two ceremonies — it is a ceremony during a
    // rotation, which makes the bundle and the inventory describe different
    // moments. The index is global for exactly this reason.
    await observer.query(`
      INSERT INTO key_lifecycle_operations
        (kind, state, phase, epoch, owner_node_id, owner_principal, min_release)
      VALUES ('LMK_ROTATION','IN_PROGRESS','rewrap',0,'vault-4','job','1.67.0')
    `);

    const r = await ops.claim(CLAIM);

    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.active?.kind).toBe('LMK_ROTATION');
  }, 30000);

  it('advances phase by phase, leaving the whole route behind', async () => {
    const c = await ops.claim(CLAIM);
    expect(c.ok).toBe(true);
    if (!c.ok) return;
    const id = c.operation.operationId;

    let epoch = c.operation.epoch;
    for (const phase of ['workspace', 'material', 'write-a'] as const) {
      const op = await ops.advance({ operationId: id, expectedEpoch: epoch, phase, nodeId: 'macstudio' });
      epoch = op.epoch;
    }

    const events = await ops.history(id);
    expect(events.map((e) => e.phase)).toEqual(['preflight', 'workspace', 'material', 'write-a']);
  }, 30000);

  it('REFUSES a stale epoch instead of overwriting whoever moved first', async () => {
    const c = await ops.claim(CLAIM);
    expect(c.ok).toBe(true);
    if (!c.ok) return;
    const id = c.operation.operationId;

    await ops.advance({ operationId: id, expectedEpoch: 0, phase: 'workspace', nodeId: 'macstudio' });

    await expect(
      ops.advance({ operationId: id, expectedEpoch: 0, phase: 'material', nodeId: 'macstudio' }),
    ).rejects.toThrow(/no longer IN_PROGRESS at the expected epoch/i);

    // Nothing moved, and no orphan event landed.
    const events = await ops.history(id);
    expect(events).toHaveLength(2);
  }, 30000);

  it('survives the process dying: the phase is readable by a fresh reader', async () => {
    // The property a shell script cannot give you. A script that dies leaves
    // nothing; this leaves exactly where it got to.
    const c = await ops.claim(CLAIM);
    expect(c.ok).toBe(true);
    if (!c.ok) return;
    await ops.advance({ operationId: c.operation.operationId, expectedEpoch: 0, phase: 'workspace', nodeId: 'macstudio' });
    await ops.advance({ operationId: c.operation.operationId, expectedEpoch: 1, phase: 'material', nodeId: 'macstudio' });
    // ... and here the ceremony is interrupted.

    const active = await ops.active();

    expect(active?.phase).toBe('material');
    expect(active?.ownerPrincipal).toBe('operator@example.com');
  }, 30000);

  it('releases the slot when abandoned, with the reason kept', async () => {
    // A global exclusion with no escape hatch is a deadlock waiting for its
    // first interrupted ceremony.
    const c = await ops.claim(CLAIM);
    expect(c.ok).toBe(true);
    if (!c.ok) return;

    await ops.finish({
      operationId: c.operation.operationId,
      expectedEpoch: 0,
      outcome: 'ABANDONED',
      nodeId: 'macstudio',
      error: 'device B was not available',
    });

    const next = await ops.claim(CLAIM);
    expect(next.ok).toBe(true);

    const row = await observer.query<{ last_error: string }>(
      'SELECT last_error FROM key_lifecycle_operations WHERE operation_id = $1',
      [c.operation.operationId],
    );
    expect(row.rows[0]?.last_error).toMatch(/device B/);
  }, 30000);

  it('cannot have its history rewritten', async () => {
    // Append-only enforced by trigger, not by the absence of an UPDATE in this
    // file. "The code does not do that" is a description of today's code.
    const c = await ops.claim(CLAIM);
    expect(c.ok).toBe(true);
    if (!c.ok) return;

    await expect(
      observer.query('UPDATE key_lifecycle_phase_events SET phase = $1 WHERE operation_id = $2', [
        'rewritten', c.operation.operationId,
      ]),
    ).rejects.toThrow(/append-only/i);

    await expect(
      observer.query('DELETE FROM key_lifecycle_phase_events WHERE operation_id = $1', [
        c.operation.operationId,
      ]),
    ).rejects.toThrow(/append-only/i);
  }, 30000);
});
