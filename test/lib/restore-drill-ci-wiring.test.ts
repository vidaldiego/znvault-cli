// Path: test/lib/restore-drill-ci-wiring.test.ts
//
// `restore-drill-integration.test.ts` skips without `DRILL_TEST_DATABASE_URL`,
// so that a developer without a PostgreSQL to hand is not blocked. A skip like
// that is only honest while CI still provides the variable — otherwise the
// suite reports the same green whether the drill was exercised or not.
//
// This pins the wiring. It needs no database, always runs, and fails the moment
// CI stops handing the drill a database.
//
// It replaces the guard that used to live in `db/preflight-ci-wiring.test.ts`,
// deleted along with the CLI's direct preflight read.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const CI = readFileSync(join(process.cwd(), '.github/workflows/ci.yml'), 'utf8');

describe('CI still gives the restore drill a database', () => {
  it('sets DRILL_TEST_DATABASE_URL for the test step', () => {
    expect(CI).toMatch(/DRILL_TEST_DATABASE_URL:\s*postgres:\/\//);
  });

  it('still runs a PostgreSQL service for it to point at', () => {
    expect(CI).toMatch(/image:\s*postgres:/);
  });

  it('no longer wires the retired preflight variable', () => {
    // Not tidiness: a variable named after a feature that moved is a false
    // trail for whoever debugs this next.
    expect(CI).not.toContain('PREFLIGHT_TEST_DATABASE_URL');
  });
});
