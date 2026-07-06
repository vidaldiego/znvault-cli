# Secret References — CLI Authoring Support (Design)

**Date:** 2026-07-06
**Status:** Approved; pending user re-review → implementation plan
**Author:** Diego Vidal (with Claude)
**Scope:** `znvault-cli` only. The server side is shipped and merged to main.

> This is the **CLI-authoring** companion to the server-side feature. Source of truth for
> behavior and security is `zn-vault/docs/superpowers/specs/2026-07-06-secret-references-design.md`
> and `zn-vault/docs/SECRET_REFERENCES_GUIDE.md`. This design adds **only** the CLI flags that
> let an operator *author* links and reference templates and *inspect* raw templates. Reading
> resolved values already works with zero client changes (resolution is server-side at
> `POST /v1/secrets/:id/decrypt`).

## Context

- **Current state:** The CLI can create/update/decrypt secrets, but there is no first-class way
  to author a **link secret** (`subType: 'link'`, `data: { ref, field? }`) or opt a secret in to
  **`${ref:...}` interpolation** (`enableReferences: true`). Today an operator must hand-craft
  `--sub-type link --data '{"ref":...}'` or call the API directly, and there is no way to read a
  secret's **raw, unresolved** template (`?resolve=false`).
- **Problem:** The server feature is live but unreachable ergonomically from the CLI. The user
  guide (`SECRET_REFERENCES_GUIDE.md`) already documents `--link` / `--enable-references` /
  `--no-resolve` as the intended UX; those flags don't exist yet.
- **Solution:** Add three focused capabilities to the existing `secret` command group:
  1. `secret create`: `--enable-references`, and `--link <alias>` + `--link-field <dot.path>`
     (constructs the link secret), with strict conflict rejection.
  2. `secret decrypt`: `--no-resolve` → `?resolve=false` (raw template/pointer), and pass-through
     of the new `resolvedFrom`/`resolved` response fields.
  3. `secret update`: `--enable-references` / `--no-enable-references` for the sticky opt-in.
  4. `secret update` + `secret rotate`: route the **interactive pre-fetch** through `?resolve=false`
     so an interactive edit/rotate never bakes a target's resolved value back into a reference
     template (finding #1 — see *Template-corruption fix*).
  Plus client-side token-alias / dot-path **validation** (typo-catcher; the server remains the
  authority) and updated `--help` examples.
- **Affected components (CLI only):**
  `src/commands/secret/create.ts`, `src/commands/secret/decrypt.ts`,
  `src/commands/secret/update.ts`, `src/commands/secret/rotate.ts`, `src/commands/secret/patch.ts`,
  `src/commands/secret/types.ts`, `src/commands/secret/index.ts` (barrel re-export),
  a **new** `src/commands/secret/references.ts` (validation + link-pointer builder),
  `test/commands/secret.test.ts` + `test/commands/secret-patch.test.ts` + a new
  `test/commands/secret/references.test.ts`. No changes to `helpers.ts`, `resolve.ts`
  are required beyond wiring; the HTTP client already supports query strings embedded in a path.
  A **docs follow-up** to `zn-vault/docs/SECRET_REFERENCES_GUIDE.md` (server repo) is noted but
  **not** performed here (out of CLI scope) — see finding #4.

  > **`patch.ts` — added during the final whole-branch review.** `secret patch` is a **fourth**
  > decrypt-then-write-back edit command (it merges `--set`/`--unset` into the decrypted value and
  > PUTs the result) that the original scope missed. Left resolving, `patch` on a reference secret
  > would bake a resolved snapshot over the template — the same corruption class as `update`/
  > `rotate`, and worse (patch *always* writes back). It gets the identical `?resolve=false`
  > interactive-pre-fetch fix.

## Goals

1. Author a **link secret** from flags: `--link <alias> [--link-field <path>]`.
2. Opt a template secret in to references: `--enable-references` on create and update.
3. Turn opt-in **off** explicitly on update: `--no-enable-references`.
4. Read the **raw** template/pointer: `decrypt --no-resolve`.
5. Surface server-provided provenance/count (`references`, `resolvedFrom`, `resolved`) in plain
   and JSON output.
6. **Client-side validate** the token-alias grammar and field dot-path before the round-trip.

## Non-Goals (YAGNI / guardrails)

- **No client-side `${ref:...}` expander.** The CLI never parses, expands, or resolves tokens
  inside `--data`. It passes the value verbatim; the **server resolves**. This is a hard guardrail.
- **No server, SDK, or dashboard changes.** CLI only.
- **No new dependency-introspection UX** ("what links to X"), consistent with the server non-goals.
- **No dedicated `link create` subcommand.** Links flow through the existing `secret create`.

---

## Design

### 1. `secret create` — link + interpolation authoring

**New options:**

| Flag | Effect |
|------|--------|
| `--enable-references` | Adds `enableReferences: true` to the create body (opt-in for `${ref:...}` resolution). |
| `--link <alias>` | Constructs a **link secret**: sets `subType: 'link'` and `data: { ref: <alias> }`. |
| `--link-field <dot.path>` | Adds `field` to the link pointer. **Requires `--link`.** |

**Behavior — `--link` owns the whole secret (strict):**

- `--link` auto-sets `subType: 'link'` and builds `data: { ref, field? }`. `enableReferences` is
  **not** needed for a link (a link is inherently a reference server-side); if the user passes
  `--enable-references` alongside `--link` it is **silently ignored** (low-friction — approved).
- **Reject** `--link` combined with any data-bearing flag: `--data`, `--text`, `--username`,
  `--password`, `--file` → `error` + `exit(1)`. (Task guardrail.)
- **Reject** `--link` combined with a conflicting `--sub-type` (any value other than `link`) →
  `error` + `exit(1)`. A redundant `--sub-type link` alongside `--link` is **also rejected** for
  simplicity (link implies its own sub-type; nothing to reconcile).
- **Reject** `--link-field` without `--link` → `error` + `exit(1)`.
- **`--link` bypasses interactive data collection and the suggest flow (finding #3).** Today
  `hasNonInteractiveData` (`create.ts:203`) gates the interactive "What type of data?" prompt on
  `--username/--password/--text/--data/--file`; `--link` is none of those, so without a change a
  `--link`-only create would fall into the interactive credential/keyvalue flow and overwrite
  `data`/`actualType`. So `--link` **must** short-circuit: it is handled as its own
  non-interactive branch (build the pointer, set type/subType, skip all data prompts). It also
  **bypasses `--suggest`** (whose AI output mutates `actualType`/`actualSubType` at
  `create.ts:150–155`, fighting the link's forced type/subType). `--suggest --link` together →
  `error` + `exit(1)` (mutually exclusive; a link needs no naming help for its value).
- **Client-side validation** (typo-catcher; server is authority):
  - `--link <alias>` must match the token-alias grammar `^[A-Za-z0-9_][A-Za-z0-9._\-/]*$`
    (leading char is an alphanumeric or `_`, never `-`), length ≤ 512. Invalid → `error` + `exit(1)`.
    This is **exactly** the server's link-`ref` write-validation grammar
    (`reference-validation.ts` applies `TOKEN_ALIAS_RE` to a link's `ref`, not just interpolation
    tokens — verified), so the client check is consistent with the server, not merely stricter.
  - `--link-field <path>` (if present) must be a valid safe dot-path: split on `.`, every segment
    non-empty, none of `__proto__` / `constructor` / `prototype`, total length ≤ 256. Invalid →
    `error` + `exit(1)`.
- **Explicit-`--type` conflict (finding #8).** `--type` has a Commander default of `'opaque'`, so
  the command can't tell `--type opaque` from the default via the options object alone. To keep
  strictness symmetric with the `--sub-type` rejection, use
  `cmd.getOptionValueSource('type') === 'cli'` to detect an **explicit** `--type` and, if it is
  anything other than `setting`, reject it alongside `--link` (a link's type is forced to
  `setting`). An explicit `--type setting` or no `--type` is fine.
- **Response surfacing:** if the create response carries `references: { count: N }`, print
  `References: N` in plain output (a link reports `count: 1`). `--json` already emits the whole
  response verbatim.

**Body shape sent for a link:**

```jsonc
// znvault secret create app/db-pw --link db/prod/creds --link-field password
{
  "alias": "app/db-pw",
  "type": "setting",        // link maps to SETTING server-side; CLI sends type from resolved value (see note)
  "subType": "link",
  "data": { "ref": "db/prod/creds", "field": "password" }
}
```

> **Type note.** The create command already derives `type` (default `opaque`). For a `--link`,
> the server maps `link → SETTING` regardless, and the create route accepts the sub_type as the
> authority. To avoid a mismatch, when `--link` is present the CLI sends `type: 'setting'`
> (matching the server's `SUB_TYPE_TO_TYPE[link] = SETTING`) so the round-trip is coherent, and
> does not require the user to pass `--type`. This is set in the command, not asked of the user.

### 2. `secret decrypt` — `--no-resolve` + provenance pass-through

**New option:** `--no-resolve`. Commander declares this as a negated boolean, so with **only**
`--no-resolve` declared, `options.resolve` is **`true` by default** and becomes `false` when the
flag is passed (it is never `undefined`; finding #9 — the earlier "absent → undefined" wording was
wrong). The command appends the query **only when `options.resolve === false`**, decrypting against
`POST /v1/secrets/${id}/decrypt?resolve=false` and returning the **raw** template/pointer. When the
flag is omitted (`resolve === true`) the path is `.../decrypt` with **no query** — byte-identical to
today's call, so the existing regression test (`secret.test.ts:171`, `post('.../decrypt', {})`)
keeps passing. **Do not** send `?resolve=true` by default.

The HTTP client's `post<T>(path, body)` already splits a query string off the path
(`http.ts:573–587`), so appending `?resolve=false` needs no client change.

**Provenance pass-through:**

- `--json` emits the full response, so `resolvedFrom` / `resolved` flow through untouched.
- **Plain output** (metadata block): when present, print
  - `Resolved from: <alias>[#<field>]` if `secret.resolvedFrom` exists (a resolved link);
  - `Resolved refs: N` if `secret.resolved?.count` exists (an interpolated secret).
- **Field-narrowed link `{ value }` envelope:** a field-narrowed link returns `data: { value: … }`
  (per the server contract, `read.ts:313–315`). The existing generic-data branch already renders
  this correctly; for a cleaner display the plain path **unwraps a lone `{ value }`** object — but
  **only when `secret.resolvedFrom` is present** (finding #7), since the server produces the
  envelope only for a resolved field-narrowed link. This avoids changing plain-mode display for a
  pre-existing ordinary secret whose data legitimately happens to be `{ "value": … }`. `--json` is
  untouched (keeps the envelope).

**Type additions (`DecryptedSecret`):** add optional
`resolvedFrom?: { alias: string; field?: string }` and `resolved?: { count: number }`
(additive; existing paths ignore them).

### 3. `secret update` — sticky opt-in control

**New options:** `--enable-references` / `--no-enable-references`, bound by Commander to a single
`enableReferences` option:

| Flags passed | `options.enableReferences` | Body |
|--------------|----------------------------|------|
| `--enable-references` | `true` | `enableReferences: true` |
| `--no-enable-references` | `false` | `enableReferences: false` |
| neither | `undefined` | field omitted → server keeps sticky opt-in |

The command adds `enableReferences` to the PUT body **only when it is not `undefined`**, so a
plain `update --data '…'` never disturbs the persisted opt-in (the server's sticky-column
guarantee). Same `references: { count: N }` surfacing as create.

> **Commander declaration-order requirement (finding #2 — empirically verified on commander
> 14.0.2).** Declare `--enable-references` **before** `--no-enable-references`. Per Commander's
> documented rule, defining the positive flag first keeps the default `undefined` (absent),
> `--enable-references` → `true`, `--no-enable-references` → `false`. Declaring the **negative
> first or negative only** flips the default to **`true`**, which — combined with the
> "add-to-body-only-when-not-undefined" rule — would force `enableReferences: true` on **every**
> bare `update --data`, force-opting every updated secret into resolution. Spec test 18 (a bare
> `update --data '{}'` must omit `enableReferences`) is the regression tripwire; the ordering is a
> hard requirement, not a style preference.

> `update` is in scope because the sticky opt-in and the guide's "Turning References Off" example
> live there; leaving it out would make a documented workflow unreachable. (User approved.)

> **Guide-syntax contradiction (finding #4, docs follow-up — not fixed here).** The shipped user
> guide `zn-vault/docs/SECRET_REFERENCES_GUIDE.md:124` documents `--enable-references=false` for
> turn-off. Commander 14 rejects that form (`error: unknown option '--enable-references=false'`)
> under the boolean-pair design; the CLI uses `--no-enable-references` instead. Because this task
> is **CLI-only** (guardrail: don't touch server/SDK/dashboard docs), the guide correction is
> **noted as a follow-up**, not performed here. When it is done, replace the `=false` example with
> `--no-enable-references`. (The guide's `decrypt --no-resolve` example already matches this spec.)

### 3a. Template-corruption fix — interactive `update` / `rotate` must pre-fetch raw (finding #1, HIGH)

Now that server-side resolution is live, the **interactive** pre-fetch in both `update` and
`rotate` is a data-corruption hazard:

- `update.ts:50` fetches `current` via a **resolving** `POST /v1/secrets/:id/decrypt` and assigns
  `newData = current.data` **before** the "Update the secret data?" prompt (default **No**);
  answering *No* PUTs the materialized data back (`update.ts:62,111`) — real passwords spliced in
  place of `${ref:...}` tokens, or a link's target value in place of its `{ ref, field }` pointer.
- `rotate.ts:28` fetches `current` resolving and pre-fills the editor with `current.data`
  (`rotate.ts:56`), so a rotate of a reference secret bakes the resolved snapshot into the new
  version.

In both cases the sticky `references_enabled` stays true but `has_references` re-derives to
`false` — the live template is destroyed and a frozen copy of the target is written. This is
exactly the loss `?resolve=false` (server invariant I8) exists to prevent.

**Fix (in scope — both files already listed):** change the interactive pre-fetch in `update.ts`
and `rotate.ts` to `POST /v1/secrets/:id/decrypt?resolve=false`. This is safe **unconditionally**
— for a non-reference secret the server short-circuits on `has_references=false` (`read.ts`) and
returns a byte-identical value, so no behavior changes for ordinary secrets. Tests assert both
interactive pre-fetches carry `?resolve=false` (tests 19–20 below). The `--data`-provided
(non-interactive) paths never pre-fetch and are unaffected.

### 4. Shared module — `src/commands/secret/references.ts` (new)

Pure, dependency-free helpers (unit-testable in isolation, no `${ref:}` expander):

```ts
export interface LinkData { ref: string; field?: string }

// ^[A-Za-z0-9_][A-Za-z0-9._\-/]*$, length <= 512
export function validateTokenAlias(alias: string): { valid: boolean; error?: string };

// split('.'), non-empty segments, reject __proto__/constructor/prototype, total <= 256
export function validateFieldPath(path: string): { valid: boolean; error?: string };

// { ref } or { ref, field }
export function buildLinkData(alias: string, field?: string): LinkData;
```

The constants (512 alias cap, 256 field cap, forbidden segments) come from the server spec's
*Constants* + *Parser & dot-path safety* sections. **Divergence disclosure (finding #6):** the
server's **link write-validation** (`reference-validation.ts`) checks only the alias/field
**grammar** — it applies **no length caps** and **no forbidden-segment check** to a link's `ref`/
`field` (caps + magic-key rejection live in the interpolation-token parser and the read-time
field walker). So the client checks are **stricter than the server's link-write path** in two
narrow, deliberate ways:

- **Forbidden segments** (`__proto__`/`constructor`/`prototype`): rejecting client-side is strictly
  safe — such a field can never resolve at read time (`field-path.ts` rejects them), so nothing
  usable is lost; the client just fails fast instead of storing a dead link.
- **256-char `--link-field` cap:** a longer link field is technically write-and-read-resolvable
  server-side, so this is the one case where the client rejects a value the server would honor. It
  is absurd in practice (a 256-char JSON key) and matches the interpolation-token field cap for
  consistency. Documented here as an intentional divergence, **not** claimed as exact mirroring.

The `--link` **alias** grammar/`512` cap is consistent with the server (its link-`ref` write check
uses the same `TOKEN_ALIAS_RE`; stored aliases max 500, so 512 never rejects a resolvable link).

### 5. Types (`src/commands/secret/types.ts`)

- `CreateOptions`: add `enableReferences?: boolean`, `link?: string`, `linkField?: string`.
- `UpdateOptions`: add `enableReferences?: boolean`.
- `DecryptOptions`: add `resolve?: boolean` (Commander's `--no-resolve` → `false`).
- `DecryptedSecret`: add `resolvedFrom?: { alias: string; field?: string }`,
  `resolved?: { count: number }`.
- Add `LinkData` (or re-export from `references.ts`).
- Response-surfacing: `SecretMetadata` / create response may carry `references?: { count: number }`
  — add optionally so `--json` typing is honest.

### 6. Help text

- `decrypt` `.addHelpText('after', …)`: add a `--no-resolve` example (raw template).
- `create` `.addHelpText('after', …)`: add link + interpolation examples
  (`--link`, `--link --link-field`, `--enable-references` with a `${ref:...}` `--data`).

---

## Error handling

All client-side rejections use the existing pattern: `output.error(<message>)` then
`process.exit(1)` **before** any network call. Messages are actionable:

- `--link cannot be combined with --data/--text/--username/--password/--file (a link's value is its pointer).`
- `--link cannot be combined with --sub-type (a link sets its own sub-type).`
- `--link cannot be combined with an explicit --type other than 'setting' (a link is a setting).`
- `--link cannot be combined with --suggest.`
- `--link-field requires --link.`
- `Invalid --link alias: must start with a letter, number, or underscore and contain only [A-Za-z0-9._-/] (max 512 chars).`
- `Invalid --link-field path: <reason>.`

Server-side reference errors (`reference_unresolvable`, `reference_field_missing`,
`reference_field_not_string`) surface through the existing `catch` → `output.error(err.message)`
path with no special-casing — the server's message is already opaque/safe by design.

## Testing (extend `test/commands/secret.test.ts`)

**Harness reality (finding #5 — the existing file needs three concrete extensions; there are no
`secret create`/`update` tests to mirror today, only list/get/decrypt/delete/rotate/history):**

1. **`process.exit` spy that throws.** The current harness only has `program.exitOverride()`
   (`secret.test.ts:98`), which intercepts **Commander's** own exits, not the explicit
   `process.exit(1)` calls in the command handlers. Any "rejects, no POST" assertion needs
   `const exitSpy = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => { throw new Error(\`exit:${code}\`); }) as never)` in `beforeEach`, and the rejection tests
   `await expect(program.parseAsync(...)).rejects.toThrow(/exit:1/)`. Restore in `afterEach`.
2. **`put` on the client mock.** The mock (`secret.test.ts:59–76`) exposes get/post/patch/delete/
   configure but **no `put`** — `update` calls `client.put` (`update.ts:116`), so add
   `put: vi.fn().mockResolvedValue(mockSecretMetadata)`.
3. **Auth-context mock for `create`.** `create.ts:189` → `getAuthContext()` →
   `auth-context.ts:21–25` calls `hasApiKey()` and `getCredentials()` from `lib/config.js`. The
   config mock (`secret.test.ts:78–81`) provides `getCredentials`/`getConfig` but **no
   `hasApiKey`** and **no `tenantId`** in credentials. Extend it: add
   `hasApiKey: vi.fn().mockReturnValue(false)` and give `getCredentials` a `tenantId`
   (e.g. `'acme'`) so `create` passes the tenant-principal guard (`create.ts:192`).

With those in place, add:

4. `create --link secrets/api-key-prod` → POST `/v1/secrets` with
   `{ subType: 'link', data: { ref: 'secrets/api-key-prod' }, type: 'setting', … }` and **no**
   interactive-inquirer data collision (proves the `--link` non-interactive bypass, finding #3).
5. `create --link a/b --link-field password` → `data: { ref: 'a/b', field: 'password' }`.
6. `create --link a/b --data '{}'` → rejects (`exit:1`), no POST.
7. `create --link a/b --sub-type json` → rejects, no POST.
8. `create --link a/b --type credential` → rejects (explicit non-setting `--type`, finding #8).
9. `create --link a/b --suggest` → rejects (mutually exclusive, finding #3).
10. `create --link-field password` (no `--link`) → rejects, no POST.
11. `create --link "-bad"` → rejects (leading `-`), no POST.
12. `create --link a/b --link-field '__proto__.x'` → rejects, no POST.
13. `create --enable-references --data '{"u":"${ref:db#password}"}'` → POST body includes
    `enableReferences: true` and the raw token verbatim (no expansion — guardrail proof).
14. `decrypt secret-1 --no-resolve` → POST `/v1/secrets/secret-1/decrypt?resolve=false`.
15. `decrypt secret-1` (default) → POST `/v1/secrets/secret-1/decrypt`, **no query** (regression —
    the existing test at `secret.test.ts:171` must keep passing).
16. `update secret-1 --enable-references --data '{}'` → PUT body includes `enableReferences: true`.
17. `update secret-1 --no-enable-references --data '{}'` → PUT body includes `enableReferences: false`.
18. `update secret-1 --data '{}'` → PUT body **omits** `enableReferences` (sticky; also the
    Commander declaration-order tripwire, finding #2).
19. **Interactive `update secret-1`** (no `--data`; inquirer mock answers "don't update data") →
    the **pre-fetch** hits `/v1/secrets/secret-1/decrypt?resolve=false` (finding #1). Requires the
    inquirer mock to return `{ updateData: false }` for this case.
20. **Interactive `rotate secret-1`** → the pre-fetch hits `/v1/secrets/secret-1/decrypt?resolve=false`
    (finding #1).
21. Unit tests for `references.ts`: `validateTokenAlias` (valid/leading-dash/too-long),
    `validateFieldPath` (nested/empty-segment/forbidden-segment/too-long), `buildLinkData`
    (with/without field).

> **Inquirer-mock caveat.** The shared inquirer mock (`secret.test.ts:7–16`) returns a fixed object
> for every prompt. Tests 19–20 need it to answer `updateData: false` (and to not inject data);
> use `vi.mocked(inquirer.prompt).mockResolvedValueOnce(...)` per-test rather than mutating the
> shared default, so the other tests are unaffected.

## Success Criteria

- `secret create --link <alias> [--link-field <path>]` produces a correct link secret; conflicting
  flags are rejected client-side with clear messages.
- `secret create --enable-references` and `secret update --enable-references` /
  `--no-enable-references` send the right `enableReferences` value; omitting it on update sends
  nothing (sticky preserved).
- `secret decrypt --no-resolve` returns the raw template/pointer; default resolves.
- **Interactive `update` / `rotate` pre-fetch raw (`?resolve=false`)**, so an interactive
  edit/rotate of a reference secret never bakes a resolved snapshot into the new version
  (finding #1); ordinary secrets are byte-for-byte unaffected.
- `resolvedFrom` / `resolved` / `references` surface in plain output and pass through `--json`.
- Token-alias grammar and field dot-path are validated client-side (leading `-` rejected).
- No `${ref:...}` expander exists in the CLI; no server/SDK/dashboard files touched.
- `npm run typecheck`, `npm run lint`, and `npm run test:unit` pass.
