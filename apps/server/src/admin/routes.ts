import type { FastifyInstance } from 'fastify';
import { desc, eq, like, or } from 'drizzle-orm';
import { z } from 'zod';
import { adminUserPatchSchema } from '@deadline-day/protocol';
import { audit } from '../audit';
import { requireAdmin } from '../auth/plugin';
import { deleteUserSessions } from '../auth/sessions';
import type { Db } from '../db/client';
import { users } from '../db/schema';
import { badRequest, notFound, parse } from '../errors';

/** Admin endpoints. Every route re-checks the admin role on the server. The full admin panel arrives in M6. */
export function registerAdminRoutes(app: FastifyInstance, db: Db): void {
  app.get('/api/admin/users', async (request) => {
    requireAdmin(request);
    const { q } = parse(z.object({ q: z.string().trim().max(40).optional() }), request.query);
    const where = q ? or(like(users.username, `%${q.toLowerCase()}%`), like(users.displayName, `%${q}%`)) : undefined;
    const rows = db.select().from(users).where(where).orderBy(desc(users.createdAt)).limit(200).all();
    return {
      users: rows.map((u) => ({
        id: u.id,
        username: u.username,
        displayName: u.displayName,
        role: u.role,
        isGuest: u.isGuest,
        banned: u.banned,
        createdAt: u.createdAt,
      })),
    };
  });

  app.patch('/api/admin/users/:id', async (request) => {
    const admin = requireAdmin(request);
    const { id } = parse(z.object({ id: z.string().min(1) }), request.params);
    const input = parse(adminUserPatchSchema, request.body);
    const target = db.select().from(users).where(eq(users.id, id)).get();
    if (!target) throw notFound('USER_NOT_FOUND', 'No such user');
    if (target.id === admin.id && (input.role === 'user' || input.banned)) {
      throw badRequest('SELF_DEMOTE', 'You cannot demote or ban yourself');
    }
    if (input.role === 'admin' && target.isGuest) throw badRequest('GUEST_ADMIN', 'A guest cannot be an admin');
    const changes = { ...(input.role ? { role: input.role } : {}), ...(input.banned === undefined ? {} : { banned: input.banned }) };
    db.update(users).set(changes).where(eq(users.id, id)).run();
    if (input.banned) deleteUserSessions(db, id);
    audit(db, { actorUserId: admin.id, action: 'admin.user.update', target: id, details: changes });
    const u = db.select().from(users).where(eq(users.id, id)).get()!;
    return { user: { id: u.id, username: u.username, displayName: u.displayName, role: u.role, isGuest: u.isGuest, banned: u.banned } };
  });
}
