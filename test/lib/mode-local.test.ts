// Path: test/lib/mode-local.test.ts
//
// Local mode is a decision, not a side effect of the environment.
//
// It used to switch itself on whenever `DATABASE_URL` happened to be set, which
// took ordinary commands — `audit`, `lockdown`, `cert`, `host`, `agent`, the
// TUI — off the API and straight into the database, past its authentication,
// authorisation and audit trail. No flag, no warning, and the banner still
// showed the profile and URL the command was no longer using.
//
// That switch had no test at all, which is part of how it survived. These are
// those tests.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Fresh module graph per test.
 *
 * `mode.ts` holds the requested flag and the "already warned" latch at module
 * scope, so a shared import would leak one test's decision into the next.
 */
async function freshMode(): Promise<typeof import('../../src/lib/mode.js')> {
  vi.resetModules();
  return import('../../src/lib/mode.js');
}

const ORIGINAL_DATABASE_URL = process.env.DATABASE_URL;
const ORIGINAL_ZNVAULT_LOCAL = process.env.ZNVAULT_LOCAL;

beforeEach(() => {
  delete process.env.DATABASE_URL;
  delete process.env.ZNVAULT_LOCAL;
});

afterEach(() => {
  if (ORIGINAL_DATABASE_URL === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = ORIGINAL_DATABASE_URL;
  if (ORIGINAL_ZNVAULT_LOCAL === undefined) delete process.env.ZNVAULT_LOCAL;
  else process.env.ZNVAULT_LOCAL = ORIGINAL_ZNVAULT_LOCAL;
  vi.restoreAllMocks();
});

describe('local mode is never entered by accident', () => {
  it('DATABASE_URL alone does NOT switch to local mode', async () => {
    // THE REGRESSION. A tunnel for a migration, a psql session, anything that
    // exports this variable used to reroute every subsequent command away from
    // the API without saying so.
    process.env.DATABASE_URL = 'postgres://user@example.com:5432/db';
    const mode = await freshMode();

    expect(mode.getMode()).toBe('api');
  });

  it('stays on the API even when direct access is perfectly possible', async () => {
    // Availability is not consent. The database being reachable says nothing
    // about whether the operator wants to bypass authentication.
    process.env.DATABASE_URL = 'postgres://user@example.com:5432/db';
    const mode = await freshMode();

    expect(mode.isLocalModeRequested()).toBe(false);
    expect(mode.getMode()).toBe('api');
  });

  it('enters local mode when it is explicitly asked for', async () => {
    process.env.DATABASE_URL = 'postgres://user@example.com:5432/db';
    const mode = await freshMode();

    mode.requestLocalMode(true);

    expect(mode.getMode()).toBe('local');
  });

  it('honours ZNVAULT_LOCAL=1 for non-interactive callers', async () => {
    process.env.DATABASE_URL = 'postgres://user@example.com:5432/db';
    process.env.ZNVAULT_LOCAL = '1';
    const mode = await freshMode();

    expect(mode.getMode()).toBe('local');
  });

  it('does not treat any other ZNVAULT_LOCAL value as consent', async () => {
    process.env.DATABASE_URL = 'postgres://user@example.com:5432/db';
    process.env.ZNVAULT_LOCAL = 'false';
    const mode = await freshMode();

    expect(mode.getMode()).toBe('api');
  });

  it('REFUSES rather than falling back to the API when --local cannot be honoured', async () => {
    // Silently doing the other thing is how an operator ends up believing a
    // command ran somewhere it did not. If the answer cannot be what was asked
    // for, it must be an error.
    const mode = await freshMode();
    mode.requestLocalMode(true);

    expect(() => mode.getMode()).toThrow(/not available/i);
    expect(() => mode.getMode()).toThrow(/Refusing to fall back/i);
  });

  it('WARNS that authentication and the audit trail are being bypassed', async () => {
    process.env.DATABASE_URL = 'postgres://user@example.com:5432/db';
    vi.resetModules();
    const output = await import('../../src/lib/output.js');
    const warn = vi.spyOn(output, 'warn').mockImplementation(() => undefined);
    const mode = await import('../../src/lib/mode.js');

    mode.requestLocalMode(true);
    mode.getMode();

    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]?.[0]).toMatch(/audit/i);
  });

  it('warns once per invocation, not once per call', async () => {
    // getMode() is called all over the place; a warning per call would train
    // the operator to ignore it, which is the same as not warning.
    process.env.DATABASE_URL = 'postgres://user@example.com:5432/db';
    vi.resetModules();
    const output = await import('../../src/lib/output.js');
    const warn = vi.spyOn(output, 'warn').mockImplementation(() => undefined);
    const mode = await import('../../src/lib/mode.js');

    mode.requestLocalMode(true);
    mode.getMode();
    mode.getMode();
    mode.getMode();

    expect(warn).toHaveBeenCalledTimes(1);
  });
});
