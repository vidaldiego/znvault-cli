// Path: test/lib/db/key-lifecycle-ci-wiring.test.ts
//
// The companion that makes a skip safe.
//
// `key-lifecycle.test.ts` is the only proof that the ceremony's exclusion, its
// append-only history and its crash-resumability actually work, and it needs a
// PostgreSQL carrying migration 093. It skips when the URL is unset — a fine
// local convenience and a terrible permanent state, because a suite that
// quietly stops testing reports success forever.
//
// So the skip is bounded by this file, which ALWAYS runs.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const CI = readFileSync(join(process.cwd(), '.github', 'workflows', 'ci.yml'), 'utf8');

describe('CI actually runs the ceremony-state proof', () => {
  it('passes CEREMONY_TEST_DATABASE_URL to the test step', () => {
    expect(CI).toContain('CEREMONY_TEST_DATABASE_URL');
  });

  it('applies migration 093 before the tests', () => {
    // Without the schema the suite would skip, and the skip would be invisible.
    expect(CI).toMatch(/093_key_lifecycle_operations/);
  });
});
