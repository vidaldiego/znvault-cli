import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import http from 'node:http';
import { AddressInfo } from 'node:net';

describe('VaultClient', () => {
  let server: http.Server;
  let serverUrl: string;

  beforeEach(async () => {
    // Create a simple mock server
    server = http.createServer((req, res) => {
      let body = '';
      req.on('data', chunk => body += chunk);
      req.on('end', () => {
        res.setHeader('Content-Type', 'application/json');

        if (req.url === '/v1/health') {
          res.end(JSON.stringify({
            status: 'ok',
            version: '1.0.0',
            uptime: 3600,
            timestamp: new Date().toISOString(),
          }));
        } else if (req.url === '/auth/login' && req.method === 'POST') {
          const data = JSON.parse(body);
          if (data.username === 'admin' && data.password === 'password') {
            res.end(JSON.stringify({
              accessToken: 'mock-access-token',
              refreshToken: 'mock-refresh-token',
              expiresIn: 3600,
              user: {
                id: 'user-123',
                username: 'admin',
                role: 'superadmin',
                tenantId: null,
              },
            }));
          } else {
            res.statusCode = 401;
            res.end(JSON.stringify({ error: 'Unauthorized', message: 'Invalid credentials' }));
          }
        } else if (req.url?.startsWith('/v1/tenants') && req.method === 'GET') {
          res.end(JSON.stringify({
            items: [
              { id: 'tenant-1', name: 'Test Tenant', status: 'active', createdAt: new Date().toISOString() },
            ],
            total: 1,
            page: 1,
            pageSize: 1000,
          }));
        } else if (req.url === '/v1/admin/lockdown/status' && req.method === 'GET') {
          res.end(JSON.stringify({
            scope: 'SYSTEM',
            status: 'NORMAL',
            escalationCount: 0,
          }));
        } else {
          res.statusCode = 404;
          res.end(JSON.stringify({ error: 'Not Found', message: 'Endpoint not found' }));
        }
      });
    });

    await new Promise<void>(resolve => {
      server.listen(0, '127.0.0.1', () => resolve());
    });

    const address = server.address() as AddressInfo;
    serverUrl = `http://127.0.0.1:${address.port}`;

    // Set environment variable for the client
    process.env.ZNVAULT_URL = serverUrl;
  });

  afterEach(async () => {
    delete process.env.ZNVAULT_URL;
    delete process.env.ZNVAULT_API_KEY;
    await new Promise<void>(resolve => server.close(() => resolve()));
    vi.resetModules();
  });

  describe('health', () => {
    it('should fetch health status', async () => {
      const { VaultClient } = await import('../../src/lib/client.js');
      const client = new VaultClient();

      const health = await client.health();

      expect(health.status).toBe('ok');
      expect(health.version).toBe('1.0.0');
      expect(health.uptime).toBe(3600);
    });
  });

  describe('login', () => {
    it('should login successfully with valid credentials', async () => {
      const { VaultClient } = await import('../../src/lib/client.js');
      const client = new VaultClient();

      const response = await client.login('admin', 'password');

      expect(response.accessToken).toBe('mock-access-token');
      expect(response.user.username).toBe('admin');
      expect(response.user.role).toBe('superadmin');
    });

    it('should fail login with invalid credentials', async () => {
      const { VaultClient } = await import('../../src/lib/client.js');
      const client = new VaultClient();

      await expect(client.login('admin', 'wrongpassword')).rejects.toThrow('Invalid credentials');
    });
  });

  describe('listTenants', () => {
    it('should list tenants', async () => {
      // Mock API key for authentication
      process.env.ZNVAULT_API_KEY = 'test-api-key';

      const { VaultClient } = await import('../../src/lib/client.js');
      const client = new VaultClient();

      const tenants = await client.listTenants();

      expect(tenants).toHaveLength(1);
      expect(tenants[0].id).toBe('tenant-1');
      expect(tenants[0].name).toBe('Test Tenant');
    });
  });

  describe('getLockdownStatus', () => {
    it('should get lockdown status', async () => {
      process.env.ZNVAULT_API_KEY = 'test-api-key';

      const { VaultClient } = await import('../../src/lib/client.js');
      const client = new VaultClient();

      const status = await client.getLockdownStatus();

      expect(status.scope).toBe('SYSTEM');
      expect(status.status).toBe('NORMAL');
    });
  });
});
