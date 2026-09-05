import { Writable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import Fastify, { type FastifyRequest } from 'fastify';
import { serializeRequest } from '../src/app.js';

/**
 * Where a request says it came from. Behind Caddy or a Docker bridge the socket
 * peer is the gateway, so the log has to carry `req.ip` instead.
 */

interface LoggedRequest {
  req?: { method: string; url: string; ip: string };
}

/** Collects the pino lines instead of writing them to stdout. */
function memoryStream(): { lines: string[]; stream: Writable } {
  const lines: string[] = [];
  const stream = new Writable({
    write(chunk: Buffer, _encoding, done) {
      lines.push(chunk.toString('utf8'));
      done();
    },
  });
  return { lines, stream };
}

describe('request logging', () => {
  it('reports method, url and ip — and nothing else off the socket', () => {
    const req = { method: 'GET', url: '/api/health', ip: '203.0.113.9' } as FastifyRequest;
    expect(serializeRequest(req)).toEqual({
      method: 'GET',
      url: '/api/health',
      ip: '203.0.113.9',
    });
  });

  it('logs the X-Forwarded-For client rather than the proxy that relayed it', async () => {
    const { lines, stream } = memoryStream();
    const app = Fastify({
      trustProxy: true,
      logger: { level: 'info', serializers: { req: serializeRequest }, stream },
    });
    app.get('/api/ping', () => ({ ok: true }));

    await app.inject({
      method: 'GET',
      url: '/api/ping',
      headers: { 'x-forwarded-for': '203.0.113.9, 10.0.0.7' },
      remoteAddress: '10.0.0.7',
    });
    await app.close();

    const logged = lines
      .map((line) => JSON.parse(line) as LoggedRequest)
      .find((entry) => entry.req !== undefined);
    expect(logged?.req).toEqual({ method: 'GET', url: '/api/ping', ip: '203.0.113.9' });
  });
});
