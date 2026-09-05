# Changelog

All notable changes to the ZnVault CLI will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [5.1.0] - 2026-09-05

### Added

- `znvault secret protection <id-or-alias> --protection user-session|standard`
  performs the dedicated cryptographic conversion without putting secret
  plaintext in arguments, files, output, or receipts.
- `--history preserve|delete` preserves and re-encrypts retained versions by
  default or deletes them only after explicit confirmation. Converting to
  Standard also requires confirmation because normal policy may then permit
  API-key and service-account reads.
- `--grant-user`, `--root-recovery`, `--yes`, JSON output, completions, and
  command tests cover the full conversion contract.

## [5.0.0] - 2026-09-05

### Breaking changes

- Local PostgreSQL mode requires explicit `--local` or `ZNVAULT_LOCAL=1`;
  exporting DATABASE_URL alone no longer changes ordinary commands from API
  mode to direct DB access. Emergency operations retain their explicit DB path.
- Remove `superadmin lmk ceremony` and `superadmin lmk escrow snapshot`.
  Creation/custody ceremonies belong to zn-trust-root. Legacy escrow `verify`
  and `restore` remain available for existing artifacts.
- `superadmin lmk preflight` uses the authenticated server snapshot API rather
  than opening PostgreSQL. It requires a compatible server and superadmin
  credentials; the server records an audit event outside the read-only snapshot.

### Preserved compatibility

- User-Sealed create/update, grants, revocation and root-recovery workflows from
  4.25.0 remain; no change to secret payloads or server migrations.
- Emergency DR permit lookup, recovery fences and existing escrow restore
  readers remain; this release does not activate or commission DR/Trust.

### Release engineering

- Align VERSION with package and lockfile metadata; clean dist before packing
  to prevent removed ceremony modules leaking into npm artifacts.
- Gate publication on the complete CI suite and matching tag/main SHA; install
  and smoke-test the exact tarball before publishing it with provenance.
- Keep machine-specific Claude permissions out of Git and document independent
  repository paths under ~/Drive/vault.

## [4.24.6] - 2026-09-02

### Added

- `whoami --server --json` verifies the active profile's current identity
  against `/auth/me` and emits a bounded identity receipt for recovery-fence
  supervisors, including the effective server origin and TLS pin, instead of
  trusting cached local profile metadata.
- `--tls-spki-sha256` pins the reviewed server public key while retaining
  normal certificate-chain and hostname verification; it cannot be combined
  with insecure transport.

## [4.24.4] - 2026-08-29

### Added

- `dynasec permit lookup` performs a strict read-only lookup by
  `Idempotency-Key`, allowing an interrupted recovery supervisor to distinguish
  a lost issue response from a permit that was never issued without creating
  new authority.

### Fixed

- Recovery fence and permit wire types now include the pinned connection target
  identity plus authoritative `openedAt`/`createdAt` timestamps used to verify
  exact server-side expiry windows.

## [4.24.1] - 2026-08-28

### Fixed

- Dynamic-secret role and connection deletion now surfaces retained-lease
  conflicts without suggesting that `--force` bypasses the server's 90-day
  ownership and audit retention boundary.
- Lease output recognises the fail-closed `UNKNOWN` ownership state and warns
  operators instead of presenting it as an ordinary revocable credential.

## [4.23.0] - 2026-08-24

Escrow ceremony work: the receipt stops publishing a raw digest of the root
key, the ceremony no longer has to run on a machine that holds the cleartext
key, and the isolated-restore drill gains gates that a healthy-looking failure
cannot pass.

### Security

- **The escrow receipt publishes `kcv1:`, never the raw SHA-256 of the
  bootstrap key.** The receipt is the one artefact of the procedure that leaves
  the datacentre — an auditor, a drill log, a ticket — and a full untruncated
  digest of the root key written into it is a verification oracle: any future
  partial exposure of the key becomes confirmable against an archived document,
  by anyone holding it, for as long as it exists. The truncated KCV answers the
  only question a receipt needs to answer and matches what every node publishes
  on `/v1/health`. The on-disk bundle format is unchanged.

  **Breaking for scripts** that parse the `BSK fingerprint` field of
  `lmk escrow snapshot|verify|restore` output, including `--json`. The value
  changes from 64 hex characters to `kcv1:` plus 32.

### Added

- `lmk escrow snapshot --from-provider sentinel` — source the bootstrap key
  from the Archon Sentinel appliance over mTLS instead of a cleartext file.
  Two consequences: the ceremony can run on a dedicated host that stores
  nothing, and escrow stays possible after `lmk.bin` is retired from the fleet,
  which until now would have permanently ended the ability to take another
  snapshot. The key returned by the appliance is checked against the KCV
  PostgreSQL recorded at wrap time before anything is built around it.
- `lmk restore-drill pre|post` — gates for an isolated restore drill. A vault
  started against an empty database does not fail: it mints a new LMK and
  reports a healthy start with a root-key fingerprint that matches the escrow
  bundle. These read state and compare it against the bundle, never an exit
  code or an HTTP status.
- `lmk preflight` — read-only inventory of the key hierarchy with pass/fail
  gates, in a `REPEATABLE READ READ ONLY` transaction. Writes nothing, and goes
  to PostgreSQL directly because the superadmin root-key endpoints each write an
  audit row.
- `computeBskKcv` / `isBskKcv`, pinned to frozen golden vectors shared with the
  vault server so the two implementations cannot drift silently apart.


## [4.22.1] - 2026-08-24

### Security

- Dependency refresh clearing all 15 npm audit findings (2 critical, 11 high,
  2 moderate) with no major-version jumps. Runtime: `ws` 8.21.3 (high, direct),
  `yaml` 2.9.0 (stack overflow via nested collections), `pg` 8.23.0. Dev chain:
  `vitest`/`@vitest/coverage-v8` 4.1.11 (critical advisories via vite/rollup),
  `typescript-eslint` 8.67, plus transitive fixes (brace-expansion, fast-uri,
  js-yaml, minimatch, nanoid, picomatch, postcss). `npm audit`: 0 findings.

### Changed

- Updated typescript-eslint flagged 8 now-redundant type assertions (the typed
  client facade made them unnecessary); removed them and the type imports and
  local response interfaces they alone justified.

## [4.22.0] - 2026-08-23

### Added

- `secret decrypt --raw` prints **only the value** — no metadata, nothing else on
  stdout — so it can be injected directly: `export API_KEY=$(znvault secret
  decrypt web/api-key --raw)`. `--field <name>` selects one field of a
  multi-field secret (credential `password`, a key-value entry, a keypair's
  `privateKey`) and implies `--raw`. Strings are printed verbatim, file-based
  secrets / file-shaped fields as decoded bytes (`--raw > key.pem`), anything
  else as compact JSON; a trailing newline is added only when stdout is a TTY.
  `--raw -o <file>` writes the exact value to the file. Multi-field secrets
  without `--field`, unknown fields, and `--raw --json` fail closed with exit 1.

### Fixed

- The per-command profile banner (`[znvault vX] [profile: … -> …]`) is no longer
  printed on stdout when a command runs with `--json` (or the new `--raw`/
  `--field`). Previously `znvault … --json | jq` failed unless `-q` was added,
  because the banner preceded the JSON document. The skip rule lives in
  `src/lib/banner-policy.ts` (unit-tested) alongside the existing completion and
  `ssh forward --print-port` cases.

## [4.20.0] - 2026-08-20

### Added

- `secret create --data-stdin` accepts a bounded JSON object from piped stdin,
  keeping credential values out of argv and regular staging files. It rejects
  terminal input, payloads above 1 MiB, non-object JSON and combinations with
  any other data-bearing create option.

## [4.16.0] - 2026-07-10

### Changed — ZincApp identity banner

- The `znvault` startup banner gradient now uses the ZincApp brand palette
  (lima `#B8E830` → green `#1F9E63`), replacing the legacy blue→purple gradient.
  Success/warning/danger gradients are unchanged (semantic colors).

## [4.15.4] - 2026-07-07

### Added — reference-metadata display + `secret can-decrypt` preflight

- `secret get` now shows a **References** row (`link secret` / `enabled · has tokens` /
  `enabled · no tokens yet`) derived from the server's new `/meta` fields, plus reference tips.
  The previously-empty `Created At` / `Updated At` now populate (the server `/meta` endpoint now
  emits camelCase timestamps + `subType` / `hasReferences` / `referencesEnabled`).
- `secret can-decrypt <alias> [--as-api-key <id> | --as-user <id>] [--json]` — a preflight that
  reports whether an identity could decrypt a secret across its full reference graph, with verdicts
  `allowed` / `denied` / `conditional` / `indeterminate`. Self-check needs `secret:read:metadata`;
  simulating another identity requires the strict, admin-granted `secret:simulate-access`.
  `--as-api-key` and `--as-user` are mutually exclusive.

> Requires the matching server release (the `/meta` reference fields and
> `POST /v1/secrets/:id/can-decrypt`). Against an un-upgraded server, `can-decrypt` returns a
> clean "endpoint not available" error and `get` shows no References row.

## [4.15.3] - 2026-07-06

### Added — Secret References authoring (`--link`, `--enable-references`, `--no-resolve`)

- `secret create --link <alias> [--link-field <path>]` — construct a link secret
  (`subType: 'link'`, `data: { ref, field? }`); rejects conflicting data-bearing flags.
- `secret create --enable-references` and `secret update --enable-references` /
  `--no-enable-references` — opt a secret in/out of `${ref:...}` resolution (sticky opt-in).
- `secret decrypt --no-resolve` — return the raw, unresolved template/pointer (`?resolve=false`),
  plus `resolvedFrom` / `resolved` provenance in the output.

### Fixed

- `secret update` / `rotate` / `patch` interactive pre-fetch now uses `?resolve=false`, so editing
  a reference secret never bakes a resolved snapshot over its template.

## [4.15.2] - 2026-07-04

### Fixed

- Green CI: resolved lint errors and a flaky cross-process refresh-lock test.

## [4.15.1] - 2026-07-04

### Documentation

- Documented the `znvault migration apply/status` command in the README and CLAUDE.md.

## [4.15.0] - 2026-07-04

### Added — `znvault migration apply/status` command

- `znvault migration apply <config.json>` — apply pending schema migrations for each phase in a
  JSON config, via `@zincapp/znvault-migrate`. Mints a dynamic-secrets lease per phase, connects
  to MySQL, runs migrations, and **always** revokes the lease (even on failure).
- `znvault migration status <config.json>` — read-only; prints pending/applied/reconcile counts
  per phase (mints its own short-lived lease, runs `MigrationRunner.status()`, always revokes).
- The `<config.json>` MigrationConfig may be a single object or an array of phase objects. MySQL
  only — an `"engine": "postgres"` config is rejected at validation (PostgreSQL is deferred).

## [4.14.0] - 2026-07-03

### Removed — `dynasec routines apply/get/bundles` command (server Phase 2)

- Removed the `znvault dynasec routines {apply,get,bundles}` command. The migration bundle-apply
  route was retired server-side (Phase 2 scaffolding cutover); the routine bundle is now applied
  by the S1 connection provisioner, not via a standalone command. Dangling help strings reworded.

## [4.13.1] - 2026-07-02

### Fixed — `self-update` now applies plugin major upgrades

- `znvault self-update` ran `npm update` in the plugins directory, which is bounded by the
  semver range recorded there (a caret `^1.x`) and therefore **could not cross a major version**
  (e.g. `@zincapp/znvault-plugin-payara` 1.28.3 → 2.0.0). npm exited 0 having changed nothing,
  and the command reported a **false** `✔ Plugins updated successfully!` while the old version
  was still installed. It now runs `npm install <pkg>@latest` (matching `znvault plugin update`),
  so major plugin releases are actually applied.
- `self-update` now **verifies the installed version on disk** after updating: a plugin left
  behind is surfaced as `! <name>: still <v> (expected <t>) — run 'znvault plugin update <name>'`
  and the spinner warns instead of falsely claiming success.

## [4.13.0] - 2026-07-02

### Added — dynamic-secrets role templates (server S2)

- `znvault dynasec role create <connection-id> --name <name> --template <name> [--template-version <n>]`
  — create a dynamic-secrets role from a vetted, server-side template instead of hand-written SQL.
  MySQL: `readonly`/`readwrite`/`ddl`/`migrate`; PostgreSQL: `readonly`/`readwrite`.
- `znvault dynasec templates list [--engine mysql|postgresql]` and
  `znvault dynasec templates get <engine>/<name>/<version>` — browse the fixed template catalog.
- Raw `--creation-statements`/`--revocation-statements` remain as an escape hatch; the server now
  requires the `dynamic-secrets:roles:write-raw` permission for raw mode (actionable CLI error).

## [4.12.0] - 2026-07-01

### Added — one-shot connection provisioning (server S1)

- `znvault dynasec connection provision <name> --type mysql|postgresql --root-file <path>` — provision
  a connection end-to-end from a transient root credential (least-priv sub-accounts + connection +
  optional MySQL routine bundle). Root via `--root-file` or masked prompt, never an inline flag.
- `znvault dynasec connection rotate-admin <connection-id>` — deliberate admin-password rotation.
- HttpClient now surfaces the server's error-body `steps` array on 4xx/5xx provision failures.

> Releases 4.1.0–4.11.0 (2026-05 to 2026-07) are not individually itemized here; see git history.

## [4.0.0] - 2026-05-18

### Breaking changes — tenant isolation hardening

All cross-tenant and system-level operations now live under a single
`znvault superadmin <…>` namespace. The top-level `--tenant` flag is gone
from every tenant-facing command — superadmins must scope cross-tenant
operations explicitly through the new namespace.

#### Moved entirely under `superadmin` (no longer at top level)

| Old | New |
|-----|-----|
| `znvault tenant <…>` | `znvault superadmin tenant <…>` |
| `znvault cluster <…>` | `znvault superadmin cluster <…>` |
| `znvault lockdown <…>` | `znvault superadmin lockdown <…>` |
| `znvault lmk <…>` | `znvault superadmin lmk <…>` |
| `znvault backup <…>` | `znvault superadmin backup <…>` |

#### Superadmin account management renamed

| Old | New |
|-----|-----|
| `znvault superadmin list` | `znvault superadmin accounts list` |
| `znvault superadmin create` | `znvault superadmin accounts create` |
| `znvault superadmin reset-password` | `znvault superadmin accounts reset-password` |
| `znvault superadmin unlock` | `znvault superadmin accounts unlock` |
| `znvault superadmin disable` | `znvault superadmin accounts disable` |
| `znvault superadmin enable` | `znvault superadmin accounts enable` |

#### Dual-purpose groups: `--tenant` removed at top level

For these groups, the top-level command keeps working for the caller's own
tenant (no `--tenant` accepted). The same group is also registered under
`znvault superadmin <group>` where `--tenant` is accepted for cross-tenant
or system-scoped operations:

- `advisor` (audit, suggest — `rules` stays tenant-only; `llm` moved to
  `superadmin advisor llm` entirely)
- `agent` (only `token-*`, `remote-*`, and `direct-update-all` are
  mirrored under superadmin; other agent subcommands remain tenant-only)
- `apikey` (all except `self` / `self-rotate` — those stay tenant-only)
- `audit`, `group`, `host`, `kms`, `policy`, `quarantine`, `role`, `sso`,
  `ssh`, `user`

`quarantine config` semantics:
  - `znvault quarantine config` — caller's own tenant config (no flag).
  - `znvault superadmin quarantine config` — system (null-tenant) config.
  - `znvault superadmin quarantine config --tenant X` — tenant X's config.

#### Context-aware help

The `superadmin` group is hidden from `znvault --help` for non-superadmin
profiles (mirrors the existing per-command `superadminDesc` marker).

### Internal

- New `src/lib/command-context.ts` module exposes
  `withRegisterContext` / `applyTenantContextPatch` which gate the
  `--tenant` option globally on Commander's prototype based on the active
  registration context. Sub-files in modularized command groups
  (`kms/`, `host/`, `sso/`, `ssh/`, `agent/`, `apikey/`) keep their
  existing `.option('--tenant <id>', …)` calls untouched — the patch makes
  those calls no-ops when the active context is `tenant`.
- All `registerXxxCommands` for dual-purpose groups now accept an optional
  `{ context: 'tenant' | 'superadmin' }` second argument.

## [2.2.0] - 2026-01-04

### Added

- **Interactive TUI Dashboard** - New `znvault tui` command with real-time monitoring
  - Live health status display
  - Security overview with threat level indicator
  - Keyboard navigation (1-4 for screens, r to refresh, q to quit)
  - Configurable refresh interval (`--refresh <ms>`)
  - Multiple screens: Dashboard, Secrets, Audit, Cluster

- **Auto-Update System** - Automatic update notifications
  - Background update check on CLI startup (24-hour cache)
  - `znvault self-update` command for one-command updates
  - `znvault version` shows current version with update check
  - Disable with `ZNVAULT_NO_UPDATE_CHECK=true`

- **Plain Text Output Mode** - CI/automation friendly output
  - Automatic detection of non-interactive environments
  - `--plain` global flag for manual override
  - `ZNVAULT_PLAIN_OUTPUT=true` environment variable
  - All commands support both TUI and plain modes

- **Enhanced Visual Output** - Improved terminal UI
  - ASCII art banner on startup
  - Bordered status boxes for health and cluster info
  - Color-coded status indicators
  - Gradient text effects for branding

- **New TUI Components**
  - `Table` - Rich bordered tables with auto-sizing columns
  - `List` - Key-value pair displays
  - `Card` - Bordered information cards
  - `StatusIndicator` - Status dots with labels
  - `ProgressBar` - Visual progress display

### Changed

- All output functions are now mode-aware (TUI vs plain)
- Health command uses visual status boxes
- Cluster status uses enhanced node display

### Dependencies

- Added `ink` and `react` for TUI rendering
- Added `boxen`, `figlet`, `gradient-string` for visual enhancements

## [2.1.0] - 2025-12-XX

### Added

- Multi-profile support for managing multiple vault connections
- Certificate agent with WebSocket-based real-time updates
- Permissions management commands
- Role management commands
- Notification configuration commands

### Changed

- Improved error handling and messages
- Enhanced table formatting

## [2.0.0] - 2025-XX-XX

### Added

- Initial release of the redesigned CLI
- Commander-based command structure
- Support for API mode and local mode
- JWT and API key authentication
- Full tenant, user, secret, and KMS management
- Audit log viewing
- Emergency operations for on-node recovery
