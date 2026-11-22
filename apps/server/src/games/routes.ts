import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  addBotSchema,
  botPatchSchema,
  chatSchema,
  createGameSchema,
  nominationOrderSchema,
  settingsPatchSchema,
  soloGameSchema,
  startSchema,
  teamPatchSchema,
  teamSchema,
  transferHostSchema,
  type PublicSettings,
} from '@deadline-day/protocol';
import { requireUser } from '../auth/plugin';
import { parse } from '../errors';
import type { GameService } from './service';

const codeParams = z.object({ code: z.string().min(1).max(12) });
const participantParams = codeParams.extend({ pid: z.string().min(1).max(64) });

/**
 * Game REST API. Mutations answer with the new lobby state, and the same state is pushed to every
 * client watching the game over Socket.IO.
 */
export function registerGameRoutes(app: FastifyInstance, games: GameService): void {
  const state = (code: string) => ({ state: games.lobbyState(games.findGame(code)) });

  app.get('/api/settings/public', async (): Promise<PublicSettings> => {
    const s = games.appSettings();
    return {
      leagueName: s.league_name,
      formationsEnabled: s.formations_enabled,
      gameDefaults: s.game_defaults,
      gameLimits: s.game_limits,
      registrationsOpen: s.registrations_open,
      publicLobbiesEnabled: s.public_lobbies_enabled,
      maintenanceBanner: s.maintenance_banner.message,
    };
  });

  app.get('/api/games/public', async () => ({ lobbies: games.publicLobbies() }));

  app.post('/api/games', async (request, reply) => {
    const user = requireUser(request);
    const input = parse(createGameSchema, request.body);
    return reply.status(201).send(games.create(user, input));
  });

  app.post('/api/games/solo', async (request, reply) => {
    const user = requireUser(request);
    const input = parse(soloGameSchema, request.body);
    return reply.status(201).send(games.createSolo(user, input.team));
  });

  app.get('/api/games/:code', async (request) => {
    const { code } = parse(codeParams, request.params);
    return { snapshot: games.snapshotByCode(code) };
  });

  app.post('/api/games/:code/join', async (request, reply) => {
    const user = requireUser(request);
    const { code } = parse(codeParams, request.params);
    const input = parse(teamSchema, request.body);
    const { participantId } = games.join(user, code, input);
    return reply.status(201).send({ participantId, ...state(code) });
  });

  app.patch('/api/games/:code/team', async (request) => {
    const user = requireUser(request);
    const { code } = parse(codeParams, request.params);
    games.updateTeam(user, code, parse(teamPatchSchema, request.body));
    return state(code);
  });

  app.post('/api/games/:code/leave', async (request) => {
    const user = requireUser(request);
    const { code } = parse(codeParams, request.params);
    games.leave(user, code);
    return { ok: true };
  });

  app.post('/api/games/:code/chat', async (request, reply) => {
    const user = requireUser(request);
    const { code } = parse(codeParams, request.params);
    const { body } = parse(chatSchema, request.body);
    return reply.status(201).send({ message: games.chat(user, code, body) });
  });

  // Host controls ------------------------------------------------------------

  app.patch('/api/games/:code/settings', async (request) => {
    const user = requireUser(request);
    const { code } = parse(codeParams, request.params);
    games.updateSettings(user, code, parse(settingsPatchSchema, request.body));
    return state(code);
  });

  app.post('/api/games/:code/bots', async (request, reply) => {
    const user = requireUser(request);
    const { code } = parse(codeParams, request.params);
    const { participantId } = games.addBot(user, code, parse(addBotSchema, request.body));
    return reply.status(201).send({ participantId, ...state(code) });
  });

  app.patch('/api/games/:code/participants/:pid', async (request) => {
    const user = requireUser(request);
    const { code, pid } = parse(participantParams, request.params);
    games.updateBot(user, code, pid, parse(botPatchSchema, request.body));
    return state(code);
  });

  app.delete('/api/games/:code/participants/:pid', async (request) => {
    const user = requireUser(request);
    const { code, pid } = parse(participantParams, request.params);
    games.removeParticipant(user, code, pid);
    return state(code);
  });

  app.post('/api/games/:code/host', async (request) => {
    const user = requireUser(request);
    const { code } = parse(codeParams, request.params);
    games.transferHost(user, code, parse(transferHostSchema, request.body).participantId);
    return state(code);
  });

  app.put('/api/games/:code/order', async (request) => {
    const user = requireUser(request);
    const { code } = parse(codeParams, request.params);
    games.setNominationOrder(user, code, parse(nominationOrderSchema, request.body).order);
    return state(code);
  });

  app.post('/api/games/:code/order/randomize', async (request) => {
    const user = requireUser(request);
    const { code } = parse(codeParams, request.params);
    games.randomizeNominationOrder(user, code);
    return state(code);
  });

  app.post('/api/games/:code/start', async (request, reply) => {
    const user = requireUser(request);
    const { code } = parse(codeParams, request.params);
    const { force } = parse(startSchema, request.body);
    const result = games.requestStart(user, code, force);
    return reply.status(202).send({ ...result, ...state(code) });
  });

  app.post('/api/games/:code/cancel', async (request) => {
    const user = requireUser(request);
    const { code } = parse(codeParams, request.params);
    games.cancel(user, code);
    return state(code);
  });
}
