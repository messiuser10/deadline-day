import { randomBytes } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { guestSchema, loginSchema, registerSchema } from '@deadline-day/protocol';
import type { Db } from '../db/client';
import { users } from '../db/schema';
import { ApiError, badRequest, conflict, forbidden, parse } from '../errors';
import { readAppSettings } from '../settings/store';
import { findProfanity } from '../text/profanity';
import { clearSessionCookie, setSessionCookie } from './plugin';
import { createSession, deleteSession, deleteUserSessions, hashPassword, userView, verifyPassword } from './sessions';

export interface AuthRouteOptions {
  db: Db;
  adminUsername: string;
  secureCookies: boolean;
  passwordCost: number;
}

export const GUEST_PREFIX = 'guest_';

export function registerAuthRoutes(app: FastifyInstance, opts: AuthRouteOptions): void {
  const { db } = opts;
  const adminUsername = opts.adminUsername.trim().toLowerCase();
  // Compared against when a username does not exist, so response time does not reveal which usernames exist.
  const dummyHash = hashPassword('not-a-real-password', opts.passwordCost);

  const checkClean = (field: string, value: string) => {
    if (findProfanity(value, readAppSettings(db).profanity_words)) {
      throw badRequest('PROFANITY', `Please choose a different ${field}`);
    }
  };

  app.get('/api/auth/me', async (request) => ({ user: request.user ? userView(request.user) : null }));

  app.post('/api/auth/register', async (request, reply) => {
    const input = parse(registerSchema, request.body);
    const isAdminName = input.username === adminUsername;
    if (!readAppSettings(db).registrations_open && !isAdminName) {
      throw forbidden('REGISTRATIONS_CLOSED', 'New accounts are closed right now. You can still play as a guest.');
    }
    if (input.username.startsWith(GUEST_PREFIX)) throw badRequest('USERNAME_RESERVED', 'Usernames starting with guest_ are reserved');
    checkClean('username', input.username);
    if (input.displayName) checkClean('name', input.displayName);
    if (db.select({ id: users.id }).from(users).where(eq(users.username, input.username)).get()) {
      throw conflict('USERNAME_TAKEN', 'That username is taken');
    }
    const passwordHash = await hashPassword(input.password, opts.passwordCost);
    const role = isAdminName ? 'admin' : 'user';
    const current = request.user;
    let userId: string;
    if (current?.isGuest) {
      // Upgrade the guest in place so the games it joined stay its own.
      db.update(users)
        .set({ username: input.username, passwordHash, isGuest: false, role, displayName: input.displayName ?? current.displayName })
        .where(eq(users.id, current.id))
        .run();
      deleteUserSessions(db, current.id);
      userId = current.id;
    } else {
      userId = db
        .insert(users)
        .values({ username: input.username, passwordHash, displayName: input.displayName ?? input.username, role })
        .returning({ id: users.id })
        .get().id;
    }
    setSessionCookie(reply, createSession(db, userId), opts.secureCookies);
    const user = db.select().from(users).where(eq(users.id, userId)).get()!;
    return reply.status(201).send({ user: userView(user) });
  });

  app.post('/api/auth/login', async (request, reply) => {
    const input = parse(loginSchema, request.body);
    const user = db.select().from(users).where(eq(users.username, input.username)).get();
    const ok = user?.passwordHash
      ? await verifyPassword(input.password, user.passwordHash)
      : (await verifyPassword(input.password, await dummyHash), false);
    if (!user || !ok) throw new ApiError(401, 'INVALID_CREDENTIALS', 'Wrong username or password');
    if (user.banned) throw forbidden('BANNED', 'This account is banned');
    if (request.sessionToken) deleteSession(db, request.sessionToken);
    setSessionCookie(reply, createSession(db, user.id), opts.secureCookies);
    return { user: userView(user) };
  });

  app.post('/api/auth/guest', async (request, reply) => {
    const input = parse(guestSchema, request.body);
    checkClean('name', input.displayName);
    const current = request.user;
    if (current?.isGuest) {
      db.update(users).set({ displayName: input.displayName }).where(eq(users.id, current.id)).run();
      return { user: userView({ ...current, displayName: input.displayName }) };
    }
    if (request.sessionToken) deleteSession(db, request.sessionToken);
    const user = db
      .insert(users)
      .values({ username: `${GUEST_PREFIX}${randomBytes(5).toString('hex')}`, displayName: input.displayName, isGuest: true })
      .returning()
      .get();
    setSessionCookie(reply, createSession(db, user.id), opts.secureCookies);
    return reply.status(201).send({ user: userView(user) });
  });

  app.post('/api/auth/logout', async (request, reply) => {
    if (request.sessionToken) deleteSession(db, request.sessionToken);
    clearSessionCookie(reply);
    return { user: null };
  });
}
