// Path: test/lib/client/key-lifecycle.test.ts
//
// The client that replaced direct PostgreSQL access for ceremonies.
//
// What is worth testing here is NOT that a POST is a POST. It is the refusal
// path: the server distinguishes three reasons for a 409 because an operator
// holding key material has to tell "retry" from "stop", and every one of those
// distinctions travels in the error BODY. `http.ts` attaches that body as
// `.details` and explicitly warns that `.body` does not exist — so a client
// reading the wrong property would compile, type-check, pass any test that only
// asserted "it throws", and silently collapse every refusal into one useless
// sentence at the worst possible moment.
//
// These tests fail if that property name is wrong.

import { describe, expect, it } from 'vitest';
import { KeyLifecycleClient } from '../../../src/lib/client/key-lifecycle.js';

/** An error shaped the way `http.ts` actually throws them. */
function httpError(statusCode: number, details: unknown): Error {
  const error = new Error(`HTTP ${String(statusCode)}`) as Error & {
    statusCode?: number;
    details?: unknown;
  };
  error.statusCode = statusCode;
  error.details = details;
  return error;
}

const OPERATION = {
  operationId: 'op-1',
  kind: 'ESCROW_SNAPSHOT',
  state: 'IN_PROGRESS',
  phase: 'workspace',
  epoch: 3,
  ownerNodeId: 'mac',
  ownerPrincipal: 'someone@example.com',
  minRelease: '1.69.0',
  startedAt: '2026-08-25T10:00:00Z',
  finishedAt: null,
  lastError: null,
};

/** A client whose transport is a scripted failure. */
class FailingClient extends KeyLifecycleClient {
  constructor(private readonly failure: Error) {
    super();
  }
  override async post<T>(_path: string, _body: unknown): Promise<T> {
    return Promise.reject(this.failure);
  }
  override async get<T>(_path: string): Promise<T> {
    return Promise.reject(this.failure);
  }
}

describe('KeyLifecycleClient refusals', () => {
  it('reads the reason out of `details`, not `body`', async () => {
    // The single assertion this whole file exists for.
    const client = new FailingClient(
      httpError(409, { reason: 'EPOCH_MISMATCH', current: OPERATION }),
    );

    await expect(
      client.advance({ operationId: 'op-1', expectedEpoch: 0, phase: 'material' }),
    ).rejects.toThrow(/moved it first/i);
  });

  it('says WHERE the operation actually is, so re-reading is not another round trip', async () => {
    const client = new FailingClient(
      httpError(409, { reason: 'EPOCH_MISMATCH', current: OPERATION }),
    );

    await expect(
      client.advance({ operationId: 'op-1', expectedEpoch: 0, phase: 'material' }),
    ).rejects.toThrow(/phase 'workspace', epoch 3/);
  });

  it('tells "retry" apart from "stop"', async () => {
    // EPOCH_MISMATCH: someone moved first, re-read and decide.
    const raced = new FailingClient(httpError(409, { reason: 'EPOCH_MISMATCH' }));
    await expect(
      raced.advance({ operationId: 'op-1', expectedEpoch: 0, phase: 'material' }),
    ).rejects.toThrow(/do not simply retry/i);

    // NOT_IN_PROGRESS: it is over. Re-reading will not help.
    const over = new FailingClient(httpError(409, { reason: 'NOT_IN_PROGRESS' }));
    await expect(
      over.advance({ operationId: 'op-1', expectedEpoch: 0, phase: 'material' }),
    ).rejects.toThrow(/will not help/i);
  });

  it('refuses to let an old node move an operation it does not understand', async () => {
    const old = new FailingClient(httpError(409, { reason: 'RELEASE_TOO_OLD' }));
    await expect(
      old.finish({ operationId: 'op-1', expectedEpoch: 3, outcome: 'COMPLETED' }),
    ).rejects.toThrow(/must not move it/i);
  });

  it('reports a claim conflict with WHO holds the slot', async () => {
    const client = new FailingClient(
      httpError(409, { reason: 'ALREADY_ACTIVE', active: OPERATION }),
    );

    const result = await client.claim({
      kind: 'ESCROW_SNAPSHOT',
      phase: 'preflight',
      ownerNodeId: 'mac',
      minRelease: '1.69.0',
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.active?.ownerPrincipal).toBe('someone@example.com');
  });

  it('turns a 404 into "no such operation", not a conflict', async () => {
    const client = new FailingClient(httpError(404, { error: 'Not Found' }));
    await expect(
      client.advance({ operationId: 'op-9', expectedEpoch: 0, phase: 'material' }),
    ).rejects.toThrow(/No key-lifecycle operation op-9 exists/);
  });

  it('reports a deployment without the routes rather than a bare 404', async () => {
    const client = new FailingClient(httpError(404, {}));
    expect(await client.routesPresent()).toBe(false);
  });

  it('does not swallow errors it has no business interpreting', async () => {
    // A 500 is not a refusal. Rewriting it into ceremony vocabulary would hide
    // an outage behind a sentence about epochs.
    const client = new FailingClient(httpError(500, { message: 'boom' }));
    await expect(
      client.advance({ operationId: 'op-1', expectedEpoch: 0, phase: 'material' }),
    ).rejects.toThrow(/HTTP 500/);
  });
});
