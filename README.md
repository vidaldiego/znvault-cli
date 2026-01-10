# ZnVault CLI

Official command-line interface for ZnVault secrets management.

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
znvault health                    # Quick health check
znvault status                    # Detailed system status
znvault cluster status            # HA cluster health
znvault cluster takeover --yes    # Force leadership (HA)
```

### Secret Management

```bash
znvault secret list                              # List all secrets
znvault secret list --tenant acme                # Filter by tenant
znvault secret get <alias>                       # Get secret value
znvault secret create <alias> --value "secret"   # Create secret
znvault secret create <alias> --json '{"k":"v"}' # Create JSON secret
znvault secret update <alias> --value "new"      # Update secret
znvault secret delete <alias>                    # Delete secret
```

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

### Tenant Management

```bash
znvault tenant list                              # List tenants
znvault tenant create <id> --name "Acme Corp"    # Create tenant
znvault tenant show <id>                         # Tenant details
znvault tenant delete <id>                       # Delete tenant
```

### User Management

```bash
znvault user list                                # List users
znvault user list --tenant acme                  # Filter by tenant
znvault user create <username> --role admin      # Create user
znvault user unlock <username>                   # Unlock locked user
znvault user reset-password <username>           # Reset password
znvault user totp-disable <username>             # Disable 2FA
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

### Backup Management

```bash
znvault backup list                              # List backups
znvault backup create                            # Create backup
znvault backup get <id>                          # Backup details
znvault backup verify <id>                       # Verify integrity
znvault backup restore <id>                      # Restore backup
znvault backup config                            # Show config
znvault backup health                            # Check health

# Storage configuration
znvault backup storage show
znvault backup storage set-s3 --bucket my-bucket --region us-east-1
```

### Audit & Security

```bash
znvault audit list                               # Recent audit logs
znvault audit list --days 7 --action LOGIN       # Filter logs
znvault lockdown status                          # Lockdown state
znvault lockdown set <level>                     # Set level (admin)
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
