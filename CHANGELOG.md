# Changelog

All notable changes to the ZN-Vault CLI will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
