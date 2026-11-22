import Fastify, { type FastifyInstance } from 'fastify';
import { count } from 'drizzle-orm';
import type { Db } from './db/client';
import { poolPlayers } from './db/schema';

export interface AppOptions {
  db: Db;
  logger?: boolean;
}

/** Builds the HTTP app. M0 only exposes a health check; later milestones add auth, games and sockets. */
export function buildApp({ db, logger = false }: AppOptions): FastifyInstance {
  const app = Fastify({ logger });

  app.get('/api/health', async () => {
    const pool = db.select({ n: count() }).from(poolPlayers).get()?.n ?? 0;
    return { status: 'ok', app: 'Deadline Day', poolPlayers: pool, seeded: pool > 0 };
  });

  return app;
}
