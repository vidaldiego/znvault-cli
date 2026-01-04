// Path: znvault-cli/src/services/auto-update-daemon.ts

/**
 * Auto-Update Daemon
 *
 * Background service that periodically checks for updates
 * and installs them during configured maintenance windows.
 * Supports WebSocket notifications from vault for real-time updates.
 */

import WebSocket from 'ws';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createUpdateChecker } from './update-checker.js';
import { createUpdateInstaller } from './update-installer.js';
import type { UpdateConfig, UpdateProgress, MaintenanceWindow, ArtifactInfo } from '../types/update.js';
import * as mode from '../lib/mode.js';

interface PackageJson {
  version?: string;
}

interface WebSocketMessage {
  type: string;
  data?: {
    event?: string;
    version?: string;
  };
}

/**
 * Get current version from package.json
 */
function getCurrentVersion(): string {
  // This should match the implementation in update.ts
  // In a real scenario, we'd share this utility
  try {
    const __dirname = path.dirname(fileURLToPath(import.meta.url));
    const pkgPath = path.join(__dirname, '../../package.json');
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8')) as PackageJson;
    return pkg.version ?? 'unknown';
  } catch {
    return 'unknown';
  }
}

/**
 * Check if current time is within a maintenance window
 */
function isWithinMaintenanceWindow(window: MaintenanceWindow): boolean {
  const now = new Date();

  // Parse window times
  const [startHour, startMin] = window.start.split(':').map(Number);
  const [endHour, endMin] = window.end.split(':').map(Number);

  // Get current time in the specified timezone
  let currentHour: number;
  let currentMin: number;

  try {
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: window.timezone,
      hour: 'numeric',
      minute: 'numeric',
      hour12: false,
    });
    const parts = formatter.formatToParts(now);
    currentHour = parseInt(parts.find(p => p.type === 'hour')?.value ?? '0', 10);
    currentMin = parseInt(parts.find(p => p.type === 'minute')?.value ?? '0', 10);
  } catch {
    // Fallback to local time
    currentHour = now.getHours();
    currentMin = now.getMinutes();
  }

  const currentTime = currentHour * 60 + currentMin;
  const startTime = startHour * 60 + startMin;
  const endTime = endHour * 60 + endMin;

  // Handle windows that span midnight
  if (endTime < startTime) {
    return currentTime >= startTime || currentTime < endTime;
  }

  return currentTime >= startTime && currentTime < endTime;
}

export class AutoUpdateDaemon {
  private config: UpdateConfig;
  private checker: ReturnType<typeof createUpdateChecker>;
  private ws: WebSocket | null = null;
  private checkTimer: ReturnType<typeof setInterval> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private isShuttingDown = false;
  private pendingUpdate: { version: string; artifact: ArtifactInfo } | null = null;

  constructor(config: UpdateConfig) {
    this.config = config;
    this.checker = createUpdateChecker(config.channel);
  }

  /**
   * Log with timestamp
   */
  private log(message: string): void {
    console.log(`[${new Date().toISOString()}] [AutoUpdate] ${message}`);
  }

  /**
   * Log error with timestamp
   */
  private logError(message: string): void {
    console.error(`[${new Date().toISOString()}] [AutoUpdate] ERROR: ${message}`);
  }

  /**
   * Start the daemon
   */
  async start(): Promise<void> {
    this.log('Starting auto-update daemon...');
    this.log(`Channel: ${this.config.channel}`);
    this.log(`Check interval: ${this.config.checkInterval / 60000} minutes`);

    if (this.config.maintenanceWindow) {
      this.log(`Maintenance window: ${this.config.maintenanceWindow.start}-${this.config.maintenanceWindow.end} ${this.config.maintenanceWindow.timezone}`);
    } else {
      this.log('No maintenance window configured - updates allowed anytime');
    }

    // Initial check
    await this.checkForUpdates();

    // Start periodic checks
    this.checkTimer = setInterval(() => {
      this.checkForUpdates().catch((err: unknown) => {
        this.logError(`Check failed: ${err instanceof Error ? err.message : String(err)}`);
      });
    }, this.config.checkInterval);

    // Connect to vault WebSocket if URL configured
    if (this.config.vaultUrl) {
      await this.connectWebSocket();
    }

    // Handle shutdown signals
    process.on('SIGINT', () => { this.shutdown(); });
    process.on('SIGTERM', () => { this.shutdown(); });
  }

  /**
   * Check for updates and install if appropriate
   */
  private async checkForUpdates(): Promise<void> {
    this.log('Checking for updates...');

    try {
      const currentVersion = getCurrentVersion();
      const result = await this.checker.checkForUpdates(currentVersion);

      if (result.error) {
        this.logError(result.error);
        return;
      }

      if (!result.updateAvailable) {
        this.log(`Up to date (${currentVersion})`);
        return;
      }

      this.log(`Update available: ${currentVersion} -> ${result.latestVersion}`);

      // Store pending update
      if (result.artifact) {
        this.pendingUpdate = {
          version: result.latestVersion,
          artifact: result.artifact,
        };
      }

      // Check if we can install now
      await this.tryInstallPendingUpdate();
    } catch (err) {
      this.logError(`Check failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  /**
   * Try to install pending update if within maintenance window
   */
  private async tryInstallPendingUpdate(): Promise<void> {
    if (!this.pendingUpdate) {
      return;
    }

    // Check maintenance window
    if (this.config.maintenanceWindow) {
      if (!isWithinMaintenanceWindow(this.config.maintenanceWindow)) {
        this.log('Outside maintenance window - update deferred');
        return;
      }
      this.log('Within maintenance window - proceeding with update');
    }

    await this.installUpdate();
  }

  /**
   * Install the pending update
   */
  private async installUpdate(): Promise<void> {
    if (!this.pendingUpdate) {
      return;
    }

    const { version, artifact } = this.pendingUpdate;
    this.log(`Installing update to version ${version}...`);

    const progressHandler = (progress: UpdateProgress): void => {
      this.log(`${progress.stage}: ${progress.message}`);
    };

    try {
      const installer = createUpdateInstaller(this.config.installPath, progressHandler);

      // Check permissions
      const { canInstall, reason } = installer.canInstall();
      if (!canInstall) {
        this.logError(`Cannot install: ${reason ?? 'Unknown reason'}`);
        return;
      }

      await installer.install(artifact, version);

      this.log(`Successfully updated to version ${version}`);
      this.pendingUpdate = null;

      // Save last known version
      this.checker.saveLastKnownVersion(version);
    } catch (err) {
      this.logError(`Installation failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  /**
   * Connect to vault WebSocket for real-time notifications
   */
  private async connectWebSocket(): Promise<void> {
    if (!this.config.vaultUrl || this.isShuttingDown) {
      return;
    }

    try {
      const wsUrl = this.config.vaultUrl
        .replace(/^https?:/, 'wss:')
        .replace(/\/$/, '') + '/v1/ws/agent-updates';

      this.log(`Connecting to ${wsUrl}...`);

      // Get auth headers if available
      let headers: Record<string, string> = {};
      try {
        headers = await mode.getAuthHeaders();
      } catch {
        // No auth available
      }

      this.ws = new WebSocket(wsUrl, {
        headers,
        rejectUnauthorized: false, // Allow self-signed certs
      });

      this.ws.on('open', () => {
        this.log('Connected to vault WebSocket');
      });

      this.ws.on('message', (rawData: WebSocket.RawData) => {
        try {
          let dataStr: string;
          if (Buffer.isBuffer(rawData)) {
            dataStr = rawData.toString('utf-8');
          } else if (ArrayBuffer.isView(rawData)) {
            dataStr = Buffer.from(rawData.buffer, rawData.byteOffset, rawData.byteLength).toString('utf-8');
          } else if (Array.isArray(rawData)) {
            dataStr = Buffer.concat(rawData).toString('utf-8');
          } else {
            dataStr = '';
          }
          const msg = JSON.parse(dataStr) as WebSocketMessage;

          if (msg.type === 'event' && msg.data?.event === 'agent.update.available') {
            this.log(`Received update notification: ${msg.data.version ?? 'unknown'}`);
            // Trigger immediate check
            void this.checkForUpdates();
          } else if (msg.type === 'pong') {
            // Heartbeat response
          }
        } catch (err) {
          this.logError(`Failed to parse message: ${err instanceof Error ? err.message : String(err)}`);
        }
      });

      this.ws.on('close', () => {
        this.log('WebSocket disconnected');
        this.ws = null;
        this.scheduleReconnect();
      });

      this.ws.on('error', (err) => {
        this.logError(`WebSocket error: ${err.message}`);
      });
    } catch (err) {
      this.logError(`Failed to connect: ${err instanceof Error ? err.message : String(err)}`);
      this.scheduleReconnect();
    }
  }

  /**
   * Schedule WebSocket reconnection
   */
  private scheduleReconnect(): void {
    if (this.isShuttingDown || !this.config.vaultUrl) {
      return;
    }

    if (this.reconnectTimer) {
      return; // Already scheduled
    }

    this.log('Reconnecting in 30 seconds...');
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.connectWebSocket();
    }, 30000);
  }

  /**
   * Shutdown the daemon
   */
  private shutdown(): void {
    if (this.isShuttingDown) {
      return;
    }

    this.isShuttingDown = true;
    this.log('Shutting down...');

    // Clear timers
    if (this.checkTimer) {
      clearInterval(this.checkTimer);
      this.checkTimer = null;
    }

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    // Close WebSocket
    if (this.ws) {
      try {
        this.ws.close(1000, 'Daemon shutdown');
      } catch {
        // Ignore
      }
      this.ws = null;
    }

    process.exit(0);
  }
}
