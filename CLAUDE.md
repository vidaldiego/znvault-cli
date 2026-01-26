# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

ZnVault CLI (`@zincapp/znvault-cli`) is the official command-line interface for ZnVault secrets management. It's a TypeScript/Node.js CLI built with Commander.js that supports multi-profile authentication, interactive TUI dashboards via React/Ink, and both JWT and API key authentication.

## Development Commands

```bash
# Install & Build
npm install
npm run build              # Build TypeScript to dist/
npm run build:prod         # Production build (no sourcemaps)
npm run dev                # Watch mode for development

# Testing
npm test                   # Full test suite (starts Docker PostgreSQL)
npm run test:unit          # Unit tests only (fast, no Docker)
npm run test:unit:watch    # Watch mode for unit tests
npm run test:integration   # Integration tests (requires running vault)
npm run test:coverage      # Coverage report

# Run specific test file
npm run test:unit -- test/commands/secret.test.ts

# Code Quality
npm run lint               # ESLint check
npm run lint:fix           # Auto-fix ESLint issues
npm run typecheck          # TypeScript type checking only

# Local Development
npm link                   # Install CLI globally from source
node dist/index.js <cmd>   # Run built CLI directly
```

## Architecture

### Directory Structure

```
src/
├── index.ts              # CLI entry point, registers all commands
├── commands/             # Command implementations (one file per command group)
│   ├── auth.ts           # Login, logout, profile management
│   ├── secret.ts         # Secret CRUD operations
│   ├── apikey.ts         # API key management
│   ├── kms.ts            # Key management service
│   ├── ssh.ts            # SSH CA management and quick connect
│   ├── backup/           # Modularized backup commands
│   │   ├── index.ts      # Command registration
│   │   ├── types.ts      # Type definitions
│   │   └── helpers.ts    # Shared utilities
│   └── ...               # Other command groups
├── lib/                  # Core libraries
│   ├── client.ts         # HTTP client with auth handling (~1000 lines)
│   ├── config.ts         # Profile/credential storage via Conf
│   ├── output.ts         # Mode-aware output (TUI/plain/JSON)
│   ├── output-mode.ts    # Output mode detection (TTY, CI, piped)
│   ├── visual.ts         # Banners, boxes, formatting
│   └── prompts.ts        # Interactive prompts via Inquirer
├── tui/                  # Terminal UI (React/Ink)
│   ├── App.tsx           # Main dashboard app
│   ├── components/       # Reusable TUI components
│   └── screens/          # Dashboard screens
├── services/             # Background services
│   ├── update-checker.ts # Version checking
│   └── update-installer.ts # Auto-update with GPG verification
├── plugins/              # Plugin system for extensibility
│   ├── loader.ts         # Plugin discovery and loading
│   └── types.ts          # Plugin interface definitions
└── types/                # TypeScript type definitions
    └── index.ts          # All API response/request types
```

### Command Registration Pattern

Commands are registered in `src/index.ts` via `registerXxxCommands(program)` functions. Each command file exports a single registration function:

```typescript
// src/commands/example.ts
export function registerExampleCommands(program: Command): void {
  program
    .command('example')
    .description('Example command')
    .option('--json', 'Output as JSON')
    .action(async (options) => {
      // Implementation
    });
}
```

### HTTP Client (`lib/client.ts`)

Singleton `VaultClient` handles all API communication:
- Automatic JWT refresh before expiry
- API key header injection when configured
- Configurable via `--url`, `--insecure` flags or environment variables
- Methods return typed responses (see `types/index.ts`)

### Output System

Three output modes handled by `lib/output.ts`:
- **TUI**: Rich colored output with spinners (interactive terminals)
- **Plain**: Simple text for CI/automation (auto-detected)
- **JSON**: Raw JSON via `--json` flag

Output mode is auto-detected based on TTY/CI environment, overridable via `--plain` flag or `ZNVAULT_PLAIN_OUTPUT=true`.

### Profile System (`lib/config.ts`)

Multi-profile configuration stored via `Conf` package:
- Profiles contain: URL, credentials, API key, timeout settings
- Switch profiles: `--profile <name>` or `ZNVAULT_PROFILE` env var
- Credentials stored per-profile with automatic JWT refresh

## Testing

### Unit Tests (`test/commands/`, `test/lib/`)

Mock external dependencies, test command logic:

```typescript
import { describe, it, expect, vi } from 'vitest';
import * as clientModule from '../../src/lib/client.js';

vi.mock('../../src/lib/client.js', () => ({
  client: { getHealth: vi.fn() }
}));
```

### Integration Tests (`test/integration/`)

Require running vault server. Use `ZNVAULT_INTEGRATION=true` environment variable. Tests run sequentially to avoid auth conflicts.

## TypeScript Configuration

- **Target**: ES2022 with NodeNext modules
- **Strict Mode**: Enabled with all safety checks
- **ESLint**: Strict type checking, `any` forbidden, explicit return types required

Key ESLint rules:
- `no-explicit-any`: error
- `no-unsafe-*`: error (assignment, call, return, member-access)
- `no-floating-promises`: error
- `strict-boolean-expressions`: warn

## Environment Variables

| Variable | Description |
|----------|-------------|
| `ZNVAULT_URL` | Vault server URL |
| `ZNVAULT_API_KEY` | API key for authentication |
| `ZNVAULT_PROFILE` | Override active profile |
| `ZNVAULT_PLAIN_OUTPUT` | Force plain text output |
| `ZNVAULT_INSECURE` | Skip TLS verification |
| `ZNVAULT_NO_UPDATE_CHECK` | Disable auto-update checks |

## Key Dependencies

| Package | Purpose |
|---------|---------|
| `commander` | CLI argument parsing |
| `conf` | Persistent config storage |
| `inquirer` | Interactive prompts |
| `ora` | Spinners for async operations |
| `chalk` | Colored terminal output |
| `ink`, `react` | Terminal UI components |
| `pg` | PostgreSQL (emergency operations) |

## Adding a New Command

1. Create `src/commands/newcmd.ts`:
```typescript
import type { Command } from 'commander';
import { client } from '../lib/client.js';
import { success, error, json, table } from '../lib/output.js';

interface Options {
  json?: boolean;
  tenant?: string;
}

export function registerNewcmdCommands(program: Command): void {
  const cmd = program.command('newcmd').description('New command group');

  cmd
    .command('list')
    .description('List items')
    .option('--json', 'Output as JSON')
    .option('--tenant <tenant>', 'Filter by tenant')
    .action(async (options: Options) => {
      try {
        const result = await client.listItems(options.tenant);
        if (options.json) {
          json(result);
        } else {
          table(['ID', 'Name'], result.map(i => [i.id, i.name]));
        }
      } catch (err) {
        error(err instanceof Error ? err.message : 'Unknown error');
        process.exit(1);
      }
    });
}
```

2. Register in `src/index.ts`:
```typescript
import { registerNewcmdCommands } from './commands/newcmd.js';
// ...
registerNewcmdCommands(program);
```

3. Add client methods in `src/lib/client.ts` if needed

4. Add types in `src/types/index.ts`

## Modularized Command Pattern

For complex command groups (>500 lines), split into directories:

```
src/commands/backup/
├── index.ts      # FastifyPluginAsync combining routes, exports registerBackupCommands
├── types.ts      # Interfaces and constants
├── helpers.ts    # Validation and utility functions
├── config.ts     # Config subcommands
└── operations.ts # Main operations (list, create, restore)
```

## Release Process

**Publishing is handled automatically by GitHub Actions CI/CD.**

### Steps to Release

1. Update version in `package.json`:
   ```bash
   npm version patch  # or minor/major
   ```

2. Commit the version bump:
   ```bash
   git add package.json package-lock.json
   git commit -m "chore(release): vX.Y.Z"
   ```

3. Create and push tag:
   ```bash
   git tag vX.Y.Z
   git push origin main
   git push origin vX.Y.Z
   ```

4. GitHub Actions automatically:
   - Runs tests
   - Builds the package
   - Publishes to npm using OIDC authentication (no npm token needed)

### npm Package

- **Package:** `@zincapp/znvault-cli`
- **Registry:** https://www.npmjs.com/package/@zincapp/znvault-cli

### Verification

```bash
# Check published version
npm view @zincapp/znvault-cli version

# Install latest
npm install -g @zincapp/znvault-cli
```

### CI/CD Configuration

The GitHub Actions workflow (`.github/workflows/publish.yml`) handles:
- Running tests on PRs
- Publishing to npm on version tags (`v*`)
- OIDC-based npm authentication (provenance enabled)
