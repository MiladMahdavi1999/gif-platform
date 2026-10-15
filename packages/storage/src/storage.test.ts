import { createServer } from 'node:http';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { expect, it } from 'vitest';
import { checkObjectStore } from './index.js';

it.each([200, 503])(
  'uses the actual object-store readiness HTTP response: %s',
  async (status) => {
    let requestedPath = '';
    const server = createServer((request, response) => {
      requestedPath = request.url ?? '';
      response.writeHead(status).end();
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    try {
      const endpoint = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
      if (status === 200)
        await expect(checkObjectStore(endpoint)).resolves.toBeUndefined();
      else
        await expect(checkObjectStore(endpoint)).rejects.toThrow(
          'Object store is unavailable',
        );
      expect(requestedPath).toBe('/minio/health/ready');
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  },
);
