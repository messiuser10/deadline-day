import { createHash, randomBytes } from 'node:crypto';
import { and, eq, gt, lt } from 'drizzle-orm';
import { compare, hash } from 'bcryptjs';
import type { UserView } from '@deadline-day/protocol';
import type { Db } from '../db/client';
import { sessions, users } from '../db/schema';

export type UserRow = typeof users.$inferSelect;

export const SESSION_COOKIE = 'dd_session';
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export const hashPassword = (password: string, cost: number) => hash(password, cost);
export const verifyPassword = (password: string, passwordHash: string) => compare(password, passwordHash);


/** Session ids in the database are SHA-256 hashes of the cookie token, so a database leak gives no sessions. */
const tokenId = (token: string) => createHash('sha256').update(token).digest('hex');

export function createSession(db: Db, userId: string, now = Date.now()): string {
  const token = randomBytes(32).toString('base64url');
  db.insert(sessions).values({ id: tokenId(token), userId, expiresAt: now + SESSION_TTL_MS, createdAt: now }).run();
  db.delete(sessions).where(lt(sessions.expiresAt, now)).run();
  return token;
}

/** The signed-in user for a session token, or null (unknown, expired or banned). Extends sessions past half-life. */
export function findSessionUser(db: Db, token: string, now = Date.now()): UserRow | null {
  const id = tokenId(token);
  const row = db
    .select({ user: users, expiresAt: sessions.expiresAt })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.id, id), gt(sessions.expiresAt, now)))
    .get();
  if (!row || row.user.banned) return null;
  if (row.expiresAt - now < SESSION_TTL_MS / 2) {
    db.update(sessions).set({ expiresAt: now + SESSION_TTL_MS }).where(eq(sessions.id, id)).run();
  }
  return row.user;
}

export function deleteSession(db: Db, token: string): void {
  db.delete(sessions).where(eq(sessions.id, tokenId(token))).run();
}

export function deleteUserSessions(db: Db, userId: string): void {
  db.delete(sessions).where(eq(sessions.userId, userId)).run();
}

export function userView(u: UserRow): UserView {
  return { id: u.id, username: u.username, displayName: u.displayName, role: u.role, isGuest: u.isGuest };
}
