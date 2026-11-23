/**
 * Admin: users (section 11, tab 7). Promote or demote, ban or unban, see a user's games and delete a
 * user's data. Deleting keeps finished games intact: their teams stay, unlinked from the account.
 */
import { and, count, desc, eq, inArray, like, or, type SQL } from 'drizzle-orm';
import type { z } from 'zod';
import type { adminUserPatchSchema, AdminUserDetail, AdminUserGame, AdminUserRow, GameStatus } from '@deadline-day/protocol';
import { audit } from '../audit';
import { deleteUserSessions, type UserRow } from '../auth/sessions';
import type { Db } from '../db/client';
import { chatMessages, games, participants, users } from '../db/schema';
import { badRequest, conflict, notFound } from '../errors';

const ACTIVE: GameStatus[] = ['lobby', 'auctioning', 'paused', 'auction_complete', 'simulating'];

export type UsersFilter = 'all' | 'registered' | 'guests' | 'admins' | 'banned';

export class UsersAdmin {
  constructor(private readonly db: Db) {}

  private rows(list: (typeof users.$inferSelect)[]): AdminUserRow[] {
    const counts = new Map(
      list.length
        ? this.db
            .select({ id: participants.userId, n: count() })
            .from(participants)
            .where(inArray(participants.userId, list.map((u) => u.id)))
            .groupBy(participants.userId)
            .all()
            .map((r) => [r.id, r.n])
        : [],
    );
    return list.map((u) => ({
      id: u.id,
      username: u.username,
      displayName: u.displayName,
      role: u.role,
      isGuest: u.isGuest,
      banned: u.banned,
      createdAt: u.createdAt,
      games: counts.get(u.id) ?? 0,
    }));
  }

  private find(id: string) {
    const u = this.db.select().from(users).where(eq(users.id, id)).get();
    if (!u) throw notFound('USER_NOT_FOUND', 'No such user');
    return u;
  }

  list(q: string | undefined, filter: UsersFilter): { users: AdminUserRow[] } {
    const where: SQL[] = [];
    if (q) where.push(or(like(users.username, `%${q.toLowerCase()}%`), like(users.displayName, `%${q}%`))!);
    if (filter === 'registered') where.push(eq(users.isGuest, false));
    if (filter === 'guests') where.push(eq(users.isGuest, true));
    if (filter === 'admins') where.push(eq(users.role, 'admin'));
    if (filter === 'banned') where.push(eq(users.banned, true));
    const list = this.db
      .select()
      .from(users)
      .where(where.length ? and(...where) : undefined)
      .orderBy(desc(users.createdAt))
      .limit(200)
      .all();
    return { users: this.rows(list) };
  }

  detail(id: string): AdminUserDetail {
    const u = this.find(id);
    const played = this.db
      .select({ code: games.joinCode, name: games.name, status: games.status, teamName: participants.teamName, hostUserId: games.hostUserId, createdAt: games.createdAt })
      .from(participants)
      .innerJoin(games, eq(games.id, participants.gameId))
      .where(eq(participants.userId, id))
      .all();
    const seen = new Set(played.map((g) => g.code));
    const hostedOnly = this.db
      .select({ code: games.joinCode, name: games.name, status: games.status, createdAt: games.createdAt })
      .from(games)
      .where(eq(games.hostUserId, id))
      .all()
      .filter((g) => !seen.has(g.code));
    const list: AdminUserGame[] = [
      ...played.map((g) => ({ code: g.code, name: g.name, status: g.status, teamName: g.teamName, isHost: g.hostUserId === id, createdAt: g.createdAt })),
      ...hostedOnly.map((g) => ({ ...g, teamName: null, isHost: true })),
    ].sort((a, b) => b.createdAt - a.createdAt);
    return { user: this.rows([u])[0]!, games: list };
  }

  patch(admin: UserRow, id: string, input: z.infer<typeof adminUserPatchSchema>): AdminUserDetail {
    const target = this.find(id);
    if (target.id === admin.id && (input.role === 'user' || input.banned)) {
      throw badRequest('SELF_DEMOTE', 'You cannot demote or ban yourself');
    }
    if (input.role === 'admin' && target.isGuest) throw badRequest('GUEST_ADMIN', 'A guest cannot be an admin');
    const changes = { ...(input.role ? { role: input.role } : {}), ...(input.banned === undefined ? {} : { banned: input.banned }) };
    if (Object.keys(changes).length) {
      this.db.update(users).set(changes).where(eq(users.id, id)).run();
      if (input.banned) deleteUserSessions(this.db, id);
      const from = { ...(input.role ? { role: target.role } : {}), ...(input.banned === undefined ? {} : { banned: target.banned }) };
      audit(this.db, { actorUserId: admin.id, action: 'admin.user.update', target: id, details: { username: target.username, from, to: changes } });
    }
    return this.detail(id);
  }

  /**
   * Delete a user's account and personal data: sessions and chat messages go, hosted games pass to the
   * acting admin, and finished teams and results stay with the account link cleared. Refused for
   * yourself and for anyone still in an unfinished game.
   */
  remove(admin: UserRow, id: string, confirm: string): void {
    const target = this.find(id);
    if (target.id === admin.id) throw badRequest('SELF_DELETE', 'You cannot delete your own account here');
    if (confirm !== target.username) throw badRequest('CONFIRM_MISMATCH', `Type ${target.username} to confirm`);
    const active = this.db
      .select({ code: games.joinCode })
      .from(participants)
      .innerJoin(games, eq(games.id, participants.gameId))
      .where(and(eq(participants.userId, id), inArray(games.status, ACTIVE)))
      .all();
    if (active.length) {
      throw conflict('USER_IN_GAME', `${target.displayName} is still in game ${active.map((g) => g.code).join(', ')}; remove them or replace them with a bot first`);
    }
    const summary = this.db.transaction((tx) => {
      const hosted = tx.update(games).set({ hostUserId: admin.id }).where(eq(games.hostUserId, id)).run().changes;
      const chats = tx.delete(chatMessages).where(eq(chatMessages.userId, id)).run().changes;
      tx.delete(users).where(eq(users.id, id)).run();
      return { hosted, chats };
    });
    audit(this.db, {
      actorUserId: admin.id,
      action: 'admin.user.delete',
      target: id,
      details: { username: target.username, displayName: target.displayName, isGuest: target.isGuest, hostedGamesReassigned: summary.hosted, chatMessagesDeleted: summary.chats },
    });
  }
}
