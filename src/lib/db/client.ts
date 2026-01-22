// Path: src/lib/db/client.ts

/**
 * Base database client with connection management
 */

import pg from 'pg';
import { getLocalConfig } from '../local.js';

const { Client } = pg;

/**
 * Base database client for direct PostgreSQL operations.
 * Used for local mode (running on vault nodes) and emergency operations.
 */
export class BaseDBClient {
  protected client: pg.Client;
  protected connected = false;

  constructor() {
    const config = getLocalConfig();
    if (!config) {
      throw new Error(
        'Database configuration not available.\n' +
        'Either set DATABASE_URL environment variable or run with sudo on a vault node.'
      );
    }

    this.client = new Client({
      connectionString: config.databaseUrl,
      ssl: config.databaseSsl ? { rejectUnauthorized: false } : false,
    });
  }

  async connect(): Promise<void> {
    if (!this.connected) {
      await this.client.connect();
      this.connected = true;
    }
  }

  async close(): Promise<void> {
    if (this.connected) {
      await this.client.end();
      this.connected = false;
    }
  }

  async disconnect(): Promise<void> {
    return this.close();
  }

  protected async query<T>(sql: string, params?: unknown[]): Promise<T[]> {
    await this.connect();
    const result = await this.client.query(sql, params);
    return result.rows as T[];
  }

  protected async queryOne<T>(sql: string, params?: unknown[]): Promise<T | null> {
    const rows = await this.query<T>(sql, params);
    return rows[0] ?? null;
  }

  /**
   * Execute a command asynchronously with timeout
   */
  protected async execAsync(command: string, timeoutMs: number): Promise<string> {
    const { exec } = await import('node:child_process');
    const { promisify } = await import('node:util');
    const execPromise = promisify(exec);

    const { stdout } = await execPromise(command, {
      encoding: 'utf-8',
      timeout: timeoutMs,
    });
    return stdout;
  }

  /**
   * Get raw pg.Client for direct operations
   */
  protected getRawClient(): pg.Client {
    return this.client;
  }
}
