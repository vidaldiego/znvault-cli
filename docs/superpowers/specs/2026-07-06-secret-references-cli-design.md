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
  Plus client-side token-alias / dot-path **validation** (typo-catcher; the server remains the
  authority) and updated `--help` examples.
- **Affected components (CLI only):**
  `src/commands/secret/create.ts`, `src/commands/secret/decrypt.ts`,
  `src/commands/secret/update.ts`, `src/commands/secret/types.ts`,
  a **new** `src/commands/secret/references.ts` (validation + link-pointer builder),
  `test/commands/secret.test.ts` (extended). No changes to `helpers.ts`, `index.ts`, `resolve.ts`
  are required beyond wiring; the HTTP client already supports query strings embedded in a path.

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
- **Client-side validation** (typo-catcher; server is authority):
  - `--link <alias>` must match the token-alias grammar `^[A-Za-z0-9_][A-Za-z0-9._\-/]*$`
    (leading char is an alphanumeric or `_`, never `-`), length ≤ 512. Invalid → `error` + `exit(1)`.
  - `--link-field <path>` (if present) must be a valid safe dot-path: split on `.`, every segment
    non-empty, none of `__proto__` / `constructor` / `prototype`, total length ≤ 256. Invalid →
    `error` + `exit(1)`.
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

**New option:** `--no-resolve`. Commander binds this to `options.resolve` (present → `false`,
absent → `undefined`/truthy default). When `resolve === false`, the command decrypts against
`POST /v1/secrets/${id}/decrypt?resolve=false`, returning the **raw** template/pointer unchanged.
Default behavior (flag omitted) is unchanged — server resolves.

The HTTP client's `post<T>(path, body)` already splits a query string off the path
(`http.ts:573–587`), so appending `?resolve=false` needs no client change.

**Provenance pass-through:**

- `--json` emits the full response, so `resolvedFrom` / `resolved` flow through untouched.
- **Plain output** (metadata block): when present, print
  - `Resolved from: <alias>[#<field>]` if `secret.resolvedFrom` exists (a resolved link);
  - `Resolved refs: N` if `secret.resolved?.count` exists (an interpolated secret).
- **Field-narrowed link `{ value }` envelope:** a field-narrowed link returns `data: { value: … }`
  (per the server contract). The existing generic-data branch already renders this correctly; for
  a cleaner display the plain path **unwraps a lone `{ value }`** object (an object whose only key
  is `value`) and prints the inner value directly. `--json` is untouched (keeps the envelope).

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

> `update` is in scope because the sticky opt-in and the guide's "Turning References Off" example
> live there; leaving it out would make a documented workflow unreachable. (User approved.)

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

The constants (512 alias cap, 256 field cap, forbidden segments) mirror the server spec's
*Constants* + *Parser & dot-path safety* sections so the client-side check never rejects a value
the server would accept, and vice-versa for the obvious typos.

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
- `--link-field requires --link.`
- `Invalid --link alias: must start with a letter, number, or underscore and contain only [A-Za-z0-9._-/] (max 512 chars).`
- `Invalid --link-field path: <reason>.`

Server-side reference errors (`reference_unresolvable`, `reference_field_missing`,
`reference_field_not_string`) surface through the existing `catch` → `output.error(err.message)`
path with no special-casing — the server's message is already opaque/safe by design.

## Testing (extend `test/commands/secret.test.ts`)

Mirrors the existing mocked-client pattern (`toHaveBeenCalledWith`):

1. `create --link secrets/api-key-prod` → POST `/v1/secrets` with
   `{ subType: 'link', data: { ref: 'secrets/api-key-prod' }, type: 'setting', … }`.
2. `create --link a/b --link-field password` → `data: { ref: 'a/b', field: 'password' }`.
3. `create --link a/b --data '{}'` → rejects, `exit(1)`, no POST.
4. `create --link a/b --sub-type json` → rejects, `exit(1)`.
5. `create --link-field password` (no `--link`) → rejects, `exit(1)`.
6. `create --link "-bad"` → rejects (leading `-`), `exit(1)`.
7. `create --link a/b --link-field '__proto__.x'` → rejects, `exit(1)`.
8. `create --enable-references --data '{"u":"${ref:db#password}"}'` → POST body includes
   `enableReferences: true` and the raw token verbatim (no expansion).
9. `decrypt secret-1 --no-resolve` → POST `/v1/secrets/secret-1/decrypt?resolve=false`.
10. `decrypt secret-1` (default) → POST `/v1/secrets/secret-1/decrypt`, no query (regression).
11. `update secret-1 --enable-references --data '{}'` → PUT body includes `enableReferences: true`.
12. `update secret-1 --no-enable-references --data '{}'` → PUT body includes `enableReferences: false`.
13. `update secret-1 --data '{}'` → PUT body **omits** `enableReferences` (sticky).
14. Unit tests for `references.ts`: `validateTokenAlias` (valid/leading-dash/too-long),
    `validateFieldPath` (nested/empty-segment/forbidden-segment/too-long), `buildLinkData`
    (with/without field).

## Success Criteria

- `secret create --link <alias> [--link-field <path>]` produces a correct link secret; conflicting
  flags are rejected client-side with clear messages.
- `secret create --enable-references` and `secret update --enable-references` /
  `--no-enable-references` send the right `enableReferences` value; omitting it on update sends
  nothing (sticky preserved).
- `secret decrypt --no-resolve` returns the raw template/pointer; default resolves.
- `resolvedFrom` / `resolved` / `references` surface in plain output and pass through `--json`.
- Token-alias grammar and field dot-path are validated client-side (leading `-` rejected).
- No `${ref:...}` expander exists in the CLI; no server/SDK/dashboard files touched.
- `npm run typecheck`, `npm run lint`, and `npm run test:unit` pass.
