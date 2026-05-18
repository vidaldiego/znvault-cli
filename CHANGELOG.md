# Changelog

All notable changes to the ZnVault CLI will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
