import { type Command } from 'commander';
import ora from 'ora';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { spawn } from 'child_process';
import * as mode from '../lib/mode.js';
import * as output from '../lib/output.js';
import * as config from '../lib/config.js';
import type { DecryptedCertificate } from '../types/index.js';

/**
 * Certificate target configuration - matches standalone agent format
 * @see zn-vault-agent/src/lib/config.ts
 */
interface CertTarget {
  /** Certificate ID in vault */
  certId: string;
  /** Human-readable name */
  name: string;
  /** Output paths for certificate components */
  outputs: {
    /** Combined cert+key (for HAProxy) */
    combined?: string;
    /** Certificate only */
    cert?: string;
    /** Private key only */
    key?: string;
    /** CA chain */
    chain?: string;
    /** Full chain (cert + chain) */
    fullchain?: string;
  };
  /** File ownership (user:group) */
  owner?: string;
  /** File permissions (e.g., "0640") */
  mode?: string;
  /** Command to run after cert update */
  reloadCmd?: string;
  /** Health check command (must return 0 for success) */
  healthCheckCmd?: string;
}

/**
 * Agent configuration - matches standalone agent format
 * @see zn-vault-agent/src/lib/config.ts
 */
interface AgentConfig {
  /** Vault server URL */
  vaultUrl: string;
  /** Tenant ID */
  tenantId: string;
  /** Authentication */
  auth: {
    /** API key (preferred) */
    apiKey?: string;
    /** Or username/password */
    username?: string;
    password?: string;
  };
  /** Skip TLS verification */
  insecure?: boolean;
  /** Certificate targets */
  targets: CertTarget[];
  /** Global reload command (if not set per-target) */
  globalReloadCmd?: string;
  /** Polling interval in seconds (fallback if WebSocket disconnects) */
  pollInterval?: number;
  /** Enable verbose logging */
  verbose?: boolean;
}

interface SyncState {
  certificates: Record<string, {
    id: string;
    alias: string;
    lastSync: string;
    version: number;
    fingerprint: string;
  }>;
  lastUpdate: string;
}

// Command options interfaces
interface InitOptions {
  config?: string;
}

interface AddOptions {
  name?: string;
  combined?: string;
  cert?: string;
  key?: string;
  chain?: string;
  fullchain?: string;
  owner?: string;
  mode?: string;
  reload?: string;
  healthCheck?: string;
  config?: string;
}

interface RemoveOptions {
  config?: string;
}

interface ListOptions {
  config?: string;
  json?: boolean;
}

interface SyncOptions {
  config?: string;
  state: string;
  force?: boolean;
}

interface StartOptions {
  config?: string;
  verbose?: boolean;
  healthPort?: string;
  foreground?: boolean;
}

interface StatusOptions {
  config?: string;
  state: string;
  json?: boolean;
}

interface RemoteListOptions {
  status?: string;
  tenant?: string;
  json?: boolean;
}

interface ConnectionsOptions {
  tenant?: string;
  json?: boolean;
}

interface AlertsOptions {
  enable?: boolean;
  disable?: boolean;
  threshold?: string;
}

interface DeleteOptions {
  yes?: boolean;
}

// Config locations - match standalone agent
const SYSTEM_CONFIG_DIR = '/etc/zn-vault-agent';
const SYSTEM_CONFIG_FILE = path.join(SYSTEM_CONFIG_DIR, 'config.json');
const USER_CONFIG_DIR = path.join(os.homedir(), '.config', 'zn-vault-agent');
const USER_CONFIG_FILE = path.join(USER_CONFIG_DIR, 'config.json');

/**
 * Format relative time for display
 */
function formatRelativeTime(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffMins < 1) return 'just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  return `${diffDays}d ago`;
}

// State file location
const STATE_DIR = path.join(os.homedir(), '.local', 'state', 'zn-vault-agent');
const DEFAULT_STATE_FILE = path.join(STATE_DIR, 'state.json');

/**
 * Get the appropriate config file path based on privileges
 */
function getConfigPath(): string {
  // If running as root and system config exists, use it
  if (process.getuid?.() === 0) {
    return SYSTEM_CONFIG_FILE;
  }
  // Check if system config exists (for non-root reading)
  if (fs.existsSync(SYSTEM_CONFIG_FILE)) {
    return SYSTEM_CONFIG_FILE;
  }
  // Fall back to user config
  return USER_CONFIG_FILE;
}

/**
 * Load agent configuration
 */
function loadConfig(configPath?: string): AgentConfig | null {
  const filePath = configPath ?? getConfigPath();

  if (!fs.existsSync(filePath)) {
    return null;
  }

  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as AgentConfig;
  } catch {
    return null;
  }
}

/**
 * Save agent configuration
 */
function saveConfig(agentConfig: AgentConfig, configPath?: string): void {
  const filePath = configPath ?? getConfigPath();
  const dir = path.dirname(filePath);

  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  }

  fs.writeFileSync(filePath, JSON.stringify(agentConfig, null, 2), { mode: 0o600 });
}

/**
 * Create default config with current CLI credentials
 */
function createDefaultConfig(): AgentConfig {
  const cliConfig = config.getConfig();
  const credentials = config.getCredentials();
  const envCredentials = config.getEnvCredentials();
  const apiKey = config.getApiKey();

  // Get tenant from: env > stored credentials > default tenant
  const tenantId = process.env.ZNVAULT_TENANT_ID ??
    credentials?.tenantId ??
    cliConfig.defaultTenant ??
    '';

  return {
    vaultUrl: cliConfig.url,
    tenantId,
    auth: {
      apiKey: apiKey,
      username: envCredentials?.username,
      password: envCredentials?.password,
    },
    insecure: cliConfig.insecure,
    targets: [],
    pollInterval: 3600,
  };
}

// Remote agent types
interface RemoteAgent {
  id: string;
  tenantId: string;
  hostname: string;
  version: string | null;
  platform: string | null;
  status: 'online' | 'offline';
  lastSeen: string;
  alertOnDisconnect: boolean;
  disconnectThresholdSeconds: number;
  subscriptions: {
    certificates: string[];
    secrets: string[];
    updates: string | null;
  };
}

interface RemoteAgentConnection {
  agentId: string;
  hostname: string;
  tenantId: string;
  version: string;
  platform: string;
  connectedAt: string;
}

export function registerAgentCommands(program: Command): void {
  const agent = program
    .command('agent')
    .description('Certificate synchronization agent configuration and management');

  // Initialize agent configuration
  agent
    .command('init')
    .description('Initialize agent configuration')
    .option('-c, --config <path>', 'Config file path')
    .action((options: InitOptions) => {
      const configPath = options.config ?? getConfigPath();

      if (fs.existsSync(configPath)) {
        output.error(`Config already exists at ${configPath}`);
        output.info('Use "znvault agent add" to add certificates');
        process.exit(1);
      }

      const agentConfig = createDefaultConfig();
      saveConfig(agentConfig, configPath);

      console.log(`Agent configuration initialized at ${configPath}`);
      console.log();
      console.log('Next steps:');
      console.log('  1. Add certificates: znvault agent add <cert-id> --combined /path/to/cert.pem');
      console.log('  2. Start the agent: zn-vault-agent start');
      console.log();
      console.log('Or install as systemd service:');
      console.log('  sudo systemctl enable --now zn-vault-agent');
    });

  // Add certificate to sync
  agent
    .command('add <cert-id>')
    .description('Add a certificate to sync')
    .option('-n, --name <name>', 'Human-readable name for the certificate')
    .option('--combined <path>', 'Output path for combined cert+key file (HAProxy)')
    .option('--cert <path>', 'Output path for certificate file')
    .option('--key <path>', 'Output path for private key file')
    .option('--chain <path>', 'Output path for CA chain file')
    .option('--fullchain <path>', 'Output path for fullchain file (cert+chain)')
    .option('--owner <user:group>', 'File ownership (e.g., haproxy:haproxy)')
    .option('--mode <mode>', 'File permissions (e.g., 0640)', '0640')
    .option('--reload <command>', 'Command to run after cert update')
    .option('--health-check <command>', 'Health check command (must return 0)')
    .option('-c, --config <path>', 'Config file path')
    .action(async (certId: string, options: AddOptions) => {
      const spinner = ora('Validating certificate...').start();

      try {
        // Validate the certificate exists
        const cert = await mode.apiGet<{ id: string; alias: string }>(`/v1/certificates/${certId}`);
        spinner.stop();

        // Load or create config
        const configPath = options.config ?? getConfigPath();
        let agentConfig = loadConfig(configPath);

        if (!agentConfig) {
          output.info('No config found, creating with current CLI credentials...');
          agentConfig = createDefaultConfig();
        }

        // Check if already added
        if (agentConfig.targets.some(t => t.certId === certId)) {
          output.error(`Certificate ${certId} is already configured`);
          process.exit(1);
        }

        // Validate at least one output is specified
        if (!options.combined && !options.cert && !options.key && !options.chain && !options.fullchain) {
          output.error('At least one output path is required (--combined, --cert, --key, --chain, or --fullchain)');
          process.exit(1);
        }

        const target: CertTarget = {
          certId,
          name: options.name ?? cert.alias,
          outputs: {},
          mode: options.mode,
        };

        if (options.combined) target.outputs.combined = options.combined;
        if (options.cert) target.outputs.cert = options.cert;
        if (options.key) target.outputs.key = options.key;
        if (options.chain) target.outputs.chain = options.chain;
        if (options.fullchain) target.outputs.fullchain = options.fullchain;
        if (options.owner) target.owner = options.owner;
        if (options.reload) target.reloadCmd = options.reload;
        if (options.healthCheck) target.healthCheckCmd = options.healthCheck;

        agentConfig.targets.push(target);
        saveConfig(agentConfig, configPath);

        console.log(`Added certificate: ${target.name} (${certId})`);
        if (target.outputs.combined) console.log(`  Combined: ${target.outputs.combined}`);
        if (target.outputs.cert) console.log(`  Certificate: ${target.outputs.cert}`);
        if (target.outputs.key) console.log(`  Private key: ${target.outputs.key}`);
        if (target.outputs.chain) console.log(`  Chain: ${target.outputs.chain}`);
        if (target.outputs.fullchain) console.log(`  Fullchain: ${target.outputs.fullchain}`);
        if (target.reloadCmd) console.log(`  Reload: ${target.reloadCmd}`);
      } catch (err) {
        spinner.fail('Failed to add certificate');
        output.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
      } finally {
        await mode.closeLocalClient();
      }
    });

  // Remove certificate from sync
  agent
    .command('remove <cert-id-or-name>')
    .description('Remove a certificate from sync')
    .option('-c, --config <path>', 'Config file path')
    .action((certIdOrName: string, options: RemoveOptions) => {
      const configPath = options.config ?? getConfigPath();
      const agentConfig = loadConfig(configPath);

      if (!agentConfig) {
        output.error(`Config not found. Run 'znvault agent init' first.`);
        process.exit(1);
      }

      const idx = agentConfig.targets.findIndex(t =>
        t.certId === certIdOrName || t.name === certIdOrName
      );

      if (idx === -1) {
        output.error(`Certificate "${certIdOrName}" not found in configuration`);
        process.exit(1);
      }

      const removed = agentConfig.targets.splice(idx, 1)[0];
      saveConfig(agentConfig, configPath);
      console.log(`Removed certificate: ${removed.name} (${removed.certId})`);
    });

  // List configured certificates
  agent
    .command('list')
    .description('List configured certificates')
    .option('-c, --config <path>', 'Config file path')
    .option('--json', 'Output as JSON')
    .action((options: ListOptions) => {
      const configPath = options.config ?? getConfigPath();
      const agentConfig = loadConfig(configPath);

      if (!agentConfig) {
        output.error(`Config not found. Run 'znvault agent init' first.`);
        process.exit(1);
      }

      if (options.json) {
        output.json(agentConfig);
        return;
      }

      console.log(`Config: ${configPath}`);
      console.log(`Vault: ${agentConfig.vaultUrl}`);
      console.log(`Tenant: ${agentConfig.tenantId}`);
      console.log(`Certificates: ${agentConfig.targets.length}`);
      console.log();

      if (agentConfig.targets.length === 0) {
        console.log('No certificates configured. Use "znvault agent add <cert-id>" to add one.');
        return;
      }

      output.table(
        ['Name', 'Cert ID', 'Outputs', 'Reload'],
        agentConfig.targets.map(t => [
          t.name,
          t.certId.substring(0, 8) + '...',
          Object.entries(t.outputs).filter(([, v]) => v).map(([k]) => k).join(', '),
          t.reloadCmd ? t.reloadCmd.substring(0, 30) : '-',
        ])
      );
    });

  // Sync certificates (one-time)
  agent
    .command('sync')
    .description('Sync all configured certificates (one-time)')
    .option('-c, --config <path>', 'Config file path')
    .option('-s, --state <path>', 'State file path', DEFAULT_STATE_FILE)
    .option('--force', 'Force sync even if unchanged')
    .action(async (options: SyncOptions) => {
      const spinner = ora('Syncing certificates...').start();

      try {
        const configPath = options.config ?? getConfigPath();
        const agentConfig = loadConfig(configPath);

        if (!agentConfig) {
          spinner.fail('Config not found');
          output.error(`Run 'znvault agent init' first.`);
          process.exit(1);
        }

        if (agentConfig.targets.length === 0) {
          spinner.fail('No certificates configured');
          output.error('Use "znvault agent add <cert-id>" to add certificates.');
          process.exit(1);
        }

        // Load or create state
        let state: SyncState = { certificates: {}, lastUpdate: new Date().toISOString() };
        if (fs.existsSync(options.state)) {
          state = JSON.parse(fs.readFileSync(options.state, 'utf-8')) as SyncState;
        }

        let synced = 0;
        let skipped = 0;
        let failed = 0;

        for (const target of agentConfig.targets) {
          try {
            // Get certificate with decrypted data
            const cert = await mode.apiPost<DecryptedCertificate>(
              `/v1/certificates/${target.certId}/decrypt`,
              { purpose: 'agent-sync' }
            );

            // Check if changed
            const certFingerprint = cert.fingerprintSha256;
            const existingState = state.certificates[target.certId];
            if (!options.force && existingState.fingerprint === certFingerprint) {
              skipped++;
              continue;
            }

            // Decode certificate data
            const certData = Buffer.from(cert.certificateData, 'base64').toString('utf-8');
            const keyData = cert.privateKeyData ? Buffer.from(cert.privateKeyData, 'base64').toString('utf-8') : null;
            const chainData = cert.chainData ? Buffer.from(cert.chainData, 'base64').toString('utf-8') : null;

            const fileMode = parseInt(target.mode ?? '0640', 8);

            // Write certificate file
            if (target.outputs.cert) {
              ensureDir(path.dirname(target.outputs.cert));
              fs.writeFileSync(target.outputs.cert, certData, { mode: fileMode });
            }

            // Write private key
            if (target.outputs.key && keyData) {
              ensureDir(path.dirname(target.outputs.key));
              fs.writeFileSync(target.outputs.key, keyData, { mode: 0o600 });
            }

            // Write chain
            if (target.outputs.chain && chainData) {
              ensureDir(path.dirname(target.outputs.chain));
              fs.writeFileSync(target.outputs.chain, chainData, { mode: fileMode });
            }

            // Write fullchain (cert + chain)
            if (target.outputs.fullchain) {
              let fullchain = certData;
              if (chainData) fullchain += '\n' + chainData;
              ensureDir(path.dirname(target.outputs.fullchain));
              fs.writeFileSync(target.outputs.fullchain, fullchain, { mode: fileMode });
            }

            // Write combined (cert + key + chain)
            if (target.outputs.combined) {
              let combined = certData;
              if (keyData) combined += '\n' + keyData;
              if (chainData) combined += '\n' + chainData;
              ensureDir(path.dirname(target.outputs.combined));
              fs.writeFileSync(target.outputs.combined, combined, { mode: 0o600 });
            }

            // Update state
            state.certificates[target.certId] = {
              id: target.certId,
              alias: cert.alias,
              lastSync: new Date().toISOString(),
              version: cert.version,
              fingerprint: certFingerprint,
            };

            synced++;
          } catch (err) {
            failed++;
            console.error(`\nFailed to sync ${target.name}: ${err instanceof Error ? err.message : String(err)}`);
          }
        }

        // Save state
        state.lastUpdate = new Date().toISOString();
        ensureDir(path.dirname(options.state));
        fs.writeFileSync(options.state, JSON.stringify(state, null, 2));

        spinner.stop();
        console.log(`Sync complete: ${synced} synced, ${skipped} unchanged, ${failed} failed`);
      } catch (err) {
        spinner.fail('Sync failed');
        output.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
      } finally {
        await mode.closeLocalClient();
      }
    });

  // Start agent daemon (delegates to standalone agent)
  agent
    .command('start')
    .description('Start the certificate sync agent daemon')
    .option('-c, --config <path>', 'Config file path')
    .option('-v, --verbose', 'Enable verbose logging')
    .option('--health-port <port>', 'Enable health/metrics HTTP server')
    .option('--foreground', 'Run in foreground')
    .action((options: StartOptions) => {
      const configPath = options.config ?? getConfigPath();

      if (!fs.existsSync(configPath)) {
        output.error(`Config not found at ${configPath}`);
        output.info(`Run 'znvault agent init' first.`);
        process.exit(1);
      }

      // Build command arguments
      const args = ['start'];
      if (options.verbose) args.push('--verbose');
      if (options.healthPort) args.push('--health-port', options.healthPort);

      // Set config path via environment if not default
      const env = { ...process.env };
      if (options.config) {
        env.ZNVAULT_AGENT_CONFIG_DIR = path.dirname(options.config);
      }

      console.log('Starting zn-vault-agent daemon...');
      console.log();

      // Try to find the standalone agent
      const agentPaths = [
        '/usr/local/bin/zn-vault-agent',
        '/usr/bin/zn-vault-agent',
        path.join(os.homedir(), '.local', 'bin', 'zn-vault-agent'),
        // Development: check sibling directory
        path.resolve(__dirname, '..', '..', '..', '..', 'zn-vault-agent', 'dist', 'index.js'),
      ];

      let agentPath: string | null = null;
      for (const p of agentPaths) {
        if (fs.existsSync(p)) {
          agentPath = p;
          break;
        }
      }

      if (!agentPath) {
        output.error('zn-vault-agent not found');
        console.log();
        console.log('Install the standalone agent:');
        console.log('  cd zn-vault-agent && npm install && npm run build');
        console.log('  sudo ./deploy/install.sh');
        console.log();
        console.log('Or run directly:');
        console.log('  cd zn-vault-agent && npm run start -- start');
        process.exit(1);
      }

      // Determine how to run it
      const isJsFile = agentPath.endsWith('.js');
      const command = isJsFile ? 'node' : agentPath;
      const spawnArgs = isJsFile ? [agentPath, ...args] : args;

      // Spawn the agent
      const child = spawn(command, spawnArgs, {
        env,
        stdio: 'inherit',
        detached: !options.foreground,
      });

      if (!options.foreground) {
        child.unref();
        console.log(`Agent started with PID ${String(child.pid)}`);
        process.exit(0);
      }

      // In foreground mode, wait for the process
      child.on('exit', (code) => {
        process.exit(code ?? 0);
      });
    });

  // Show agent status
  agent
    .command('status')
    .description('Show agent configuration and sync status')
    .option('-c, --config <path>', 'Config file path')
    .option('-s, --state <path>', 'State file path', DEFAULT_STATE_FILE)
    .option('--json', 'Output as JSON')
    .action((options: StatusOptions) => {
      const configPath = options.config ?? getConfigPath();
      const agentConfig = loadConfig(configPath);

      if (!agentConfig) {
        output.error(`Config not found. Run 'znvault agent init' first.`);
        process.exit(1);
      }

      let state: SyncState = { certificates: {}, lastUpdate: 'never' };
      if (fs.existsSync(options.state)) {
        state = JSON.parse(fs.readFileSync(options.state, 'utf-8')) as SyncState;
      }

      if (options.json) {
        output.json({ config: agentConfig, state });
        return;
      }

      console.log('Agent Configuration:');
      console.log(`  Config file: ${configPath}`);
      console.log(`  Vault URL: ${agentConfig.vaultUrl}`);
      console.log(`  Tenant: ${agentConfig.tenantId}`);
      console.log(`  Certificates: ${agentConfig.targets.length}`);
      console.log(`  Last sync: ${state.lastUpdate}`);
      console.log();

      if (agentConfig.targets.length === 0) {
        console.log('No certificates configured.');
        return;
      }

      output.table(
        ['Name', 'Cert ID', 'Last Sync', 'Version', 'Fingerprint'],
        agentConfig.targets.map(t => {
          const s = state.certificates[t.certId];
          return [
            t.name,
            t.certId.substring(0, 8) + '...',
            new Date(s.lastSync).toLocaleString(),
            String(s.version),
            s.fingerprint.substring(0, 16) + '...',
          ];
        })
      );
    });

  // ===== Remote Agent Management Commands =====

  const remote = agent
    .command('remote')
    .description('Manage agents registered with the vault');

  // List remote agents
  remote
    .command('list')
    .description('List agents registered with the vault')
    .option('--status <status>', 'Filter by status (online, offline)')
    .option('--tenant <tenantId>', 'Filter by tenant (superadmin only)')
    .option('--json', 'Output as JSON')
    .action(async (options: RemoteListOptions) => {
      const spinner = ora('Fetching agents...').start();

      try {
        const params = new URLSearchParams();
        if (options.status) params.set('status', options.status);
        if (options.tenant) params.set('tenantId', options.tenant);
        params.set('pageSize', '100');

        const query = params.toString();
        const response = await mode.apiGet<{
          agents: RemoteAgent[];
          pagination: { totalItems: number };
        }>(`/v1/agents${query ? `?${query}` : ''}`);

        spinner.stop();

        if (options.json) {
          output.json(response);
          return;
        }

        if (response.agents.length === 0) {
          console.log('No agents registered');
          return;
        }

        console.log(`Total agents: ${response.pagination.totalItems}`);
        console.log();

        output.table(
          ['Hostname', 'Status', 'Last Seen', 'Version', 'Platform', 'Alerts'],
          response.agents.map(a => [
            a.hostname,
            a.status === 'online' ? '● online' : '○ offline',
            formatRelativeTime(a.lastSeen),
            a.version ?? '-',
            a.platform ?? '-',
            a.alertOnDisconnect ? 'enabled' : 'disabled',
          ])
        );
      } catch (err) {
        spinner.fail('Failed to fetch agents');
        output.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
      } finally {
        await mode.closeLocalClient();
      }
    });

  // Show active connections
  remote
    .command('connections')
    .description('Show active WebSocket connections')
    .option('--tenant <tenantId>', 'Filter by tenant (superadmin only)')
    .option('--json', 'Output as JSON')
    .action(async (options: ConnectionsOptions) => {
      const spinner = ora('Fetching connections...').start();

      try {
        const query = options.tenant ? `?tenantId=${encodeURIComponent(options.tenant)}` : '';
        const response = await mode.apiGet<{
          connections: RemoteAgentConnection[];
          totalConnections: number;
        }>(`/v1/agents/connections${query}`);

        spinner.stop();

        if (options.json) {
          output.json(response);
          return;
        }

        if (response.connections.length === 0) {
          console.log('No active connections');
          return;
        }

        console.log(`Active connections: ${response.totalConnections}`);
        console.log();

        output.table(
          ['Hostname', 'Tenant', 'Version', 'Platform', 'Connected'],
          response.connections.map(c => [
            c.hostname,
            c.tenantId,
            c.version,
            c.platform,
            formatRelativeTime(c.connectedAt),
          ])
        );
      } catch (err) {
        spinner.fail('Failed to fetch connections');
        output.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
      } finally {
        await mode.closeLocalClient();
      }
    });

  // Configure agent alerts
  remote
    .command('alerts <agent-id>')
    .description('Configure disconnect alerts for an agent')
    .option('--enable', 'Enable disconnect alerts')
    .option('--disable', 'Disable disconnect alerts')
    .option('--threshold <seconds>', 'Set disconnect threshold in seconds', '600')
    .action(async (agentId: string, options: AlertsOptions) => {
      if (!options.enable && !options.disable) {
        output.error('Specify --enable or --disable');
        process.exit(1);
      }

      const spinner = ora('Updating agent alerts...').start();

      try {
        const payload: { alertOnDisconnect?: boolean; disconnectThresholdSeconds?: number } = {};

        if (options.enable) payload.alertOnDisconnect = true;
        if (options.disable) payload.alertOnDisconnect = false;
        if (options.threshold) payload.disconnectThresholdSeconds = parseInt(options.threshold, 10);

        const remoteAgent = await mode.apiPatch<RemoteAgent>(
          `/v1/agents/${encodeURIComponent(agentId)}/alerts`,
          payload
        );

        spinner.succeed(`Alerts ${remoteAgent.alertOnDisconnect ? 'enabled' : 'disabled'} for ${remoteAgent.hostname}`);

        if (remoteAgent.alertOnDisconnect) {
          console.log(`  Threshold: ${remoteAgent.disconnectThresholdSeconds} seconds`);
        }
      } catch (err) {
        spinner.fail('Failed to update alerts');
        output.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
      } finally {
        await mode.closeLocalClient();
      }
    });

  // Delete agent
  remote
    .command('delete <agent-id>')
    .description('Remove an agent from the vault')
    .option('-y, --yes', 'Skip confirmation')
    .action(async (agentId: string, options: DeleteOptions) => {
      if (!options.yes) {
        const readline = await import('readline');
        const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
        const answer = await new Promise<string>(resolve => {
          rl.question(`Delete agent ${agentId}? This will remove all activity history. [y/N] `, resolve);
        });
        rl.close();

        if (answer.toLowerCase() !== 'y') {
          console.log('Cancelled');
          return;
        }
      }

      const spinner = ora('Deleting agent...').start();

      try {
        await mode.apiDelete(`/v1/agents/${encodeURIComponent(agentId)}`);
        spinner.succeed('Agent deleted');
      } catch (err) {
        spinner.fail('Failed to delete agent');
        output.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
      } finally {
        await mode.closeLocalClient();
      }
    });

  // ===== Registration Token Commands =====

  const token = agent
    .command('token')
    .description('Manage registration tokens for agent bootstrapping');

  // Create registration token
  token
    .command('create')
    .description('Create a one-time registration token for managed key binding')
    .requiredOption('-k, --managed-key <name>', 'Name of the managed key to bind')
    .option('-e, --expires <duration>', 'Token expiration (e.g., "1h", "24h")', '1h')
    .option('-d, --description <text>', 'Optional description for audit trail')
    .option('--tenant <tenantId>', 'Target tenant ID (superadmin only)')
    .action(async (options: {
      managedKey: string;
      expires: string;
      description?: string;
      tenant?: string;
    }) => {
      const spinner = ora('Creating registration token...').start();

      try {
        const tenantQuery = options.tenant ? `?tenantId=${encodeURIComponent(options.tenant)}` : '';

        const response = await mode.apiPost<{
          token: string;
          prefix: string;
          id: string;
          managedKeyName: string;
          tenantId: string;
          expiresAt: string;
          description: string | null;
        }>(
          `/auth/api-keys/managed/${encodeURIComponent(options.managedKey)}/registration-tokens${tenantQuery}`,
          {
            expiresIn: options.expires,
            description: options.description,
          }
        );

        spinner.succeed('Registration token created');
        console.log();
        console.log('Token (save this - shown only once!):');
        console.log(`  ${response.token}`);
        console.log();
        console.log('Details:');
        console.log(`  Prefix: ${response.prefix}`);
        console.log(`  Managed Key: ${response.managedKeyName}`);
        console.log(`  Tenant: ${response.tenantId}`);
        console.log(`  Expires: ${new Date(response.expiresAt).toLocaleString()}`);
        if (response.description) {
          console.log(`  Description: ${response.description}`);
        }
        console.log();
        console.log('Usage:');
        console.log(`  curl -sSL https://vault.example.com/agent/bootstrap.sh | ZNVAULT_TOKEN=${response.token} bash`);
        console.log();
        console.log('Or manually:');
        console.log(`  curl -X POST https://vault.example.com/agent/bootstrap \\`);
        console.log(`    -H "Content-Type: application/json" \\`);
        console.log(`    -d '{"token": "${response.token}"}'`);
      } catch (err) {
        spinner.fail('Failed to create registration token');
        output.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
      } finally {
        await mode.closeLocalClient();
      }
    });

  // List registration tokens
  token
    .command('list')
    .description('List registration tokens for a managed key')
    .requiredOption('-k, --managed-key <name>', 'Name of the managed key')
    .option('--include-used', 'Include already-used tokens')
    .option('--tenant <tenantId>', 'Target tenant ID (superadmin only)')
    .option('--json', 'Output as JSON')
    .action(async (options: {
      managedKey: string;
      includeUsed?: boolean;
      tenant?: string;
      json?: boolean;
    }) => {
      const spinner = ora('Fetching registration tokens...').start();

      try {
        const params = new URLSearchParams();
        if (options.tenant) params.set('tenantId', options.tenant);
        if (options.includeUsed) params.set('includeUsed', 'true');

        const query = params.toString();
        const response = await mode.apiGet<{
          tokens: Array<{
            id: string;
            prefix: string;
            managedKeyName: string;
            tenantId: string;
            createdBy: string;
            createdAt: string;
            expiresAt: string;
            usedAt: string | null;
            usedByIp: string | null;
            revokedAt: string | null;
            description: string | null;
            status: 'active' | 'used' | 'expired' | 'revoked';
          }>;
        }>(`/auth/api-keys/managed/${encodeURIComponent(options.managedKey)}/registration-tokens${query ? `?${query}` : ''}`);

        spinner.stop();

        if (options.json) {
          output.json(response);
          return;
        }

        if (response.tokens.length === 0) {
          console.log('No registration tokens found');
          return;
        }

        console.log(`Registration tokens for ${options.managedKey}:`);
        console.log();

        output.table(
          ['Prefix', 'Status', 'Created', 'Expires', 'Description'],
          response.tokens.map(t => [
            t.prefix,
            t.status === 'active' ? '● active' :
              t.status === 'used' ? '○ used' :
              t.status === 'expired' ? '○ expired' : '○ revoked',
            formatRelativeTime(t.createdAt),
            formatRelativeTime(t.expiresAt),
            t.description?.substring(0, 30) ?? '-',
          ])
        );
      } catch (err) {
        spinner.fail('Failed to fetch registration tokens');
        output.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
      } finally {
        await mode.closeLocalClient();
      }
    });

  // Revoke registration token
  token
    .command('revoke <token-id>')
    .description('Revoke a registration token (prevents future use)')
    .requiredOption('-k, --managed-key <name>', 'Name of the managed key')
    .option('--tenant <tenantId>', 'Target tenant ID (superadmin only)')
    .option('-y, --yes', 'Skip confirmation prompt')
    .action(async (tokenId: string, options: {
      managedKey: string;
      tenant?: string;
      yes?: boolean;
    }) => {
      if (!options.yes) {
        const readline = await import('readline');
        const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
        const answer = await new Promise<string>(resolve => {
          rl.question(`Revoke token ${tokenId}? This cannot be undone. [y/N] `, resolve);
        });
        rl.close();

        if (answer.toLowerCase() !== 'y') {
          console.log('Cancelled');
          return;
        }
      }

      const spinner = ora('Revoking registration token...').start();

      try {
        const tenantQuery = options.tenant ? `?tenantId=${encodeURIComponent(options.tenant)}` : '';

        await mode.apiDelete(
          `/auth/api-keys/managed/${encodeURIComponent(options.managedKey)}/registration-tokens/${encodeURIComponent(tokenId)}${tenantQuery}`
        );

        spinner.succeed('Registration token revoked');
      } catch (err) {
        spinner.fail('Failed to revoke registration token');
        output.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
      } finally {
        await mode.closeLocalClient();
      }
    });
}

function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}
