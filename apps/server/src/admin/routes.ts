import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import {
  adminGamesQuerySchema,
  adminOrderSchema,
  adminSeedSchema,
  adminUserPatchSchema,
  adminUsersQuerySchema,
  auditQuerySchema,
  clubPatchSchema,
  deleteUserSchema,
  labRunSchema,
  labTeamsQuerySchema,
  poolBulkSchema,
  poolIdSchema,
  poolImportSchema,
  poolPlayerCreateSchema,
  poolPlayerPatchSchema,
  priceParamsSchema,
  settingUpdateSchema,
  squadPlayerSchema,
  testAuctionSchema,
} from '@deadline-day/protocol';
import { requireAdmin } from '../auth/plugin';
import type { UserRow } from '../auth/sessions';
import type { Db } from '../db/client';
import { parse } from '../errors';
import type { GameService } from '../games/service';
import { AuditAdmin } from './audit';
import { ClubsAdmin } from './clubs';
import { GamesAdmin } from './games';
import { LabAdmin } from './lab';
import { OverviewAdmin } from './overview';
import { PoolAdmin } from './pool';
import { SettingsAdmin } from './settings';
import { UsersAdmin } from './users';

type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export interface AdminRouteInfo {
  method: Method;
  url: string;
}

interface AdminRoute extends AdminRouteInfo {
  bodyLimit?: number;
  handler: (admin: UserRow, request: FastifyRequest, reply: FastifyReply) => unknown;
}

const idParams = z.object({ id: z.string().min(1).max(120) });
const poolParams = z.object({ id: poolIdSchema });
const codeParams = z.object({ code: z.string().min(1).max(12) });
const squadParams = z.object({ id: z.string().min(1).max(60), playerId: z.string().min(1).max(120) });
const exportQuery = z.object({ format: z.enum(['csv', 'json']).default('csv') });
const IMPORT_BODY_LIMIT = 4 * 1024 * 1024;

const download = (reply: FastifyReply, file: { filename: string; contentType: string; body: string }) =>
  reply
    .header('content-type', file.contentType)
    .header('content-disposition', `attachment; filename="${file.filename}"`)
    .header('cache-control', 'no-store')
    .send(file.body);

/**
 * The admin API (section 11). Every route is registered through one loop that calls requireAdmin
 * before anything else, so a missing check cannot slip in; the returned list lets tests try them all.
 */
export function registerAdminRoutes(app: FastifyInstance, db: Db, games: GameService): AdminRouteInfo[] {
  const pool = new PoolAdmin(db, games);
  const clubs = new ClubsAdmin(db, games);
  const gamesAdmin = new GamesAdmin(db, games);
  const settings = new SettingsAdmin(db, games);
  const lab = new LabAdmin(db, games);
  const users = new UsersAdmin(db);
  const audit = new AuditAdmin(db);
  const overview = new OverviewAdmin(db, games, pool, audit);

  const routes: AdminRoute[] = [
    // Overview
    { method: 'GET', url: '/api/admin/overview', handler: () => ({ overview: overview.view() }) },

    // Pool players
    { method: 'GET', url: '/api/admin/pool', handler: () => ({ pool: pool.list() }) },
    {
      method: 'POST',
      url: '/api/admin/pool',
      handler: (admin, req, reply) => reply.status(201).send({ player: pool.create(admin, parse(poolPlayerCreateSchema, req.body)) }),
    },
    {
      method: 'PATCH',
      url: '/api/admin/pool/:id',
      handler: (admin, req) => ({ player: pool.update(admin, parse(poolParams, req.params).id, parse(poolPlayerPatchSchema, req.body)) }),
    },
    {
      method: 'DELETE',
      url: '/api/admin/pool/:id',
      handler: (admin, req, reply) => {
        pool.remove(admin, parse(poolParams, req.params).id);
        return reply.status(204).send();
      },
    },
    { method: 'POST', url: '/api/admin/pool/bulk', handler: (admin, req) => pool.bulk(admin, parse(poolBulkSchema, req.body)) },
    { method: 'GET', url: '/api/admin/pool/export', handler: (_a, req, reply) => download(reply, pool.exportFile(parse(exportQuery, req.query).format)) },
    {
      method: 'POST',
      url: '/api/admin/pool/import/preview',
      bodyLimit: IMPORT_BODY_LIMIT,
      handler: (_a, req) => ({ preview: pool.previewImport(parse(poolImportSchema, req.body)) }),
    },
    {
      method: 'POST',
      url: '/api/admin/pool/import/apply',
      bodyLimit: IMPORT_BODY_LIMIT,
      handler: (admin, req) => ({ preview: pool.applyImport(admin, parse(poolImportSchema, req.body)) }),
    },
    { method: 'POST', url: '/api/admin/pool/reprice/preview', handler: (_a, req) => ({ preview: pool.previewReprice(parse(priceParamsSchema, req.body)) }) },
    { method: 'POST', url: '/api/admin/pool/reprice/apply', handler: (admin, req) => ({ preview: pool.applyReprice(admin, parse(priceParamsSchema, req.body)) }) },

    // Clubs and squads
    { method: 'GET', url: '/api/admin/clubs', handler: () => clubs.list() },
    {
      method: 'PATCH',
      url: '/api/admin/clubs/:id',
      handler: (admin, req) => ({ club: clubs.patch(admin, parse(idParams, req.params).id, parse(clubPatchSchema, req.body)) }),
    },
    { method: 'GET', url: '/api/admin/clubs/:id/squad', handler: (_a, req) => ({ squad: clubs.squad(parse(idParams, req.params).id) }) },
    {
      method: 'POST',
      url: '/api/admin/clubs/:id/squad',
      handler: (admin, req, reply) => reply.status(201).send({ squad: clubs.addPlayer(admin, parse(idParams, req.params).id, parse(squadPlayerSchema, req.body)) }),
    },
    {
      method: 'PUT',
      url: '/api/admin/clubs/:id/squad/:playerId',
      handler: (admin, req) => {
        const p = parse(squadParams, req.params);
        return { squad: clubs.updatePlayer(admin, p.id, p.playerId, parse(squadPlayerSchema, req.body)) };
      },
    },
    {
      method: 'DELETE',
      url: '/api/admin/clubs/:id/squad/:playerId',
      handler: (admin, req) => {
        const p = parse(squadParams, req.params);
        return { squad: clubs.removePlayer(admin, p.id, p.playerId) };
      },
    },

    // Games (the other game actions are the host endpoints, which admins may call for any game)
    { method: 'GET', url: '/api/admin/games', handler: (_a, req) => gamesAdmin.list(parse(adminGamesQuerySchema, req.query)) },
    { method: 'GET', url: '/api/admin/games/:code', handler: (_a, req) => ({ detail: gamesAdmin.detail(parse(codeParams, req.params).code) }) },
    {
      method: 'PUT',
      url: '/api/admin/games/:code/order',
      handler: async (admin, req) => ({ detail: await gamesAdmin.reorder(admin, parse(codeParams, req.params).code, parse(adminOrderSchema, req.body).order) }),
    },
    {
      method: 'POST',
      url: '/api/admin/games/:code/seed',
      handler: (admin, req) => ({ seed: games.changeSeed(admin, parse(codeParams, req.params).code, parse(adminSeedSchema, req.body ?? {}).seed) }),
    },
    {
      method: 'DELETE',
      url: '/api/admin/games/:code',
      handler: (admin, req, reply) => {
        games.deleteGame(admin, parse(codeParams, req.params).code);
        return reply.status(204).send();
      },
    },

    // Settings and announcements
    { method: 'GET', url: '/api/admin/settings', handler: () => settings.view() },
    {
      method: 'PUT',
      url: '/api/admin/settings',
      handler: (admin, req) => {
        const { key, value } = parse(settingUpdateSchema, req.body);
        return settings.update(admin, key, value);
      },
    },

    // Simulation Lab
    { method: 'GET', url: '/api/admin/lab/teams', handler: (_a, req) => lab.teams(parse(labTeamsQuerySchema, req.query).game) },
    { method: 'POST', url: '/api/admin/lab/run', handler: async (_a, req) => ({ result: await lab.run(parse(labRunSchema, req.body)) }) },
    { method: 'POST', url: '/api/admin/lab/test-auction', handler: async (admin, req) => ({ result: await lab.testAuction(admin, parse(testAuctionSchema, req.body)) }) },

    // Users
    {
      method: 'GET',
      url: '/api/admin/users',
      handler: (_a, req) => {
        const q = parse(adminUsersQuerySchema, req.query);
        return users.list(q.q, q.filter);
      },
    },
    { method: 'GET', url: '/api/admin/users/:id', handler: (_a, req) => ({ detail: users.detail(parse(idParams, req.params).id) }) },
    {
      method: 'PATCH',
      url: '/api/admin/users/:id',
      handler: (admin, req) => ({ detail: users.patch(admin, parse(idParams, req.params).id, parse(adminUserPatchSchema, req.body)) }),
    },
    {
      method: 'POST',
      url: '/api/admin/users/:id/delete',
      handler: (admin, req, reply) => {
        users.remove(admin, parse(idParams, req.params).id, parse(deleteUserSchema, req.body).confirm);
        return reply.status(204).send();
      },
    },

    // Audit log
    { method: 'GET', url: '/api/admin/audit', handler: (_a, req) => audit.page(parse(auditQuerySchema, req.query)) },
    {
      method: 'GET',
      url: '/api/admin/audit/export',
      handler: (_a, req, reply) => {
        const f = parse(auditQuerySchema, req.query);
        const stamp = new Date().toISOString().slice(0, 10);
        return download(reply, { filename: `audit-log-${stamp}.csv`, contentType: 'text/csv; charset=utf-8', body: audit.csv(f) });
      },
    },
  ];

  for (const r of routes) {
    app.route({
      method: r.method,
      url: r.url,
      ...(r.bodyLimit ? { bodyLimit: r.bodyLimit } : {}),
      handler: async (request, reply) => r.handler(requireAdmin(request), request, reply),
    });
  }
  return routes.map(({ method, url }) => ({ method, url }));
}
