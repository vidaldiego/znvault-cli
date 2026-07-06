# Secret References CLI Authoring — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add CLI authoring support for the already-shipped server-side Secret References feature: `secret create --link/--link-field/--enable-references`, `secret decrypt --no-resolve`, `secret update --enable-references/--no-enable-references`, and fix interactive `update`/`rotate` to pre-fetch raw templates.

**Architecture:** Pure-function validation + link-pointer construction in a new `references.ts` module (no `${ref:}` expander — the server resolves). Command files wire flags into request bodies and query strings. The HTTP client already supports embedded `?query` strings and `references:{count}` / `resolvedFrom` / `resolved` response fields, so no client changes are needed.

**Tech Stack:** TypeScript (ES2022, NodeNext), Commander.js 14.0.2, Vitest, the existing `VaultClient` singleton.

## Global Constraints

- **CLI-only.** No changes to server, SDKs, or dashboard. No edits outside `znvault-cli/`.
- **No client-side `${ref:...}` expander.** `--data` is passed verbatim; the server resolves. Hard guardrail.
- **No co-author trailer** in commits. Conventional-commit messages.
- **Release is USER-GATED.** Build + test + commit only; do NOT bump version, tag, or push. Current version is `4.15.2`.
- **ESLint strictness:** `no-explicit-any` = error; `no-unsafe-*` = error; `no-floating-promises` = error; explicit return types required on exported functions.
- **Commander declaration order:** for a boolean pair, declare the **positive** flag (`--enable-references`) BEFORE the negative (`--no-enable-references`) so the default stays `undefined`. Declaring negative-first flips the default to `true` — a silent force-opt-in bug.
- **Token-alias grammar (exact, matches server):** `^[A-Za-z0-9_][A-Za-z0-9._\-/]*$`, max length 512.
- **Field dot-path:** split on `.`, every segment non-empty, none of `__proto__`/`constructor`/`prototype`, total length ≤ 256.
- **Link secrets send `type: 'setting'`** (server maps `link → SETTING` and stores `type` verbatim; a missing override persists an incoherent `type='opaque'/sub_type='link'` row).
- Verify commands: `npm run typecheck`, `npm run lint`, `npm run test:unit`.

---

### Task 1: `references.ts` — validation + link-pointer builder (pure module)

**Files:**
- Create: `src/commands/secret/references.ts`
- Test: `test/commands/secret/references.test.ts`

**Interfaces:**
- Consumes: nothing (pure, no imports).
- Produces:
  - `interface LinkData { ref: string; field?: string }`
  - `interface ValidationResult { valid: boolean; error?: string }`
  - `function validateTokenAlias(alias: string): ValidationResult`
  - `function validateFieldPath(path: string): ValidationResult`
  - `function buildLinkData(alias: string, field?: string): LinkData`
  - Constants `TOKEN_ALIAS_MAX = 512`, `FIELD_PATH_MAX = 256`.

- [ ] **Step 1: Write the failing test**

```typescript
// test/commands/secret/references.test.ts
import { describe, it, expect } from 'vitest';
import {
  validateTokenAlias,
  validateFieldPath,
  buildLinkData,
} from '../../../src/commands/secret/references.js';

describe('references', () => {
  describe('validateTokenAlias', () => {
    it('accepts a normal path alias', () => {
      expect(validateTokenAlias('db/prod/creds')).toEqual({ valid: true });
    });
    it('accepts leading underscore and digits', () => {
      expect(validateTokenAlias('_x9/a.b-c')).toEqual({ valid: true });
    });
    it('rejects a leading dash (shell ${ref:-default} collision)', () => {
      const r = validateTokenAlias('-bad');
      expect(r.valid).toBe(false);
      expect(r.error).toMatch(/start with/i);
    });
    it('rejects an empty alias', () => {
      expect(validateTokenAlias('').valid).toBe(false);
    });
    it('rejects characters outside the grammar', () => {
      expect(validateTokenAlias('has space').valid).toBe(false);
      expect(validateTokenAlias('a#b').valid).toBe(false);
    });
    it('rejects an alias longer than 512 chars', () => {
      expect(validateTokenAlias('a'.repeat(513)).valid).toBe(false);
    });
  });

  describe('validateFieldPath', () => {
    it('accepts a nested dot-path', () => {
      expect(validateFieldPath('db.host')).toEqual({ valid: true });
    });
    it('accepts a single segment', () => {
      expect(validateFieldPath('password')).toEqual({ valid: true });
    });
    it('rejects an empty segment', () => {
      expect(validateFieldPath('a..b').valid).toBe(false);
      expect(validateFieldPath('.a').valid).toBe(false);
      expect(validateFieldPath('a.').valid).toBe(false);
    });
    it('rejects an empty path', () => {
      expect(validateFieldPath('').valid).toBe(false);
    });
    it('rejects prototype-pollution segments', () => {
      expect(validateFieldPath('__proto__.x').valid).toBe(false);
      expect(validateFieldPath('a.constructor').valid).toBe(false);
      expect(validateFieldPath('prototype').valid).toBe(false);
    });
    it('rejects a path longer than 256 chars', () => {
      expect(validateFieldPath('a'.repeat(257)).valid).toBe(false);
    });
  });

  describe('buildLinkData', () => {
    it('builds a field-less pointer', () => {
      expect(buildLinkData('db/prod/creds')).toEqual({ ref: 'db/prod/creds' });
    });
    it('builds a field-narrowed pointer', () => {
      expect(buildLinkData('db/prod/creds', 'password')).toEqual({
        ref: 'db/prod/creds',
        field: 'password',
      });
    });
    it('omits an empty field', () => {
      expect(buildLinkData('db/prod/creds', '')).toEqual({ ref: 'db/prod/creds' });
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:unit -- test/commands/secret/references.test.ts`
Expected: FAIL — cannot resolve `../../../src/commands/secret/references.js`.

- [ ] **Step 3: Write the implementation**

```typescript
// Path: src/commands/secret/references.ts

/**
 * Client-side validation and construction helpers for Secret References.
 *
 * NOTE: This module deliberately contains NO `${ref:...}` token expander.
 * Reference resolution is performed server-side at decrypt time; the CLI only
 * validates the token-alias / field-path grammar (a typo-catcher — the server
 * remains the authority) and builds the structured link pointer.
 */

/** Structured link-secret payload: a pointer to another secret. */
export interface LinkData {
  ref: string;
  field?: string;
}

/** Result of a client-side validation check. */
export interface ValidationResult {
  valid: boolean;
  error?: string;
}

/** Max length of a token-alias (matches the server's TOKEN_ALIAS_MAX). */
export const TOKEN_ALIAS_MAX = 512;

/** Max length of a field dot-path (matches the interpolation-token field cap). */
export const FIELD_PATH_MAX = 256;

// Must start with an alphanumeric or underscore (never `-`, so bash
// `${ref:-default}` is never a token), then allow `. _ - / A-Z a-z 0-9`.
const TOKEN_ALIAS_RE = /^[A-Za-z0-9_][A-Za-z0-9._\-/]*$/;

// Field segments that would enable prototype pollution or inherited lookups.
const FORBIDDEN_SEGMENTS = new Set(['__proto__', 'constructor', 'prototype']);

/**
 * Validate a `--link` alias against the server's token-alias grammar.
 */
export function validateTokenAlias(alias: string): ValidationResult {
  if (alias.length === 0) {
    return { valid: false, error: 'alias must not be empty' };
  }
  if (alias.length > TOKEN_ALIAS_MAX) {
    return { valid: false, error: `alias must be at most ${TOKEN_ALIAS_MAX} characters` };
  }
  if (!TOKEN_ALIAS_RE.test(alias)) {
    return {
      valid: false,
      error:
        'alias must start with a letter, number, or underscore and contain only '
        + '[A-Za-z0-9._-/]',
    };
  }
  return { valid: true };
}

/**
 * Validate a `--link-field` dot-path: non-empty segments, no prototype-pollution
 * keys, within the length cap.
 */
export function validateFieldPath(path: string): ValidationResult {
  if (path.length === 0) {
    return { valid: false, error: 'field path must not be empty' };
  }
  if (path.length > FIELD_PATH_MAX) {
    return { valid: false, error: `field path must be at most ${FIELD_PATH_MAX} characters` };
  }
  const segments = path.split('.');
  for (const segment of segments) {
    if (segment.length === 0) {
      return { valid: false, error: 'field path has an empty segment' };
    }
    if (FORBIDDEN_SEGMENTS.has(segment)) {
      return { valid: false, error: `field path segment "${segment}" is not allowed` };
    }
  }
  return { valid: true };
}

/**
 * Build a link pointer from an alias and optional field. An empty/undefined
 * field is omitted (a field-less link returns the target's whole value).
 */
export function buildLinkData(alias: string, field?: string): LinkData {
  if (field !== undefined && field.length > 0) {
    return { ref: alias, field };
  }
  return { ref: alias };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:unit -- test/commands/secret/references.test.ts`
Expected: PASS (all cases green).

- [ ] **Step 5: Typecheck + lint**

Run: `npm run typecheck && npm run lint`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/commands/secret/references.ts test/commands/secret/references.test.ts
git commit -m "feat(secret): add reference validation + link-pointer helpers"
```

---

### Task 2: Types for reference options + response fields

**Files:**
- Modify: `src/commands/secret/types.ts`

**Interfaces:**
- Consumes: `LinkData` from `references.ts` (Task 1).
- Produces (added to existing interfaces):
  - `CreateOptions`: `enableReferences?: boolean; link?: string; linkField?: string`
  - `UpdateOptions`: `enableReferences?: boolean`
  - `DecryptOptions`: `resolve?: boolean`
  - `DecryptedSecret`: `resolvedFrom?: { alias: string; field?: string }; resolved?: { count: number }`
  - `SecretMetadata`: `references?: { count: number }`

- [ ] **Step 1: Apply the type edits**

In `src/commands/secret/types.ts`:

Add to the `SecretMetadata` interface (after `updatedAt: string;`):
```typescript
  references?: { count: number };
```

Add to the `DecryptedSecret` interface (after `content_type?: string;`):
```typescript
  resolvedFrom?: { alias: string; field?: string };
  resolved?: { count: number };
```

Add to the `DecryptOptions` interface (after `json?: boolean;`):
```typescript
  resolve?: boolean; // Commander's `--no-resolve` sets this to false
```

Add to the `CreateOptions` interface (after `file?: string;`):
```typescript
  enableReferences?: boolean;
  link?: string;
  linkField?: string;
```

Add to the `UpdateOptions` interface (after `data?: string;`):
```typescript
  enableReferences?: boolean;
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: no errors (these are additive optional fields).

- [ ] **Step 3: Commit**

```bash
git add src/commands/secret/types.ts
git commit -m "feat(secret): add reference option/response types"
```

---

### Task 3: `secret decrypt --no-resolve` + provenance output

**Files:**
- Modify: `src/commands/secret/decrypt.ts`
- Test: `test/commands/secret.test.ts` (extend)

**Interfaces:**
- Consumes: `DecryptOptions.resolve`, `DecryptedSecret.resolvedFrom`, `DecryptedSecret.resolved` (Task 2).
- Produces: decrypt path appends `?resolve=false` iff `options.resolve === false`.

- [ ] **Step 1: Extend the test harness, then write failing tests**

First, extend the mocks in `test/commands/secret.test.ts`:

Add `put` to the `client` mock (inside `vi.mock('../../src/lib/client.js', …)`, alongside `patch`):
```typescript
    put: vi.fn().mockResolvedValue(mockSecretMetadata),
```

Add `keyValue` and `section` to the `output.js` mock:
```typescript
  keyValue: vi.fn(),
  section: vi.fn(),
```

Add a `process.exit` spy in the `describe('secret commands', …)` block. Inside `beforeEach`, after `program.exitOverride();`:
```typescript
    exitSpy = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`exit:${code ?? 0}`);
    }) as never);
```
Declare `let exitSpy: ReturnType<typeof vi.spyOn>;` next to `consoleSpy`, and in `afterEach` add `exitSpy.mockRestore();`.

Now add the decrypt tests inside `describe('secret decrypt', …)`:
```typescript
    it('sends ?resolve=false with --no-resolve', async () => {
      const { client } = await import('../../src/lib/client.js');
      await program.parseAsync(['node', 'test', 'secret', 'decrypt', 'secret-1', '--no-resolve']);
      expect(client.post).toHaveBeenCalledWith('/v1/secrets/secret-1/decrypt?resolve=false', {});
    });

    it('sends no query by default (regression)', async () => {
      const { client } = await import('../../src/lib/client.js');
      await program.parseAsync(['node', 'test', 'secret', 'decrypt', 'secret-1']);
      expect(client.post).toHaveBeenCalledWith('/v1/secrets/secret-1/decrypt', {});
    });
```

- [ ] **Step 2: Run tests to verify the --no-resolve one fails**

Run: `npm run test:unit -- test/commands/secret.test.ts -t "resolve"`
Expected: the `--no-resolve` test FAILS (path has no query yet); the regression test passes.

- [ ] **Step 3: Implement `--no-resolve` and provenance output**

In `src/commands/secret/decrypt.ts`:

Add the option (after the `--json` option, before `.addHelpText`):
```typescript
    .option('--no-resolve', 'Return the raw, unresolved template/pointer (skip reference resolution)')
```

Update the help text block to add a `--no-resolve` example line (inside the existing `addHelpText('after', …)` template, before the closing backtick):
```
  znvault secret decrypt app/db-url --no-resolve     # raw template, tokens unexpanded
```

Change the decrypt call to append the query conditionally. Replace:
```typescript
        const secret = await client.post<DecryptedSecret>(`/v1/secrets/${id}/decrypt`, {});
```
with:
```typescript
        // Commander sets `resolve` to false only when `--no-resolve` is passed
        // (default true). Append the query ONLY on explicit false — a default
        // decrypt stays byte-identical to the pre-feature call.
        const query = options.resolve === false ? '?resolve=false' : '';
        const secret = await client.post<DecryptedSecret>(`/v1/secrets/${id}/decrypt${query}`, {});
```

In the metadata block (after the `Version:` console.log line), add provenance lines:
```typescript
        if (secret.resolvedFrom) {
          const from = secret.resolvedFrom.field
            ? `${secret.resolvedFrom.alias}#${secret.resolvedFrom.field}`
            : secret.resolvedFrom.alias;
          console.log(`Resolved from: ${from}`);
        }
        if (secret.resolved) {
          console.log(`Resolved refs: ${secret.resolved.count}`);
        }
```

For the field-narrowed-link `{ value }` envelope, unwrap it for display ONLY when the response is a resolved link. In the "Generic key-value" `else` branch, replace:
```typescript
        } else {
          // Generic key-value
          console.log(JSON.stringify(secret.data, null, 2));
        }
```
with:
```typescript
        } else {
          // A resolved field-narrowed link wraps a non-object value as { value }.
          // Unwrap for display, but only when this is a resolved link (the server
          // produces the envelope only then) so an ordinary { value } secret is
          // rendered unchanged.
          const keys = secret.data ? Object.keys(secret.data) : [];
          if (secret.resolvedFrom && keys.length === 1 && keys[0] === 'value') {
            console.log(JSON.stringify(secret.data.value, null, 2));
          } else {
            console.log(JSON.stringify(secret.data, null, 2));
          }
        }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test:unit -- test/commands/secret.test.ts -t "resolve"`
Expected: both PASS.

- [ ] **Step 5: Typecheck + lint + full secret test file**

Run: `npm run typecheck && npm run lint && npm run test:unit -- test/commands/secret.test.ts`
Expected: no errors; all existing secret tests still pass.

- [ ] **Step 6: Commit**

```bash
git add src/commands/secret/decrypt.ts test/commands/secret.test.ts
git commit -m "feat(secret): add decrypt --no-resolve and reference provenance output"
```

---

### Task 4: `secret update` sticky opt-in + interactive raw pre-fetch

**Files:**
- Modify: `src/commands/secret/update.ts`
- Test: `test/commands/secret.test.ts` (extend)

**Interfaces:**
- Consumes: `UpdateOptions.enableReferences` (Task 2), the `put`/`exitSpy` harness (Task 3).
- Produces: PUT body includes `enableReferences` iff not `undefined`; interactive pre-fetch uses `?resolve=false`.

- [ ] **Step 1: Write failing tests**

Add a `describe('secret update', …)` block to `test/commands/secret.test.ts` (place after the `secret rotate` describe):
```typescript
  describe('secret update', () => {
    it('sends enableReferences:true with --enable-references', async () => {
      const { client } = await import('../../src/lib/client.js');
      await program.parseAsync([
        'node', 'test', 'secret', 'update', 'secret-1',
        '--enable-references', '--data', '{"a":1}',
      ]);
      expect(client.put).toHaveBeenCalledWith(
        '/v1/secrets/secret-1',
        expect.objectContaining({ enableReferences: true }),
      );
    });

    it('sends enableReferences:false with --no-enable-references', async () => {
      const { client } = await import('../../src/lib/client.js');
      await program.parseAsync([
        'node', 'test', 'secret', 'update', 'secret-1',
        '--no-enable-references', '--data', '{"a":1}',
      ]);
      expect(client.put).toHaveBeenCalledWith(
        '/v1/secrets/secret-1',
        expect.objectContaining({ enableReferences: false }),
      );
    });

    it('omits enableReferences when neither flag is passed (sticky)', async () => {
      const { client } = await import('../../src/lib/client.js');
      await program.parseAsync([
        'node', 'test', 'secret', 'update', 'secret-1', '--data', '{"a":1}',
      ]);
      const call = vi.mocked(client.put).mock.calls.at(-1);
      expect(call?.[1]).not.toHaveProperty('enableReferences');
    });

    it('interactive pre-fetch uses ?resolve=false', async () => {
      const inquirer = (await import('inquirer')).default;
      vi.mocked(inquirer.prompt).mockResolvedValueOnce({ updateData: false } as never);
      const { client } = await import('../../src/lib/client.js');
      await program.parseAsync(['node', 'test', 'secret', 'update', 'secret-1']);
      expect(client.post).toHaveBeenCalledWith('/v1/secrets/secret-1/decrypt?resolve=false', {});
    });
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test:unit -- test/commands/secret.test.ts -t "secret update"`
Expected: FAIL — options don't exist / pre-fetch has no query.

- [ ] **Step 3: Implement**

In `src/commands/secret/update.ts`:

Add the boolean-pair options. After the `--data <json>` option, add (positive FIRST — declaration order matters):
```typescript
    .option('--enable-references', 'Opt this secret in to ${ref:...} reference resolution')
    .option('--no-enable-references', 'Disable reference resolution (turn opt-in off)')
```

Change the interactive pre-fetch to raw. Replace:
```typescript
          const current = await client.post<DecryptedSecret>(`/v1/secrets/${id}/decrypt`, {});
```
with:
```typescript
          // Pre-fetch the RAW template so answering "no" to the edit prompt (or
          // editing) never writes a resolved snapshot back over a reference
          // secret. Byte-identical for non-reference secrets.
          const current = await client.post<DecryptedSecret>(
            `/v1/secrets/${id}/decrypt?resolve=false`,
            {},
          );
```

Add `enableReferences` to the PUT body. Replace:
```typescript
        const body: Record<string, unknown> = { data: newData };
        if (options.tags) body.tags = options.tags.split(',').map(t => t.trim());
        if (options.ttl) body.ttlUntil = options.ttl;
        if (options.expires) body.expiresAt = options.expires;
```
with:
```typescript
        const body: Record<string, unknown> = { data: newData };
        if (options.tags) body.tags = options.tags.split(',').map(t => t.trim());
        if (options.ttl) body.ttlUntil = options.ttl;
        if (options.expires) body.expiresAt = options.expires;
        // Only send when explicitly set; omitting preserves the server's sticky opt-in.
        if (options.enableReferences !== undefined) {
          body.enableReferences = options.enableReferences;
        }
```

Surface `references.count` on success. Replace:
```typescript
        output.success('Secret updated successfully!');
        console.log(`  Version: ${result.version}`);
```
with:
```typescript
        output.success('Secret updated successfully!');
        console.log(`  Version: ${result.version}`);
        if (result.references) {
          console.log(`  References: ${result.references.count}`);
        }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test:unit -- test/commands/secret.test.ts -t "secret update"`
Expected: all PASS.

- [ ] **Step 5: Typecheck + lint + full secret test file**

Run: `npm run typecheck && npm run lint && npm run test:unit -- test/commands/secret.test.ts`
Expected: no errors; all existing tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/commands/secret/update.ts test/commands/secret.test.ts
git commit -m "feat(secret): add update --enable-references + raw interactive pre-fetch"
```

---

### Task 5: `secret rotate` interactive raw pre-fetch

**Files:**
- Modify: `src/commands/secret/rotate.ts`
- Test: `test/commands/secret.test.ts` (extend)

**Interfaces:**
- Consumes: the harness from Task 3.
- Produces: rotate's pre-fetch uses `?resolve=false`.

- [ ] **Step 1: Write the failing test**

Add to the existing `describe('secret rotate', …)` block in `test/commands/secret.test.ts`:
```typescript
    it('pre-fetch uses ?resolve=false', async () => {
      const inquirer = (await import('inquirer')).default;
      vi.mocked(inquirer.prompt).mockResolvedValueOnce({ dataJson: '{"apiKey":"x"}' } as never);
      const { client } = await import('../../src/lib/client.js');
      await program.parseAsync(['node', 'test', 'secret', 'rotate', 'secret-1']);
      expect(client.post).toHaveBeenCalledWith('/v1/secrets/secret-1/decrypt?resolve=false', {});
    });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:unit -- test/commands/secret.test.ts -t "pre-fetch uses"`
Expected: FAIL — rotate's pre-fetch has no query.

- [ ] **Step 3: Implement**

In `src/commands/secret/rotate.ts`, replace:
```typescript
        const current = await client.post<DecryptedSecret>(`/v1/secrets/${id}/decrypt`, {});
```
with:
```typescript
        // Pre-fetch the RAW template so rotating a reference secret never bakes a
        // resolved snapshot into the new version. Byte-identical for others.
        const current = await client.post<DecryptedSecret>(
          `/v1/secrets/${id}/decrypt?resolve=false`,
          {},
        );
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:unit -- test/commands/secret.test.ts -t "pre-fetch uses"`
Expected: PASS.

- [ ] **Step 5: Typecheck + lint**

Run: `npm run typecheck && npm run lint && npm run test:unit -- test/commands/secret.test.ts`
Expected: no errors; all tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/commands/secret/rotate.ts test/commands/secret.test.ts
git commit -m "fix(secret): rotate pre-fetches raw template (no resolved-snapshot corruption)"
```

---

### Task 6: `secret create` — link + enable-references authoring

**Files:**
- Modify: `src/commands/secret/create.ts`
- Test: `test/commands/secret.test.ts` (extend)

**Interfaces:**
- Consumes: `validateTokenAlias`, `validateFieldPath`, `buildLinkData` (Task 1); `CreateOptions` fields (Task 2); harness with auth-context extensions (this task).
- Produces: `create --link` builds a link secret; conflict rejection; `--enable-references` in body.

- [ ] **Step 1: Extend the test harness for `create` auth, then write failing tests**

Extend the `config.js` mock in `test/commands/secret.test.ts` so `getAuthContext()` yields a tenant principal. Replace:
```typescript
vi.mock('../../src/lib/config.js', () => ({
  getCredentials: vi.fn().mockReturnValue({ accessToken: 'token' }),
  getConfig: vi.fn().mockReturnValue({ url: 'https://localhost:8443', insecure: false, timeout: 30000 }),
}));
```
with:
```typescript
vi.mock('../../src/lib/config.js', () => ({
  getCredentials: vi.fn().mockReturnValue({ accessToken: 'token', tenantId: 'acme', role: 'admin' }),
  getConfig: vi.fn().mockReturnValue({ url: 'https://localhost:8443', insecure: false, timeout: 30000 }),
  hasApiKey: vi.fn().mockReturnValue(false),
}));
```

Add a `describe('secret create', …)` block (place after `secret update`):
```typescript
  describe('secret create', () => {
    it('builds a link secret from --link', async () => {
      const { client } = await import('../../src/lib/client.js');
      await program.parseAsync([
        'node', 'test', 'secret', 'create', 'api/current-key',
        '--link', 'secrets/api-key-prod',
      ]);
      expect(client.post).toHaveBeenCalledWith('/v1/secrets', expect.objectContaining({
        alias: 'api/current-key',
        type: 'setting',
        subType: 'link',
        data: { ref: 'secrets/api-key-prod' },
      }));
    });

    it('builds a field-narrowed link from --link --link-field', async () => {
      const { client } = await import('../../src/lib/client.js');
      await program.parseAsync([
        'node', 'test', 'secret', 'create', 'app/db-pw',
        '--link', 'db/prod/creds', '--link-field', 'password',
      ]);
      expect(client.post).toHaveBeenCalledWith('/v1/secrets', expect.objectContaining({
        subType: 'link',
        data: { ref: 'db/prod/creds', field: 'password' },
      }));
    });

    it('sends the raw ${ref:...} token verbatim with --enable-references (no expansion)', async () => {
      const { client } = await import('../../src/lib/client.js');
      await program.parseAsync([
        'node', 'test', 'secret', 'create', 'app/url',
        '--sub-type', 'env', '--enable-references',
        '--data', '{"u":"${ref:db#password}"}',
      ]);
      expect(client.post).toHaveBeenCalledWith('/v1/secrets', expect.objectContaining({
        enableReferences: true,
        data: { u: '${ref:db#password}' },
      }));
    });

    it('rejects --link with --data', async () => {
      const { client } = await import('../../src/lib/client.js');
      await expect(program.parseAsync([
        'node', 'test', 'secret', 'create', 'x', '--link', 'a/b', '--data', '{}',
      ])).rejects.toThrow(/exit:1/);
      expect(client.post).not.toHaveBeenCalledWith('/v1/secrets', expect.anything());
    });

    it('rejects --link with a conflicting --sub-type', async () => {
      await expect(program.parseAsync([
        'node', 'test', 'secret', 'create', 'x', '--link', 'a/b', '--sub-type', 'json',
      ])).rejects.toThrow(/exit:1/);
    });

    it('rejects --link with an explicit non-setting --type', async () => {
      await expect(program.parseAsync([
        'node', 'test', 'secret', 'create', 'x', '--link', 'a/b', '--type', 'credential',
      ])).rejects.toThrow(/exit:1/);
    });

    it('rejects --link with --suggest', async () => {
      await expect(program.parseAsync([
        'node', 'test', 'secret', 'create', 'x', '--link', 'a/b', '--suggest',
      ])).rejects.toThrow(/exit:1/);
    });

    it('rejects --link-field without --link', async () => {
      await expect(program.parseAsync([
        'node', 'test', 'secret', 'create', 'x', '--link-field', 'password',
      ])).rejects.toThrow(/exit:1/);
    });

    it('rejects a --link alias with a leading dash', async () => {
      await expect(program.parseAsync([
        'node', 'test', 'secret', 'create', 'x', '--link', '-bad',
      ])).rejects.toThrow(/exit:1/);
    });

    it('rejects a --link-field with a prototype-pollution segment', async () => {
      await expect(program.parseAsync([
        'node', 'test', 'secret', 'create', 'x', '--link', 'a/b', '--link-field', '__proto__.x',
      ])).rejects.toThrow(/exit:1/);
    });
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test:unit -- test/commands/secret.test.ts -t "secret create"`
Expected: FAIL — link options don't exist.

- [ ] **Step 3: Implement the create changes**

In `src/commands/secret/create.ts`:

Add the import at the top (after the existing `./pem-analysis.js` import):
```typescript
import { validateTokenAlias, validateFieldPath, buildLinkData } from './references.js';
```

Add the three options to the existing chain (after the `--data <json>` option, before `--file`):
```typescript
    .option('--enable-references', 'Opt this secret in to ${ref:...} reference resolution')
    .option('--link <alias>', 'Create a link secret pointing at another secret (sets sub-type link)')
    .option('--link-field <path>', 'Narrow a --link to a single field (dot-path, e.g. password or db.host)')
```

Capture the command instance via the action's THIRD argument (Commander 14 passes it —
verified — so `getOptionValueSource` is reachable without restructuring the chain). Change the
action signature:
```typescript
    .action(async (aliasOrDescription: string, options: CreateOptions) => {
```
to:
```typescript
    .action(async (aliasOrDescription: string, options: CreateOptions, cmd: Command) => {
```

Add link handling + conflict rejection at the very top of the `.action` callback, before the `--suggest` flow (i.e. immediately after `let actualTags = options.tags;`):
```typescript
      // --- Link-secret construction and conflict gating (Secret References) ---
      let linkData: Record<string, unknown> | undefined;
      if (options.link !== undefined) {
        const dataBearing = options.data || options.text || options.username
          || options.password || options.file;
        if (dataBearing) {
          output.error(
            '--link cannot be combined with --data/--text/--username/--password/--file '
            + "(a link's value is its pointer).",
          );
          process.exit(1);
        }
        if (options.subType && options.subType !== 'link') {
          output.error('--link cannot be combined with --sub-type (a link sets its own sub-type).');
          process.exit(1);
        }
        if (cmd.getOptionValueSource('type') === 'cli' && options.type !== 'setting') {
          output.error("--link cannot be combined with an explicit --type other than 'setting'.");
          process.exit(1);
        }
        if (options.suggest) {
          output.error('--link cannot be combined with --suggest.');
          process.exit(1);
        }
        const aliasCheck = validateTokenAlias(options.link);
        if (!aliasCheck.valid) {
          output.error(`Invalid --link alias: ${aliasCheck.error}.`);
          process.exit(1);
        }
        if (options.linkField !== undefined) {
          const fieldCheck = validateFieldPath(options.linkField);
          if (!fieldCheck.valid) {
            output.error(`Invalid --link-field path: ${fieldCheck.error}.`);
            process.exit(1);
          }
        }
        linkData = buildLinkData(options.link, options.linkField) as Record<string, unknown>;
        actualType = 'setting';
        actualSubType = 'link';
      } else if (options.linkField !== undefined) {
        output.error('--link-field requires --link.');
        process.exit(1);
      }
```

Route the data-collection so a link skips it. Change the data-mode gate. Replace:
```typescript
      let data: Record<string, unknown> = {};

      // Check for non-interactive data options first
      const hasNonInteractiveData = options.username || options.password || options.text || options.data || options.file;

      if (hasNonInteractiveData) {
```
with:
```typescript
      let data: Record<string, unknown> = {};

      // Check for non-interactive data options first. A --link owns the value
      // (its pointer), so it bypasses both interactive and other non-interactive
      // data collection.
      const hasNonInteractiveData = options.username || options.password || options.text || options.data || options.file;

      if (linkData) {
        data = linkData;
      } else if (hasNonInteractiveData) {
```

Add `enableReferences` and `subType` to the request body. Find the body-building block:
```typescript
        if (actualSubType) body.subType = actualSubType;
        if (actualTags) body.tags = actualTags.split(',').map(t => t.trim());
        if (options.ttl) body.ttlUntil = options.ttl;
        if (options.expires) body.expiresAt = options.expires;
        if (options.contentType) body.contentType = options.contentType;
```
and add after it:
```typescript
        // Opt in to ${ref:...} resolution (ignored for a link — inherently a reference).
        if (options.enableReferences !== undefined && !linkData) {
          body.enableReferences = options.enableReferences;
        }
```

Surface `references.count` on success. Replace:
```typescript
        output.success(`Secret created successfully!`);
        console.log(`  ID:     ${result.id}`);
        console.log(`  Alias:  ${result.alias}`);
        console.log(`  Tenant: ${result.tenant}`);
```
with:
```typescript
        output.success(`Secret created successfully!`);
        console.log(`  ID:     ${result.id}`);
        console.log(`  Alias:  ${result.alias}`);
        console.log(`  Tenant: ${result.tenant}`);
        if (result.references) {
          console.log(`  References: ${result.references.count}`);
        }
```

Add create help examples by inserting `.addHelpText('after', …)` INTO the existing command chain,
between the last `.option('--link-field …')` (added above) and `.action(...)`:
```typescript
    .addHelpText('after', `
Examples:
  znvault secret create api/current-key --link secrets/api-key-prod
  znvault secret create app/db-pw --link db/prod/creds --link-field password
  znvault secret create app/db-url --sub-type env --enable-references \\
    --data '{"DATABASE_URL":"postgres://app:\${ref:db/prod/creds#password}@db:5432/app"}'
`)
```
(No trailing semicolon — it stays in the chain before `.action(`.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test:unit -- test/commands/secret.test.ts -t "secret create"`
Expected: all PASS.

- [ ] **Step 5: Full verification**

Run: `npm run typecheck && npm run lint && npm run test:unit -- test/commands/secret.test.ts`
Expected: no errors; all secret tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/commands/secret/create.ts test/commands/secret.test.ts
git commit -m "feat(secret): add create --link/--link-field/--enable-references authoring"
```

---

### Task 7: Full suite + lint gate + reference-module export wiring

**Files:**
- Modify: `src/commands/secret/index.ts` (re-export references helpers)

**Interfaces:**
- Consumes: everything above.
- Produces: `references.ts` exports are re-exported for consistency with `helpers.ts`/`resolve.ts`.

- [ ] **Step 1: Re-export references from the index barrel**

In `src/commands/secret/index.ts`, after the existing `export * from './resolve.js';` line add:
```typescript
export * from './references.js';
```

- [ ] **Step 2: Run the full unit suite + lint + typecheck**

Run: `npm run typecheck && npm run lint && npm run test:unit`
Expected: no errors; entire unit suite green (including `references.test.ts` and all `secret.test.ts` cases).

- [ ] **Step 3: Commit**

```bash
git add src/commands/secret/index.ts
git commit -m "chore(secret): re-export reference helpers from the secret barrel"
```

---

## Post-implementation (USER-GATED — do NOT run without approval)

Do not bump the version, tag, or push. When the user approves the release:
- `npm version patch` (→ 4.15.3)
- commit the version bump, tag `v4.15.3`, push `main` + tag (CI publishes to npm).

## Verification Summary

After all tasks:
- `npm run typecheck` — clean.
- `npm run lint` — clean.
- `npm run test:unit` — all green, including the new `references.test.ts` and the extended `secret.test.ts`.
- Manual sanity (optional, needs a live vault): `znvault secret create x --link a/b --link-field password --json` produces a link body; `znvault secret decrypt x --no-resolve` returns the raw pointer.
