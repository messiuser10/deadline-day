import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { multiSeasonQuerySchema, playbackActionSchema, seasonQuerySchema } from '@deadline-day/protocol';
import { requireUser } from '../auth/plugin';
import { parse } from '../errors';
import type { GameService } from './service';

const codeParams = z.object({ code: z.string().min(1).max(12) });

/**
 * Season API (section 10). Anyone with the game code may read the season, the League Teams page,
 * Expected Strength and multi-season runs (spectators included). Playback controls and Run It Back
 * check the host (or admin) role on the server. Starting the season is POST /season/start (auction routes).
 */
export function registerSeasonRoutes(app: FastifyInstance, games: GameService): void {
  const season = games.season;

  app.get('/api/games/:code/season', async (request) => {
    const { code } = parse(codeParams, request.params);
    const { number } = parse(seasonQuerySchema, request.query);
    return { season: season.view(code, number) };
  });

  app.post('/api/games/:code/season/playback', async (request) => {
    const user = requireUser(request);
    const { code } = parse(codeParams, request.params);
    return { playback: await season.control(user, code, parse(playbackActionSchema, request.body)) };
  });

  app.post('/api/games/:code/season/rerun', async (request) => {
    const user = requireUser(request);
    const { code } = parse(codeParams, request.params);
    return { season: await season.runItBack(user, code) };
  });

  app.get('/api/games/:code/season/expected', async (request) => {
    const { code } = parse(codeParams, request.params);
    return { expected: await season.expectedStrength(code) };
  });

  app.get('/api/games/:code/season/multi', async (request) => {
    const { code } = parse(codeParams, request.params);
    return { multi: season.multiSeason(code, parse(multiSeasonQuerySchema, request.query)) };
  });

  app.get('/api/games/:code/league', async (request) => {
    const { code } = parse(codeParams, request.params);
    return { league: season.league(code) };
  });
}
