# Changelog

All notable changes to the ZnVault CLI will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
