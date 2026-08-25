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

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const FIXTURE = join(process.cwd(), 'test/fixtures/093_key_lifecycle_operations.sql');
// znvault-cli lives inside the zn-vault checkout.
const SOURCE = join(process.cwd(), '../src/db/migrations/093_key_lifecycle_operations.sql');

describe('the key-lifecycle schema fixture', () => {
  it('exists, because the ceremony-state tests need it', () => {
    expect(existsSync(FIXTURE)).toBe(true);
  });

  it.skipIf(!existsSync(SOURCE))(
    'is byte-identical to the server migration it was copied from',
    () => {
      // If this fails, the migration changed and the fixture did not. Re-copy
      // it; do not edit the fixture to match, and do not "fix" this test.
      expect(readFileSync(FIXTURE, 'utf8')).toBe(readFileSync(SOURCE, 'utf8'));
    },
  );
});
