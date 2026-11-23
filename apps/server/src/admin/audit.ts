/**
 * Admin: the audit log (section 11, tab 8). Filter by actor, action, game and date; export as CSV.
 */
import { and, desc, eq, gte, inArray, like, lt, lte, or, type SQL } from 'drizzle-orm';
import type { AuditEntryView, AuditPage } from '@deadline-day/protocol';
import type { Db } from '../db/client';
import { auditLog, games, users } from '../db/schema';
import { toCsv } from '../games/results';

export interface AuditFilter {
  actor?: string;
  action?: string;
  game?: string;
  from?: number;
  to?: number;
  before?: number;
  limit: number;
}

export const AUDIT_EXPORT_MAX = 10_000;

export class AuditAdmin {
  constructor(private readonly db: Db) {}

  private where(f: AuditFilter): SQL | undefined {
    const where: SQL[] = [];
    if (f.actor) {
      const ids = this.db
        .select({ id: users.id })
        .from(users)
        .where(or(like(users.username, `%${f.actor.toLowerCase()}%`), like(users.displayName, `%${f.actor}%`)))
        .all()
        .map((u) => u.id);
      where.push(ids.length ? inArray(auditLog.actorUserId, ids) : eq(auditLog.id, -1));
    }
    if (f.action) where.push(like(auditLog.action, `${f.action}%`));
    if (f.game) {
      // A deleted game's entries keep its code in target, so match that too.
      const ids = this.db.select({ id: games.id }).from(games).where(eq(games.joinCode, f.game)).all().map((g) => g.id);
      where.push(ids.length ? or(inArray(auditLog.gameId, ids), eq(auditLog.target, f.game))! : eq(auditLog.target, f.game));
    }
    if (f.from !== undefined) where.push(gte(auditLog.createdAt, f.from));
    if (f.to !== undefined) where.push(lte(auditLog.createdAt, f.to));
    if (f.before !== undefined) where.push(lt(auditLog.id, f.before));
    return where.length ? and(...where) : undefined;
  }

  private views(rows: (typeof auditLog.$inferSelect)[]): AuditEntryView[] {
    const actorIds = [...new Set(rows.map((r) => r.actorUserId).filter((id): id is string => !!id))];
    const gameIds = [...new Set(rows.map((r) => r.gameId).filter((id): id is string => !!id))];
    const actors = new Map(
      actorIds.length
        ? this.db.select({ id: users.id, username: users.username, displayName: users.displayName }).from(users).where(inArray(users.id, actorIds)).all().map((u) => [u.id, u])
        : [],
    );
    const codes = new Map(
      gameIds.length ? this.db.select({ id: games.id, code: games.joinCode }).from(games).where(inArray(games.id, gameIds)).all().map((g) => [g.id, g.code]) : [],
    );
    return rows.map((r) => ({
      id: r.id,
      at: r.createdAt,
      actor: r.actorUserId ? (actors.get(r.actorUserId) ?? null) : null,
      action: r.action,
      target: r.target,
      gameCode: r.gameId ? (codes.get(r.gameId) ?? null) : null,
      details: r.details ?? null,
    }));
  }

  page(f: AuditFilter): AuditPage {
    const rows = this.db.select().from(auditLog).where(this.where(f)).orderBy(desc(auditLog.id)).limit(f.limit + 1).all();
    const page = rows.slice(0, f.limit);
    return { entries: this.views(page), nextBefore: rows.length > f.limit ? page.at(-1)!.id : null };
  }

  recent(n: number): AuditEntryView[] {
    return this.views(this.db.select().from(auditLog).orderBy(desc(auditLog.id)).limit(n).all());
  }

  /** The newest AUDIT_EXPORT_MAX matching entries, oldest first. Cells are defused against spreadsheet formulas. */
  csv(f: Omit<AuditFilter, 'limit' | 'before'>): string {
    const rows = this.db.select().from(auditLog).where(this.where({ ...f, limit: AUDIT_EXPORT_MAX })).orderBy(desc(auditLog.id)).limit(AUDIT_EXPORT_MAX).all();
    const views = this.views(rows).reverse();
    return toCsv([
      ['id', 'at', 'actor', 'action', 'target', 'game', 'details'],
      ...views.map((v) => [v.id, new Date(v.at).toISOString(), v.actor?.username ?? '', v.action, v.target ?? '', v.gameCode ?? '', v.details ? JSON.stringify(v.details) : '']),
    ]);
  }
}
