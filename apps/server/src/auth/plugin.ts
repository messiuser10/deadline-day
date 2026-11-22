import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { forbidden, unauthorized } from '../errors';
import type { Db } from '../db/client';
import { SESSION_COOKIE, SESSION_TTL_MS, findSessionUser, type UserRow } from './sessions';

declare module 'fastify' {
  interface FastifyRequest {
    user: UserRow | null;
    sessionToken: string | null;
  }
}

/** Resolve the signed session cookie into request.user on every request. */
export function installAuth(app: FastifyInstance, db: Db): void {
  app.decorateRequest('user', null);
  app.decorateRequest('sessionToken', null);
  app.addHook('onRequest', async (request) => {
    request.user = null;
    request.sessionToken = null;
    const raw = request.cookies[SESSION_COOKIE];
    if (!raw) return;
    const unsigned = request.unsignCookie(raw);
    if (!unsigned.valid || !unsigned.value) return;
    const user = findSessionUser(db, unsigned.value);
    if (!user) return;
    request.user = user;
    request.sessionToken = unsigned.value;
  });
}

/** Resolve a raw Cookie header (Socket.IO handshake) the same way. */
export function userFromCookieHeader(app: FastifyInstance, db: Db, header: string | undefined): UserRow | null {
  if (!header) return null;
  const raw = app.parseCookie(header)[SESSION_COOKIE];
  if (!raw) return null;
  const unsigned = app.unsignCookie(raw);
  return unsigned.valid && unsigned.value ? findSessionUser(db, unsigned.value) : null;
}

export function setSessionCookie(reply: FastifyReply, token: string, secure: boolean): void {
  void reply.setCookie(SESSION_COOKIE, token, {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure,
    signed: true,
    maxAge: SESSION_TTL_MS / 1000,
  });
}

export function clearSessionCookie(reply: FastifyReply): void {
  void reply.clearCookie(SESSION_COOKIE, { path: '/' });
}

export function requireUser(request: FastifyRequest): UserRow {
  if (!request.user) throw unauthorized();
  return request.user;
}

export function requireAdmin(request: FastifyRequest): UserRow {
  const user = requireUser(request);
  if (user.role !== 'admin') throw forbidden('ADMIN_ONLY', 'Only an admin can do that');
  return user;
}
