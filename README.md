# ZN-Vault CLI

Official command-line interface for ZN-Vault secrets management.

## Installation

```bash
# From source
cd znvault-cli
npm install
npm run build
npm link

# Verify
znvault --version
```

## Quick Start

```bash
# Create a profile for your vault server
znvault profile create prod --vault-url https://vault.example.com -k --use

# Authenticate
znvault login -u admin -p 'password'
znvault whoami

# Check health
znvault health
```

## Multi-Profile Support

The CLI supports multiple configuration profiles, allowing you to manage different vault servers or user accounts easily.

### Profile Commands

```bash
# Create profiles for different environments
znvault profile create prod --vault-url https://vault.example.com -k
znvault profile create local --vault-url https://localhost:8443 -k

# List all profiles
znvault profile list

# Switch active profile
znvault profile use prod

# Show current profile
znvault profile current

# Show profile details
znvault profile show prod

# Use a specific profile for a single command (without switching)
znvault --profile local health

# Delete a profile
znvault profile delete old-profile

# Rename a profile
znvault profile rename staging qa
```

### Profile Workflow Example

```bash
# Setup profiles for different environments
znvault profile create prod --vault-url https://vault.example.com -k
znvault profile create dev --vault-url https://localhost:8443 -k

# Login to production
znvault profile use prod
znvault login -u admin -p 'prod-password'

# Login to dev (separate session)
znvault profile use dev
znvault login -u admin -p 'dev-password'

# Now you can switch between them - credentials are stored per profile
znvault profile use prod
znvault whoami  # Shows prod user

znvault profile use dev
znvault whoami  # Shows dev user

# Or use --profile flag for one-off commands
znvault --profile prod tenant list
znvault --profile dev tenant list
```

### Environment Variable Override

You can also override the profile via environment variable:

```bash
ZNVAULT_PROFILE=prod znvault health
```

## Operating Modes

The CLI operates in two modes:

| Mode | When | Authentication | Use Case |
|------|------|----------------|----------|
| **API Mode** | Default | JWT login or API key | Remote administration |
| **Local Mode** | On vault nodes with sudo | None (direct DB) | On-node operations |

### API Mode (Remote)

```bash
znvault login -u admin -p 'Admin123456#'
znvault health
znvault tenant list
```

### Local Mode (On Vault Nodes)

```bash
# No login required
sudo znvault health
sudo znvault tenant list
sudo znvault user unlock admin
```

## Command Reference

### Configuration

```bash
znvault config set url <url>        # Set vault URL
znvault config set insecure <bool>  # Skip TLS verification
znvault config set apiKey <key>     # Set API key
znvault config show                 # Show current config
```

### Authentication

```bash
znvault login -u <user> -p <pass>   # Login with credentials
znvault whoami                       # Show current user
```

### Health & Status

```bash
znvault health                       # Check vault health
znvault status                       # Detailed status
znvault cluster status               # Cluster health (HA mode)
```

### Tenant Management

```bash
znvault tenant list                  # List tenants
znvault tenant create <id>           # Create tenant
znvault tenant delete <id>           # Delete tenant
```

### User Management

```bash
znvault user list [--tenant <id>]    # List users
znvault user unlock <username>       # Unlock user
znvault user reset-password <user>   # Reset password
znvault user totp-disable <user>     # Disable TOTP
```

### Secret Management

```bash
znvault secret list [--tenant <id>]           # List secrets
znvault secret get <alias>                     # Get secret
znvault secret create <alias> --data <json>    # Create secret
znvault secret delete <alias>                  # Delete secret
```

### Certificate Management

```bash
znvault certificate list                       # List certificates
znvault certificate get <id>                   # Get certificate
znvault certificate create <alias>             # Create certificate
znvault certificate rotate <id>                # Rotate certificate
znvault certificate delete <id>                # Delete certificate
```

### Audit & Security

```bash
znvault audit list [--days 7]        # View audit logs
znvault lockdown status              # Check lockdown state
```

### Emergency Operations

```bash
sudo znvault emergency reset-password <user> <pass>
sudo znvault emergency unlock <user>
sudo znvault emergency disable-totp <user>
```

## Certificate Agent

The `znvault agent` command provides automated certificate synchronization with real-time updates via WebSocket.

### Quick Start

```bash
# Initialize agent config
znvault agent init -o /etc/ssl/znvault

# Add certificate to sync
znvault agent add <cert-id> \
  --alias my-cert \
  --cert-file /etc/ssl/certs/my-cert.crt \
  --key-file /etc/ssl/private/my-cert.key

# Start agent with reload hook
znvault agent start --on-update "systemctl reload nginx"
```

### Agent Commands

```bash
znvault agent init                   # Initialize configuration
znvault agent add <id>               # Add certificate to sync
znvault agent remove <id>            # Remove certificate
znvault agent list                   # List configured certificates
znvault agent sync                   # One-time sync
znvault agent start                  # Start daemon
znvault agent status                 # Show sync status
```

### Features

- **Real-time Updates**: WebSocket-based push notifications
- **Resilient Connections**: Custom ping/pong with watchdog
- **Automatic Reconnection**: Fixed-interval reconnect on disconnect
- **Subscription Filtering**: Only receive events for watched certificates
- **Reload Hooks**: Run commands after updates (e.g., reload HAProxy)
- **Cross-Node Events**: Works with HA clusters via Redis pub/sub

### Example: HAProxy Automation

```bash
znvault agent init -o /etc/haproxy/certs

znvault agent add $CERT_ID \
  --alias frontend \
  --combined-file /etc/haproxy/certs/frontend.pem

znvault agent start --on-update "haproxy -c -f /etc/haproxy/haproxy.cfg && systemctl reload haproxy"
```

### Systemd Service

```ini
[Unit]
Description=ZN-Vault Certificate Agent
After=network-online.target

[Service]
Type=simple
Environment=ZNVAULT_URL=https://vault.example.com
Environment=ZNVAULT_API_KEY=znv_...
ExecStart=/usr/local/bin/znvault agent start \
  -c /etc/znvault/agent.json \
  --on-update "/usr/local/bin/reload.sh"
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
```

See [Agent Guide](../docs/AGENT_GUIDE.md) for complete documentation.

## Environment Variables

| Variable | Description |
|----------|-------------|
| `ZNVAULT_URL` | Vault API URL |
| `ZNVAULT_USERNAME` | Username for login |
| `ZNVAULT_PASSWORD` | Password for login |
| `ZNVAULT_API_KEY` | API key for authentication |
| `ZNVAULT_INSECURE` | Skip TLS verification |

## Documentation

- [Agent Guide](../docs/AGENT_GUIDE.md) - Certificate agent documentation
- [CLI Admin Guide](../docs/CLI_ADMIN_GUIDE.md) - Full CLI reference
- [KMS User Guide](../docs/KMS_USER_GUIDE.md) - Key management

## Development

```bash
# Build
npm run build

# Watch mode
npm run dev

# Run without building
npm run start -- <command>
```

## License

Proprietary - ZincApp
