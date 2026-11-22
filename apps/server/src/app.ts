import Fastify, { type FastifyInstance } from 'fastify';
import fastifyCookie from '@fastify/cookie';
import { count } from 'drizzle-orm';
import { START_COUNTDOWN_MS } from '@deadline-day/protocol';
import { registerAdminRoutes } from './admin/routes';
import { installAuth, userFromCookieHeader } from './auth/plugin';
import { registerAuthRoutes } from './auth/routes';
import type { Db } from './db/client';
import { poolPlayers } from './db/schema';
import { installErrorHandler } from './errors';
import { ReferenceData } from './games/reference';
import { registerGameRoutes } from './games/routes';
import { GameService } from './games/service';
import { Timers } from './games/timers';
import { Hub } from './realtime/hub';

export interface AppOptions {
  db: Db;
  logger?: boolean;
  /** Users who register with this username become admins. */
  adminUsername?: string;
  /** Signs the session cookie. */
  sessionSecret?: string;
  /** Mark cookies Secure (production, behind HTTPS). */
  secureCookies?: boolean;
  /** bcrypt cost factor (tests use a low one). */
  passwordCost?: number;
  /** Pre-auction countdown; 0 starts at once. */
  startCountdownMs?: number;
  chatMinIntervalMs?: number;
}

export interface DeadlineDayApp extends FastifyInstance {
  games: GameService;
  hub: Hub;
}

/** Builds the HTTP API and the Socket.IO server on the same HTTP server. */
export function buildApp(options: AppOptions): DeadlineDayApp {
  const { db } = options;
  const app = Fastify({ logger: options.logger ?? false, bodyLimit: 256 * 1024 });
  installErrorHandler(app);
  void app.register(fastifyCookie, { secret: options.sessionSecret ?? 'dev-only-session-secret-change-me' });
  installAuth(app, db);

  const timers = new Timers();
  const reference = new ReferenceData(db);
  const games = new GameService({
    db,
    reference,
    timers,
    startCountdownMs: options.startCountdownMs ?? START_COUNTDOWN_MS,
    chatMinIntervalMs: options.chatMinIntervalMs,
  });
  const hub = new Hub(app.server, games, (header) => userFromCookieHeader(app, db, header));
  games.broadcaster = hub;

  app.get('/api/health', async () => {
    const pool = db.select({ n: count() }).from(poolPlayers).get()?.n ?? 0;
    return { status: 'ok', app: 'Deadline Day', poolPlayers: pool, seeded: pool > 0 };
  });

  registerAuthRoutes(app, {
    db,
    adminUsername: options.adminUsername ?? 'admin',
    secureCookies: options.secureCookies ?? false,
    passwordCost: options.passwordCost ?? 10,
  });
  registerGameRoutes(app, games);
  registerAdminRoutes(app, db);

  app.addHook('preClose', async () => {
    timers.clear();
    hub.close();
  });

  games.restore();
  return Object.assign(app, { games, hub });
}
