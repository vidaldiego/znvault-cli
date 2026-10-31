# ZnVault CLI

Official command-line interface for ZnVault secrets management.

For selected-secret copies between independent Vaults, see [linking setup, operation and User-Sealed grants](docs/LINKING.md).

## Installation

```bash
# Install from npm (recommended)
npm install -g @zincapp/znvault-cli

# Verify installation
znvault --version

# Or install from source
cd znvault-cli
npm install
npm run build
npm link
```

## Quick Start

```bash
# Create a profile for your vault server
znvault profile create prod --vault-url https://vault.example.com --use

# Authenticate (auto-refreshes for 7 days)
znvault login -u admin -p 'password'

# Verify authentication
znvault whoami

# Check vault health
znvault health
```

## Authentication

### Login

With ZnVault 1.81.2 or later and an already paired iPhone with device sign-in
enabled, scan a terminal QR using **ZnVault Authenticator → Scan QR**, choose the
account for that Vault and approve with biometrics:

    znvault --profile production login --qr
    znvault --profile vault-sec-tenant login --qr

The QR expires within two minutes; no browser or local callback is used.
An SSH session needs a terminal (ssh -t), and credentials are stored on the
computer running the CLI. Enlarge the terminal if instructed so the whole QR
fits. QR login requires a user profile, interactive output and a configured
HTTPS Vault origin; it cannot be combined with --web, --json or password/TOTP
options. Crypto unseal and User-Sealed approval remain separate operations.
Existing browser login (login --web) and password login remain available.


On a Vault with CLI recovery enabled and a compatible Authenticator build, opt in
during a **new** QR login:

    znvault --profile production login --qr --remember-iphone
    znvault --profile production login --recover

The same iPhone must approve recovery with number matching and biometrics.
The original recovery deadline is **30 days from the QR login**; refreshing or
recovering never moves it. Ordinary refresh still has its seven-day inactivity
policy. Ordinary commands automatically try the remembered iPhone when their
HUMAN session cannot continue. This also works in agents, scripts, pipes and CI:
number matching and progress go to stderr; JSON and raw stdout stay intact.
Recovery never reads stdin or opens a browser. `login --recover` starts the same
flow explicitly and supports JSON; initial QR enrollment still requires a terminal.
API keys, environment credentials, local mode and authentication control commands
do not start automatic recovery. Both tenant accounts and global superadmins use
the same flow. A sent write is never reissued without a proven replay guarantee;
after recovery, explicitly repeat an operation reported as not reissued.

Recovery authenticates the session without restoring a User-Sealed primary key
or granting unseal/additional approval. Use a fresh full login when a primary
unlock is needed, and approve each separate access window as usual.

Logout retires the recovery grant even after the ordinary tokens have expired.
Replacing the login, changing its Vault URL, or deleting the profile first retires
that grant at its original Vault. If that Vault is unreachable, local tokens are
cleared and retirement remains pending; retry logout before replacing/deleting
the profile. Copying a profile never copies its recovery capability.

```bash
znvault login -u admin -p 'password'
znvault login -u admin -p 'password' -t 123456  # With TOTP
```

Sessions are stored locally with a **refresh token** (7 days). The CLI auto-refreshes when needed, so you stay logged in as long as you use it within 7 days.

```bash
znvault logout    # Clear stored session
znvault whoami    # Show current user
```

### Environment Variables (CI/CD)

For automation, use environment variables with an API key:

```bash
export ZNVAULT_URL=https://vault.example.com
export ZNVAULT_API_KEY=znv_abc123...
znvault secret list
```

Create API keys via the web dashboard or `znvault apikey create`.

## Multi-Profile Support

Manage multiple vault servers or environments with profiles:

```bash
# Create profiles for different environments
znvault profile create prod --vault-url https://vault.example.com
znvault profile create dev --vault-url https://localhost:8443 -k  # -k skips TLS verify

# List profiles
znvault profile list

# Switch active profile
znvault profile use prod

# Use specific profile for one command
znvault --profile dev health

# Show current profile
znvault profile current

# Delete/rename profiles
znvault profile delete old-profile
znvault profile rename staging qa
```

### Profile Workflow

```bash
# Setup and login to multiple environments
znvault profile create prod --vault-url https://vault.example.com --use
znvault login -u admin -p 'prod-pass'

znvault profile create dev --vault-url https://localhost:8443 -k --use
znvault login -u admin -p 'dev-pass'

# Switch between them - credentials stored per profile
znvault profile use prod && znvault whoami  # prod user
znvault profile use dev && znvault whoami   # dev user

# Override with environment variable
ZNVAULT_PROFILE=prod znvault health
```

## Command Reference

### Health & Status

```bash
znvault health                              # Quick health check
znvault status                              # Detailed system status
znvault superadmin cluster status           # HA cluster health (superadmin)
znvault superadmin cluster takeover --yes   # Force leadership (HA, superadmin)
```

### Secret Management

```bash
znvault secret list                                  # List metadata (your tenant)
znvault secret get <alias>                           # Get metadata only
znvault secret decrypt <alias>                       # Decrypt after unseal
znvault secret decrypt <alias> --raw                 # Value only (env vars, $(...))
znvault secret decrypt <alias> --field password      # One field of a multi-field secret
znvault secret decrypt <alias> --version 2           # Retained historical version
znvault secret create <alias> --text "secret"        # Create plain text
printf '%s\n' '{"k":"v"}' | \
  znvault secret create <alias> --data-stdin         # JSON without argv/files
znvault secret update <alias> --data '{"k":"new"}' # Merge JSON fields
znvault secret delete <alias>                        # Delete secret
```

### Authenticator / TOTP Secrets

Store an authenticator on its own or attach one to an existing secret. Import a
Base32 seed or `otpauth://totp` URI through the masked prompt or bounded stdin.
Seed-only imports use SHA1, six digits and a thirty-second period. Supported URI
settings are SHA1/SHA256/SHA512, six/eight digits and a 1..300-second period.

```bash
znvault secret totp import app/authenticator          # Masked standalone import
znvault secret totp import app/login --attach         # Masked attachment
znvault secret totp import app/authenticator --seed-stdin
znvault secret totp import app/authenticator \
  --protection user-session --grant-user HUMAN_USER_ID
znvault secret totp code app/login                    # Only the current code
znvault secret totp code app/login --json             # code, validUntil, period
znvault secret totp remove app/login                  # Remove an attachment
znvault secret delete app/authenticator               # Delete a standalone secret
```

For `--seed-stdin`, pipe directly from a trusted source; keep seed material out of
command arguments, shell history and temporary files. `validUntil` is a Unix
timestamp in milliseconds. Code generation uses the normal authorised decrypt
operation and the local clock.

An attachment shares its secret's protection, user grants, permissions and
lifecycle. Choose a standalone secret when it needs separate access controls.
User-Sealed authenticators retain the unlocked HUMAN session and explicit grant
requirements described below. If the Vault requires additional User-Sealed
approval, approve it in the same profile before requesting a code. Crypto unseal
and User-Sealed approval have independent windows; unseal alone does not open both.

```bash
znvault --profile production user-sealed approve --iphone  # Or --otp
znvault --profile production secret totp code app/login
```

A locked primary key first needs a fresh `login --qr` or `login --web` in that
profile. Code-only output stays empty on failure; the CLI reports the required
step on stderr. Linked replicas are read-only, and attachment to
link pointers or public-key secrets is refused. Existing custom fields named `totp` are left intact
and must be resolved explicitly before attachment.

Updates and rotations preserve other raw fields and reference templates. The
CLI keeps canonical TOTP fields out of generic temporary-file editors and patch
diffs. Use `secret totp import --attach` to replace an attached seed. These
read-modify-write operations require server support for conditional writes;
upgrade the server first. A missing conditional endpoint or version conflict
stops the command without retrying an older payload or using a legacy endpoint.

Import, replacement and removal create ordinary encrypted secret versions, so
old seeds remain in retained history and normal encrypted backups/replication.
Removing the vault copy leaves the remote account's MFA configuration in place.

### User-Sealed Secrets

`USER_SESSION_ONLY` values require an eligible unlocked HUMAN session and an
explicit user grant. Unlock with a password, or with a previously linked
PRF-capable passkey through `znvault login --web` on a server supporting linked
passkey unlock. An unlinked passkey or one without PRF support signs in normally
but cannot unlock these values. API keys and service accounts cannot decrypt them.
Use interactive or stdin input so plaintext does not enter argv or shell history.

```bash
znvault login --web
znvault secret create hardware/yubikey/pin \
  --protection user-session --grant-user USER_ID
znvault secret protection app/credential \
  --protection user-session --grant-user USER_ID
znvault secret decrypt app/credential --version 2
znvault secret protection app/credential --protection standard
```

Conversion preserves and re-encrypts retained history by default. Use
`--history delete` only when irreversible history removal is intended and
confirmed. User-Sealed plaintext is not available through bulk export.

### KMS (Key Management Service)

```bash
znvault kms list                                 # List KMS keys
znvault kms create --alias my-key --usage encrypt-decrypt
znvault kms get <keyId>                          # Key details
znvault kms encrypt <keyId> "plaintext"          # Encrypt data
znvault kms decrypt <keyId> "ciphertext"         # Decrypt data
znvault kms generate-data-key <keyId>            # Generate DEK
znvault kms rotate <keyId>                       # Rotate key version
znvault kms versions <keyId>                     # List key versions
znvault kms enable|disable <keyId>               # Enable/disable key
znvault kms delete <keyId>                       # Schedule deletion
```

### API Key Management

```bash
znvault apikey list                              # List API keys
znvault apikey create my-key --permissions secret:read,secret:write
znvault apikey show <id>                         # Key details
znvault apikey rotate <id>                       # Rotate key
znvault apikey enable|disable <id>               # Enable/disable
znvault apikey delete <id>                       # Delete key
znvault apikey self                              # Current key info
znvault apikey self-rotate                       # Rotate current key

# Managed API keys (auto-rotating)
znvault apikey managed list
znvault apikey managed create <name> --rotation-days 30
znvault apikey managed rotate <name>             # Force rotation
```

### Certificate Management

```bash
znvault cert list                                # List certificates
znvault cert get <id>                            # Get certificate
znvault cert create <alias> --cn "example.com"   # Create cert
znvault cert rotate <id>                         # Rotate certificate
znvault cert delete <id>                         # Delete certificate
```

### Tenant Management (superadmin only)

As of v4, tenant management lives entirely under `znvault superadmin`.

```bash
znvault superadmin tenant list                            # List tenants
znvault superadmin tenant create <id> --name "Acme Corp"  # Create tenant
znvault superadmin tenant show <id>                       # Tenant details
znvault superadmin tenant delete <id>                     # Delete tenant
```

### User Management

```bash
znvault user list                                # List users in your tenant
znvault user create <username> --role admin      # Create user (your tenant)
znvault user unlock <username>                   # Unlock locked user
znvault user reset-password <username>           # Reset password
znvault user totp-disable <username>             # Disable 2FA

# Cross-tenant (superadmin only):
znvault superadmin user list --tenant acme       # List users in another tenant
znvault superadmin user create <username> --tenant acme --role admin
```

### RBAC Role Management

```bash
znvault role list                                # List roles
znvault role show <name>                         # Role details
znvault role create <name> --permissions p1,p2   # Create role
znvault role assign <username> <role>            # Assign to user
znvault role revoke <username> <role>            # Revoke from user
```

### ABAC Policy Management

```bash
znvault policy list                              # List policies
znvault policy get <id>                          # Policy details
znvault policy create --name "Read Prod" --file policy.json
znvault policy delete <id>                       # Delete policy
```

### Backup Management (superadmin only)

```bash
znvault superadmin backup list                              # List backups
znvault superadmin backup create                            # Create backup
znvault superadmin backup get <id>                          # Backup details
znvault superadmin backup verify <id>                       # Verify integrity
znvault superadmin backup restore <id>                      # Restore backup
znvault superadmin backup config                            # Show config
znvault superadmin backup health                            # Check health

# Storage configuration
znvault superadmin backup storage show
znvault superadmin backup storage set-s3 --bucket my-bucket --region us-east-1
```

### BSK/LMK Offline Escrow (local Vault node only)

Create a cumulative custody bundle directly on a dedicated mounted device.
The command reads the local BSK plus the PostgreSQL-wrapped LMK generations,
writes no temporary file, and performs a read-back verification before it
returns. Production snapshots require an encrypted backup record whose status
is `VERIFIED`.

```bash
sudo znvault superadmin lmk escrow snapshot \
  --mount /media/sysadmin/ZNVAULT-ESCROW-A \
  --copy-label A \
  --backup-id backup_...

znvault superadmin lmk escrow verify \
  /media/sysadmin/ZNVAULT-ESCROW-A/znvault-lmk-escrow-*.znlmk
```

The snapshot command does not export the BSK through the ZnVault API or print
key material. Use the explicit `--allow-unbound-lab-snapshot` bypass only in an
isolated lab.

### Schema Migrations

Run schema migrations against a database through a short-lived dynamic-secrets lease.
`apply` mints a lease, connects to MySQL, runs pending migrations, and **always** revokes
the lease when done (even on failure); `status` is read-only.

```bash
znvault migration apply <config.json>            # Apply pending migrations per phase
znvault migration status <config.json>           # Read-only: pending/applied/reconcile counts
```

The `<config.json>` argument is a **MigrationConfig** — either a single object or an array of
phase objects (applied in order):

```json
{
  "engine": "mysql",
  "roleId": "dbr_...",
  "migrationsDir": "/abs/or/rel/migrations",
  "database": "optional",
  "scaffoldingFile": "optional"
}
```

- **MySQL only.** An `"engine": "postgres"` config is rejected at validation before any lease
  is minted (PostgreSQL support is deferred).
- **Lease model.** The lease is minted from the dynamic-secrets role named by `roleId`, so the
  active profile must be authenticated with access to that role. The lease is always revoked
  on exit.

### Audit & Security

```bash
znvault audit list                                          # Recent audit logs (your tenant)
znvault audit list --days 7 --action LOGIN                  # Filter logs
znvault superadmin lockdown status                          # Lockdown state (superadmin)
znvault superadmin lockdown set <level>                     # Set level (superadmin)
```

### Emergency Operations

Direct database operations (requires sudo on vault nodes):

```bash
sudo znvault emergency reset-password <user> <newpass>
sudo znvault emergency unlock <user>
sudo znvault emergency disable-totp <user>
```

## Remote Agent Management

Manage agents connected to the vault (for local agent operations, use `zn-vault-agent`):

### List & Monitor Agents

```bash
znvault agent remote list                        # List registered agents
znvault agent remote list --status online        # Filter by status
znvault agent remote connections                 # Active WebSocket connections
```

### Agent Alerts

```bash
znvault agent remote alerts <agent-id> --enable --threshold 600
znvault agent remote alerts <agent-id> --disable
```

### Delete Agent

```bash
znvault agent remote delete <agent-id>           # Remove agent
znvault agent remote delete <agent-id> -y        # Skip confirmation
```

## Registration Tokens

Create one-time tokens for bootstrapping agents with managed API keys:

```bash
# Create registration token
znvault agent token create --managed-key my-agent-key --expires 1h
znvault agent token create --managed-key my-agent-key --description "For staging server"

# List tokens
znvault agent token list --managed-key my-agent-key
znvault agent token list --managed-key my-agent-key --include-used

# Revoke token
znvault agent token revoke <token-id> --managed-key my-agent-key
```

### Bootstrap Workflow

```bash
# 1. Admin creates registration token
znvault agent token create --managed-key staging-agent --expires 1h
# Token: zrt_abc123...

# 2. On new server (cloud-init, Ansible, etc.)
curl -sSL https://vault.example.com/agent/bootstrap.sh | ZNVAULT_TOKEN=zrt_abc123... bash

# 3. Token is invalidated after use
```

## Local Agent Operations

For local agent configuration, certificate sync, and secret injection, use the standalone `zn-vault-agent`:

```bash
# Install standalone agent
npm install -g @zincapp/zn-vault-agent

# Agent commands
zn-vault-agent login         # Authenticate with vault
zn-vault-agent setup         # Interactive setup
zn-vault-agent sync          # Sync secrets/certificates
zn-vault-agent start         # Start agent daemon
zn-vault-agent status        # Show agent status
zn-vault-agent exec          # Execute with secrets injected

# More info
zn-vault-agent --help
znvault agent help-local     # Quick reference
```

## Interactive TUI Dashboard

Real-time terminal dashboard for monitoring:

```bash
znvault tui                           # Launch dashboard
znvault dashboard                     # Alias for tui
znvault tui --refresh 10000           # Custom refresh (ms)
znvault tui --screen secrets          # Start on specific screen
```

### Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `1-4` | Switch screens |
| `r` | Refresh data |
| `?` | Show help |
| `q` | Quit |

## Auto-Update

The CLI checks for updates automatically (once per 24 hours):

```bash
znvault version                       # Show version + update check
znvault self-update --check           # Check for updates
znvault self-update                   # Update to latest
znvault self-update --yes             # Skip confirmation
```

## Output Modes

| Mode | Description | When |
|------|-------------|------|
| **TUI** | Rich colored output | Interactive terminals |
| **Plain** | Simple text for parsing | CI/CD, piped commands |

Plain mode is automatic in CI or when output is piped. Override manually:

```bash
znvault --plain health
ZNVAULT_PLAIN_OUTPUT=true znvault health
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `ZNVAULT_URL` | Vault server URL |
| `ZNVAULT_API_KEY` | API key for authentication |
| `ZNVAULT_USERNAME` | Username for auto-login |
| `ZNVAULT_PASSWORD` | Password for auto-login |
| `ZNVAULT_INSECURE` | Skip TLS verification (`true`/`false`) |
| `ZNVAULT_PROFILE` | Override active profile |
| `ZNVAULT_PLAIN_OUTPUT` | Force plain text output |
| `ZNVAULT_NO_UPDATE_CHECK` | Disable auto-update checks |

## Configuration Files

Configuration is stored per-profile in the system config directory:

- **macOS**: `~/Library/Preferences/znvault-nodejs/config.json`
- **Linux**: `~/.config/znvault-nodejs/config.json`
- **Windows**: `%APPDATA%\znvault-nodejs\Config\config.json`

```bash
znvault config show                   # Show current config
znvault config set url <url>          # Set vault URL
znvault config set insecure true      # Skip TLS verification
```

## Documentation

- [CLI Admin Guide](../docs/CLI_ADMIN_GUIDE.md) - Full CLI reference
- [Managed API Keys Guide](../docs/MANAGED_API_KEYS_GUIDE.md) - Auto-rotating keys
- [KMS User Guide](../docs/KMS_USER_GUIDE.md) - Key management
- [Agent Guide](../docs/AGENT_GUIDE.md) - Standalone agent documentation

## Development

```bash
npm install          # Install dependencies
npm run build        # Build TypeScript
npm run dev          # Watch mode
npm run lint         # Lint code
npm test             # Run tests
```

## License

Proprietary - ZincApp SL
