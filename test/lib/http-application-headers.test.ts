import {createServer, type Server} from 'node:http';
import {afterEach, describe, expect, it} from 'vitest';
import {HttpClient} from '../../src/lib/client/http.js';

let server: Server | undefined;

afterEach(async () => {
  if (server) await new Promise<void>(resolve => server?.close(() => resolve()));
  server = undefined;
});

describe('HttpClient application headers', () => {
  it('sends Idempotency-Key without allowing auth/transport overrides', async () => {
    let received: string | undefined;
    server = createServer((request, response) => {
      received = request.headers['idempotency-key'];
      response.writeHead(200, {'Content-Type': 'application/json'});
      response.end('{"ok":true}');
    });
    await new Promise<void>(resolve => server?.listen(0, '127.0.0.1', () => resolve()));
    const address = server.address();
    if (address === null || typeof address === 'string') throw new Error('test server has no TCP port');
    const client = new HttpClient({baseUrl: `http://127.0.0.1:${address.port.toString()}`});

    await expect(client.request<{ok: boolean}>({
      method: 'POST',
      path: '/permit',
      skipAuth: true,
      body: {},
      headers: {'Idempotency-Key': '6c4a9aea-a265-4c71-8b70-cc4418d152e7'}, // gitleaks:allow reason=synthetic UUID for idempotency header test
    })).resolves.toEqual({ok: true});
    expect(received).toBe('6c4a9aea-a265-4c71-8b70-cc4418d152e7');

    await expect(client.request({
      method: 'GET',
      path: '/forbidden',
      skipAuth: true,
      headers: {Authorization: 'Bearer attacker-controlled'},
    })).rejects.toThrow(/protected HTTP header/i);
  });
});
