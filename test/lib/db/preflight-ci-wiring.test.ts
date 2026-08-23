// Path: test/lib/db/preflight-ci-wiring.test.ts
//
// The companion that makes a skip safe.
//
// `preflight-readonly.test.ts` is the only proof that the preflight
// transaction is genuinely READ ONLY, and it needs a PostgreSQL. It skips when
// `PREFLIGHT_TEST_DATABASE_URL` is unset, which is a reasonable local
// convenience and a terrible permanent state: a suite that quietly stops
// testing reports success forever. That exact failure was found and removed in
// vault E2E suite 75, where one unrelated defect disarmed an entire file
// through `if (!baselineValid) return;`.
//
// So the skip is bounded by this file, which ALWAYS runs. If someone removes
// the database service from CI, or renames the variable, or drops the env
// binding, the proof stops running — and this test goes red naming exactly
// what went missing. The skip can be a convenience without becoming an escape.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const WORKFLOW = join(process.cwd(), '.github', 'workflows', 'ci.yml');

describe('CI actually runs the read-only proof', () => {
  const ci = readFileSync(WORKFLOW, 'utf8');

  it('starts a PostgreSQL service for the test job', () => {
    expect(ci).toMatch(/services:/);
    expect(ci).toMatch(/image:\s*postgres:/);
  });

  it('passes PREFLIGHT_TEST_DATABASE_URL to the test step', () => {
    // Without this the read-only proof skips in CI and nothing says so.
    expect(ci).toContain('PREFLIGHT_TEST_DATABASE_URL');
  });

  it('waits for the database to be healthy before running tests', () => {
    // A service that is still starting produces a connection error, which
    // reads as "the proof is broken" rather than "the runner was too quick".
    expect(ci).toMatch(/pg_isready/);
  });
});
