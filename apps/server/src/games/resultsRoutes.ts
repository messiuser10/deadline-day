import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { exportQuerySchema, hallOfFameQuerySchema, seasonQuerySchema } from '@deadline-day/protocol';
import { requireUser } from '../auth/plugin';
import type { Db } from '../db/client';
import { parse } from '../errors';
import { HistoryService } from './history';
import type { GameService } from './service';

const codeParams = z.object({ code: z.string().min(1).max(12) });
const usernameParams = z.object({ username: z.string().min(1).max(40) });

/**
 * Results and history API (section 10). Results, profiles, the Hall of Fame, the leaderboard and the record
 * book are readable without signing in. Rematch and Export check the host (or admin) role on the server.
 */
export function registerResultsRoutes(app: FastifyInstance, games: GameService, db: Db): void {
  const history = new HistoryService(games, db);

  app.get('/api/games/:code/results', async (request) => {
    const { code } = parse(codeParams, request.params);
    const { number } = parse(seasonQuerySchema, request.query);
    return { results: games.results.results(code, number) };
  });

  app.post('/api/games/:code/rematch', async (request) => {
    const user = requireUser(request);
    const { code } = parse(codeParams, request.params);
    return games.rematch(user, code);
  });

  app.get('/api/games/:code/export', async (request, reply) => {
    const user = requireUser(request);
    const { code } = parse(codeParams, request.params);
    const file = games.results.export(user, code, parse(exportQuerySchema, request.query));
    return reply
      .header('content-type', file.contentType)
      .header('content-disposition', `attachment; filename="${file.filename}"`)
      .header('cache-control', 'no-store')
      .send(file.body);
  });

  app.get('/api/profile', async (request) => {
    const user = requireUser(request);
    return { profile: history.profile(user.username, user) };
  });

  app.get('/api/profiles/:username', async (request) => {
    const { username } = parse(usernameParams, request.params);
    return { profile: history.profile(username, request.user) };
  });

  app.get('/api/hall-of-fame', async (request) => {
    const { before } = parse(hallOfFameQuerySchema, request.query);
    return { hallOfFame: history.hallOfFame(request.user, before) };
  });

  app.get('/api/leaderboard', async () => ({ leaderboard: history.leaderboard() }));

  app.get('/api/records', async (request) => ({ records: history.records(request.user) }));
}
