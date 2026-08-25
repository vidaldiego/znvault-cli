-- Migration 093: durable state for key-lifecycle operations.
--
-- BSK rotation, LMK rotation, escrow snapshot and isolated restore are
-- multi-phase operations that touch the root of the key hierarchy. Today their
-- exclusion and their resume point live in the operator's head and in one
-- process's memory: a node that dies halfway leaves nothing to resume from, and
-- nothing stops a second operator — or a second node — from starting an
-- overlapping operation. `lmk_rotation_state` (migration 057) covers exactly
-- one of the four kinds and carries no owner, no release floor and no
-- compare-and-swap token.
--
-- This migration is PURELY ADDITIVE: two new tables, one trigger on a table
-- that starts empty. It constrains no existing row and changes no existing
-- code path, so it is safe on a rolling deploy — old-code nodes never read or
-- write either table. The behaviour that uses it lands separately.
--
-- WHY NOT AN ADVISORY LOCK, which is the obvious answer to "exclusion".
-- Two verified reasons:
--   1. A pg_advisory_lock at SESSION scope crossing PgBouncer in transaction
--      pooling mode can be a silent no-op: the driver pins the connection only
--      for the duration of a transaction callback
--      (src/db/driver/postgres-driver.ts), so a lock taken in one HTTP request
--      is not held — and not owned — by whatever connection serves the next.
--      An exclusion primitive that silently does nothing is worse than none.
--   2. The ids in LOCK_IDS (src/db/concurrency.ts) are handed out under two
--      incompatible schemes — hand-written ASCII constants and djb2 hashes —
--      over one shared 64-bit space with no registry and no collision check.
-- A row plus a partial unique index has neither problem, survives a process
-- death (which is the point), and is inspectable with a SELECT during an
-- incident.
--
-- ---------------------------------------------------------------------------
-- 1. key_lifecycle_operations — current state, one row per operation
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS key_lifecycle_operations (
  operation_id    UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- What is being done. Constrained here rather than left as free text: a typo
  -- in a kind would create an operation that the exclusion logic still honours
  -- but that no query ever finds.
  kind            TEXT NOT NULL CHECK (kind IN (
                    'BSK_ROTATION',
                    'LMK_ROTATION',
                    'ESCROW_SNAPSHOT',
                    'ISOLATED_RESTORE'
                  )),

  state           TEXT NOT NULL CHECK (state IN (
                    'IN_PROGRESS',
                    'COMPLETED',
                    'FAILED',
                    'ABANDONED'
                  )),

  -- Free text on purpose: the phase vocabulary belongs to each procedure and
  -- will change faster than this schema should. The append-only child table is
  -- what makes a phase name meaningful after the fact.
  phase           TEXT NOT NULL,

  -- Compare-and-swap token. Every transition requires the epoch the caller
  -- last saw and increments it, so two callers holding the same read cannot
  -- both move the operation on — the second is rejected instead of silently
  -- overwriting the first (the classic lost update).
  epoch           BIGINT NOT NULL DEFAULT 0,

  owner_node_id   TEXT NOT NULL,
  owner_principal TEXT NOT NULL,

  -- Minimum release allowed to touch this operation. A node older than this
  -- refuses to advance it rather than half-understanding a procedure written
  -- after it shipped. Compared by PARSING the numeric triple, never as text:
  -- '1.9.0' > '1.66.0' lexicographically.
  min_release     TEXT NOT NULL,

  -- Publishable key-check values only ("kcv1:" + 128-bit truncated HMAC).
  -- NEVER key material, and never a raw digest of a key.
  kcv_before      TEXT,
  kcv_after       TEXT,

  started_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at     TIMESTAMPTZ,
  last_error      TEXT
);

-- At most ONE operation in progress across the entire cluster.
--
-- Deliberately global — ((true)) — and not per kind. The overlap that destroys
-- data is a BSK rotation running against an LMK rotation, or an escrow
-- snapshot captured mid-rotation: a per-kind index would permit exactly the
-- dangerous pairs while forbidding the harmless one. Same idiom as
-- idx_lmk_rotation_state_one_in_progress (migration 057).
--
-- Terminal rows accumulate as history and are not constrained. ABANDONED is
-- one of them on purpose: a global exclusion with no escape hatch is a
-- fleet-wide deadlock waiting for its first crashed node.
CREATE UNIQUE INDEX IF NOT EXISTS idx_key_lifecycle_one_in_progress
  ON key_lifecycle_operations ((true))
  WHERE state = 'IN_PROGRESS';

CREATE INDEX IF NOT EXISTS idx_key_lifecycle_started_at
  ON key_lifecycle_operations (started_at DESC);

-- ---------------------------------------------------------------------------
-- 2. key_lifecycle_phase_events — append-only history
-- ---------------------------------------------------------------------------
-- The parent row is CURRENT STATE, not a record of what happened: advancing an
-- operation overwrites `phase` in place. Without this table the audit log would
-- be the only trace of the route travelled — and audit emission happens after
-- commit and fails open, with its most likely moment of failure being during a
-- rotation, when the HMAC key for the LMK version in force may not be cached.
-- A crash at phase 5 would leave phases 1 to 4 nowhere.
--
-- Writing the event inside the SAME transaction as the state change removes
-- both problems at once: the history cannot lag the state, and this table
-- needs no HMAC key, so it cannot fail the way the audit chain can.
CREATE TABLE IF NOT EXISTS key_lifecycle_phase_events (
  id           BIGSERIAL PRIMARY KEY,

  -- RESTRICT, not CASCADE: deleting the operation must not be a way to delete
  -- its history.
  operation_id UUID NOT NULL
                 REFERENCES key_lifecycle_operations(operation_id)
                 ON DELETE RESTRICT,

  -- The epoch this event records, so the history and the CAS token line up and
  -- a gap is visible. UNIQUE per operation: an epoch cannot be recorded twice.
  seq          INTEGER NOT NULL,

  phase        TEXT NOT NULL,
  state        TEXT NOT NULL,
  node_id      TEXT NOT NULL,

  -- Counts, receipts, KCVs. Never key material.
  detail       JSONB,

  at           TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE (operation_id, seq)
);

CREATE INDEX IF NOT EXISTS idx_key_lifecycle_phase_events_operation
  ON key_lifecycle_phase_events (operation_id, seq);

-- Append-only, enforced by the database rather than by convention.
--
-- The application has no UPDATE or DELETE path for this table, but "the code
-- does not do that" is not a property — it is a description of today's code.
-- A row-level trigger is, and it costs nothing on a table that is only ever
-- INSERTed into.
--
-- Scope, stated plainly: this stops UPDATE and DELETE. TRUNCATE bypasses
-- row-level triggers and remains possible for a table owner, which is the same
-- posture as `audit_log` and is deliberate — a statement-level TRUNCATE guard
-- would make the table impossible to reset in test and maintenance without
-- superuser gymnastics, for a threat model that already assumes database-owner
-- access.
CREATE OR REPLACE FUNCTION key_lifecycle_phase_events_append_only()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION
    'key_lifecycle_phase_events is append-only (attempted %)', TG_OP
    USING ERRCODE = '0A000';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_key_lifecycle_phase_events_append_only
  ON key_lifecycle_phase_events;

CREATE TRIGGER trg_key_lifecycle_phase_events_append_only
  BEFORE UPDATE OR DELETE ON key_lifecycle_phase_events
  FOR EACH ROW EXECUTE FUNCTION key_lifecycle_phase_events_append_only();

COMMENT ON TABLE key_lifecycle_operations IS
  'Durable state of one key-lifecycle operation (BSK/LMK rotation, escrow '
  'snapshot, isolated restore). At most one row is IN_PROGRESS cluster-wide, '
  'enforced by idx_key_lifecycle_one_in_progress. Transitions are '
  'compare-and-swap on `epoch`. Holds KCVs only, never key material.';

COMMENT ON TABLE key_lifecycle_phase_events IS
  'Append-only history of an operation''s phases, written in the same '
  'transaction as the state change it records. UPDATE and DELETE are refused '
  'by trigger.';
