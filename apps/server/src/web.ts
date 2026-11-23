/**
 * Production: the API server also serves the built web app (apps/web/dist), so one process runs everything.
 * Hashed files under /assets are cached for a year; index.html is revalidated on every load. Any GET for a
 * page route (no file extension, not /api or /socket.io) gets index.html and the client router takes over.
 */
import { existsSync } from 'node:fs';
import { join, sep } from 'node:path';
import fastifyStatic from '@fastify/static';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

/** The build folder if it holds an index.html, else null. */
export function findWebBuild(dir: string): string | null {
  return existsSync(join(dir, 'index.html')) ? dir : null;
}

export function registerWebApp(app: FastifyInstance, dir: string): void {
  void app.register(fastifyStatic, {
    root: dir,
    wildcard: false,
    index: false,
    // Serves the .br or .gz copy written at build time when the browser accepts it.
    preCompressed: true,
    cacheControl: false,
    setHeaders(res, path) {
      res.setHeader('cache-control', path.includes(`${sep}assets${sep}`) ? 'public, max-age=31536000, immutable' : 'no-cache');
    },
  });
  app.addHook('onSend', async (_request, reply) => {
    reply.header('x-content-type-options', 'nosniff');
    reply.header('referrer-policy', 'strict-origin-when-cross-origin');
    reply.header('x-frame-options', 'SAMEORIGIN');
  });
}

/** A browser asking for a page of the single-page app (not the API, the socket or a missing file). */
export function isPageRequest(request: FastifyRequest): boolean {
  if (request.method !== 'GET' && request.method !== 'HEAD') return false;
  const path = request.url.split('?')[0] ?? '/';
  if (path === '/api' || path.startsWith('/api/') || path.startsWith('/socket.io')) return false;
  return !/\.[a-z0-9]+$/i.test(path);
}

export function sendIndex(reply: FastifyReply): void {
  void reply.header('cache-control', 'no-cache').sendFile('index.html');
}
