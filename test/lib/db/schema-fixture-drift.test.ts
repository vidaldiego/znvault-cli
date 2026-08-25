// Path: test/lib/db/schema-fixture-drift.test.ts
//
// `test/fixtures/093_key_lifecycle_operations.sql` is a VERBATIM COPY of the
// server's migration. That is a second copy of a contract, and I said as much
// while making it: this package publishes to npm on its own, so CI has no way
// to fetch the server repo, and the ceremony-state tests are worthless against
// a hand-written approximation of the schema — the properties under test ARE
// the index and the trigger.
//
// So the copy stays, and this catches it drifting. It can only run where both
// repositories are checked out side by side, which is every developer machine
// and no CI runner — deliberately: the point is that whoever edits the
// migration finds out immediately, not that CI re-derives it.
//
// IT WAS LOOKING IN EXACTLY ONE PLACE, AND FOUND IT IN NONE. An audit pointed
// out that the single hard-coded `../src/db/migrations/…` assumes this package
// sits directly inside a zn-vault checkout — true of the ordinary layout, false
// of any git worktree, which is where this feature was in fact developed. So
// the guard skipped everywhere, silently, for its whole life: a check that
// cannot find what it compares against reports the same green as a check that
// compared and agreed.
//
// Now it tries the places the migration actually lives, and when it finds none
// it SAYS so instead of vanishing from the run.

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const MIGRATION = '093_key_lifecycle_operations.sql';
const FIXTURE = join(process.cwd(), 'test/fixtures', MIGRATION);

/** Where the server migration might be, in the layouts that actually occur. */
const CANDIDATES = [
  // Explicit override — the escape hatch for a worktree or an unusual checkout.
  process.env.ZN_VAULT_MIGRATIONS_DIR === undefined
    ? null
    : join(process.env.ZN_VAULT_MIGRATIONS_DIR, MIGRATION),
  // The ordinary layout: znvault-cli inside the zn-vault checkout.
  join(process.cwd(), '../src/db/migrations', MIGRATION),
  // Side-by-side checkouts.
  join(process.cwd(), '../zn-vault/src/db/migrations', MIGRATION),
  join(process.cwd(), '../../zn-vault/src/db/migrations', MIGRATION),
].filter((p): p is string => p !== null);

const SOURCE = CANDIDATES.find((p) => existsSync(p));

describe('the key-lifecycle schema fixture', () => {
  it('exists, because the ceremony-state tests need it', () => {
    expect(existsSync(FIXTURE)).toBe(true);
  });

  it.skipIf(SOURCE === undefined)(
    'is byte-identical to the server migration it was copied from',
    () => {
      // If this fails, the migration changed and the fixture did not. Re-copy
      // it; do not edit the fixture to match, and do not "fix" this test.
      expect(readFileSync(FIXTURE, 'utf8')).toBe(readFileSync(SOURCE ?? '', 'utf8'));
    },
  );

  it('reports where it looked, so a permanent skip cannot pass for a pass', () => {
    if (SOURCE === undefined) {
      // Not a failure: this package publishes on its own and CI has no zn-vault
      // checkout. But it must be VISIBLE, which is the whole difference between
      // this and the version that quietly checked nothing anywhere.
      console.warn(
        `[schema-drift] zn-vault migration ${MIGRATION} not found; the fixture was ` +
        `NOT compared. Looked in:\n  ${CANDIDATES.join('\n  ')}\n` +
        'Set ZN_VAULT_MIGRATIONS_DIR to compare it.',
      );
    }
    expect(CANDIDATES.length).toBeGreaterThan(0);
  });
});
