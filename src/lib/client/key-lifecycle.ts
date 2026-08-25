// Path: src/lib/client/key-lifecycle.ts
//
// Key-lifecycle operations — escrow ceremonies and rotations — over the API.
//
// THIS REPLACES A MODULE THAT SPOKE POSTGRESQL. `src/lib/db/key-lifecycle.ts`
// opened a connection to the cluster database and wrote
// `key_lifecycle_operations` itself. That made this CLI coupled to one engine
// and one schema, forced an SSH tunnel for an ordinary operation, and meant the
// record of who handled the bootstrap key never passed through the server's
// authentication, authorisation or audit trail.
//
// The rule (owner, 2026-08-25): the CLI never writes to the database directly,
// and is engine-agnostic. Break-glass commands that exist precisely for when
// the API will not let you in (`emergency`, `lockdown`) keep their direct
// access as an explicit, documented exception. A ceremony is not one of those:
// it runs against a healthy cluster and produces a record meant to be believed.
//
// WHAT DID NOT CHANGE. The guarantees are still the database's: the global
// exclusion is a partial unique index, the compare-and-swap is a WHERE clause,
// and the phase history is append-only by trigger. The server translates their
// refusals into status codes; this client translates those back into errors an
// operator can act on. Nothing here decides anything.

import { HttpClient } from './http.js';

const BASE = '/v1/superadmin/key-lifecycle';

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

/** The shape the server sends with a 409. */
interface ConflictBody {
  reason?: string;
  active?: LifecycleOperation;
  current?: LifecycleOperation;
  message?: string;
}

/**
 * Pull the server's structured refusal out of a thrown HTTP error.
 *
 * `.details` AND NOT `.body`. `http.ts` attaches the full parsed body as
 * `details` and says so at its own line 47: "there is no `.body` on the thrown
 * error; a `.body.error` check would be DEAD." A first draft of this file read
 * `.body`, which would have compiled, passed type-checking, and silently
 * degraded every refusal below to its default branch — the operator would have
 * been told "conflict" and nothing else, at the one moment the distinction
 * matters.
 */
function conflictOf(error: unknown): ConflictBody | null {
  const details = (error as {details?: unknown}).details;
  if (details !== null && typeof details === 'object') return details;
  return null;
}

function statusOf(error: unknown): number | null {
  const status = (error as {statusCode?: unknown}).statusCode;
  return typeof status === 'number' ? status : null;
}

export class KeyLifecycleClient extends HttpClient {
  /**
   * Does this deployment expose the routes?
   *
   * The CLI ships independently of the server, so it can meet a deployment
   * that predates them. Saying so plainly beats a bare 404 in the middle of a
   * ceremony.
   */
  async routesPresent(): Promise<boolean> {
    try {
      await this.get<{operation: LifecycleOperation | null}>(`${BASE}/active`);
      return true;
    } catch (error) {
      if (statusOf(error) === 404) return false;
      throw error;
    }
  }

  /** The operation currently holding the exclusion slot, if any. */
  async active(): Promise<LifecycleOperation | null> {
    const res = await this.get<{operation: LifecycleOperation | null}>(`${BASE}/active`);
    return res.operation;
  }

  /**
   * Start a ceremony, or find out who already holds the slot.
   *
   * Note what is NOT sent: the principal. The server records the authenticated
   * identity, so a custody record's "who" is no longer a value chosen by the
   * person being recorded.
   */
  async claim(input: {
    kind: 'ESCROW_SNAPSHOT' | 'LMK_ROTATION' | 'BSK_ROTATION';
    phase: CeremonyPhase;
    ownerNodeId: string;
    minRelease: string;
    kcvBefore?: string;
    detail?: Record<string, unknown>;
  }): Promise<{ ok: true; operation: LifecycleOperation } | { ok: false; active: LifecycleOperation | null }> {
    try {
      const res = await this.post<{operation: LifecycleOperation}>(`${BASE}/operations`, input);
      return { ok: true, operation: res.operation };
    } catch (error) {
      if (statusOf(error) !== 409) throw error;
      return { ok: false, active: conflictOf(error)?.active ?? null };
    }
  }

  /**
   * Move to the next phase.
   *
   * A 409 is not "try again": it carries WHY, and the three reasons mean
   * different things. `EPOCH_MISMATCH` means someone moved first and re-reading
   * helps; `NOT_IN_PROGRESS` means the operation is over and it will not;
   * `RELEASE_TOO_OLD` means this node must not touch it at all.
   */
  async advance(input: {
    operationId: string;
    expectedEpoch: number;
    phase: CeremonyPhase;
    detail?: Record<string, unknown>;
  }): Promise<LifecycleOperation> {
    const { operationId, ...body } = input;
    try {
      const res = await this.post<{operation: LifecycleOperation}>(
        `${BASE}/operations/${operationId}/advance`, body,
      );
      return res.operation;
    } catch (error) {
      throw this.explain(error, operationId, `advance to '${input.phase}'`);
    }
  }

  /** Close the operation, releasing the slot. */
  async finish(input: {
    operationId: string;
    expectedEpoch: number;
    outcome: 'COMPLETED' | 'FAILED' | 'ABANDONED';
    error?: string;
    kcvAfter?: string;
    detail?: Record<string, unknown>;
  }): Promise<LifecycleOperation> {
    const { operationId, ...body } = input;
    try {
      const res = await this.post<{operation: LifecycleOperation}>(
        `${BASE}/operations/${operationId}/finish`, body,
      );
      return res.operation;
    } catch (error) {
      throw this.explain(error, operationId, `close as ${input.outcome}`);
    }
  }

  /** The full route travelled, oldest first. */
  async history(operationId: string): Promise<PhaseEvent[]> {
    const res = await this.get<{operation: LifecycleOperation; events: PhaseEvent[]}>(
      `${BASE}/operations/${operationId}/history`,
    );
    return res.events;
  }

  /**
   * Turn a refusal into a sentence an operator mid-ceremony can act on.
   *
   * Keeping the reasons apart is the whole point — see `advance`. A single
   * "conflict" would leave someone holding key material unable to tell "retry"
   * from "stop".
   */
  private explain(error: unknown, operationId: string, what: string): Error {
    const status = statusOf(error);
    if (status === null || (status !== 409 && status !== 404)) {
      return error instanceof Error ? error : new Error(String(error));
    }
    const conflict = conflictOf(error);
    const reason = conflict?.reason ?? (status === 404 ? 'NOT_FOUND' : 'CONFLICT');
    const current = conflict?.current;
    const where = current === undefined
      ? ''
      : ` It is at phase '${current.phase}', epoch ${String(current.epoch)}, state ${current.state}.`;

    switch (reason) {
      case 'EPOCH_MISMATCH':
        return new Error(
          `Could not ${what} on operation ${operationId}: someone or something else ` +
          `moved it first.${where} Run 'ceremony status' and decide from where it ` +
          'actually is — do not simply retry.',
        );
      case 'NOT_IN_PROGRESS':
        return new Error(
          `Could not ${what} on operation ${operationId}: it is no longer in ` +
          `progress.${where} Re-reading will not help; this operation is over.`,
        );
      case 'RELEASE_TOO_OLD':
        return new Error(
          `Could not ${what} on operation ${operationId}: the vault node is older ` +
          'than the release this operation requires. Do not force it — a node that ' +
          'does not understand the operation must not move it.',
        );
      case 'NOT_FOUND':
        return new Error(`No key-lifecycle operation ${operationId} exists.`);
      default:
        return new Error(
          `Could not ${what} on operation ${operationId}: ${conflict?.message ?? reason}.${where}`,
        );
    }
  }
}
