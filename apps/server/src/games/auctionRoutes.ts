import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { bidSchema, nominateSchema, swapSlotsSchema, teamControlSchema } from '@deadline-day/protocol';
import { requireUser } from '../auth/plugin';
import { parse } from '../errors';
import type { GameService } from './service';

const codeParams = z.object({ code: z.string().min(1).max(12) });
const playerParams = codeParams.extend({ playerId: z.string().min(1).max(64) });
const participantParams = codeParams.extend({ pid: z.string().min(1).max(64) });

/**
 * Live auction API (section 8). Every mutation goes through the game's serialized queue and answers
 * with the new auction state (a bid answers with just the bid); the same change is pushed to every
 * watcher over Socket.IO. Host controls check the host (or admin) role on the server.
 */
export function registerAuctionRoutes(app: FastifyInstance, games: GameService): void {
  const auction = games.auction;

  app.post('/api/games/:code/auction/nominate', async (request) => {
    const user = requireUser(request);
    const { code } = parse(codeParams, request.params);
    return { auction: await auction.nominate(user, code, parse(nominateSchema, request.body)) };
  });

  app.post('/api/games/:code/auction/bid', async (request) => {
    const user = requireUser(request);
    const { code } = parse(codeParams, request.params);
    return { bid: await auction.bid(user, code, parse(bidSchema, request.body)) };
  });

  app.post('/api/games/:code/lineup/swap', async (request) => {
    const user = requireUser(request);
    const { code } = parse(codeParams, request.params);
    return { auction: await auction.swap(user, code, parse(swapSlotsSchema, request.body)) };
  });

  // Watchlist -----------------------------------------------------------------

  app.get('/api/games/:code/watchlist', async (request) => {
    const user = requireUser(request);
    const { code } = parse(codeParams, request.params);
    return { playerIds: auction.watchlist(user, code) };
  });

  app.put('/api/games/:code/watchlist/:playerId', async (request) => {
    const user = requireUser(request);
    const { code, playerId } = parse(playerParams, request.params);
    return { playerIds: auction.star(user, code, playerId, true) };
  });

  app.delete('/api/games/:code/watchlist/:playerId', async (request) => {
    const user = requireUser(request);
    const { code, playerId } = parse(playerParams, request.params);
    return { playerIds: auction.star(user, code, playerId, false) };
  });

  // Host and admin controls ---------------------------------------------------

  const hostAction = (path: string, run: (user: ReturnType<typeof requireUser>, code: string) => Promise<unknown>) => {
    app.post(`/api/games/:code/auction/${path}`, async (request) => {
      const user = requireUser(request);
      const { code } = parse(codeParams, request.params);
      return { auction: await run(user, code) };
    });
  };
  hostAction('pause', (u, c) => auction.pause(u, c));
  hostAction('resume', (u, c) => auction.resume(u, c));
  hostAction('skip', (u, c) => auction.skip(u, c));
  hostAction('extend', (u, c) => auction.extend(u, c));
  hostAction('undo', (u, c) => auction.undo(u, c));
  hostAction('end', (u, c) => auction.endEarly(u, c));
  hostAction('reset', (u, c) => auction.reset(u, c));

  app.post('/api/games/:code/participants/:pid/control', async (request) => {
    const user = requireUser(request);
    const { code, pid } = parse(participantParams, request.params);
    return { auction: await auction.setControl(user, code, pid, parse(teamControlSchema, request.body)) };
  });

  // Team Reveal and the season ---------------------------------------------------

  app.get('/api/games/:code/reveal', async (request) => {
    const { code } = parse(codeParams, request.params);
    return { reveal: auction.reveal(code) };
  });

  app.post('/api/games/:code/season/start', async (request) => {
    const user = requireUser(request);
    const { code } = parse(codeParams, request.params);
    return { auction: await auction.startSeason(user, code) };
  });
}
