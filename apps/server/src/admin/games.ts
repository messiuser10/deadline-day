/**
 * Admin: every game (section 11, tab 4). Most game actions reuse the host endpoints, which already let
 * an admin act as host; this adds the list, a detail view and the admin-only actions.
 */
import { and, count, desc, eq, inArray, isNotNull, like, lt, or, sql, type SQL } from 'drizzle-orm';
import type { AdminGameDetail, AdminGameRow, AdminGamesPage, GameStatus } from '@deadline-day/protocol';
import type { UserRow } from '../auth/sessions';
import type { Db } from '../db/client';
import { games, lineupSlots, participants, seasons, users } from '../db/schema';
import { conflict } from '../errors';
import { normalizeOrder, type GameRow, type GameService } from '../games/service';

const ACTIVE: GameStatus[] = ['lobby', 'auctioning', 'paused', 'auction_complete', 'simulating'];

export interface GamesQuery {
  status?: GameStatus | 'active' | 'test';
  q?: string;
  before?: number;
  limit: number;
}

export class GamesAdmin {
  constructor(
    private readonly db: Db,
    private readonly games: GameService,
  ) {}

  private rows(list: GameRow[]): AdminGameRow[] {
    if (!list.length) return [];
    const ids = list.map((g) => g.id);
    const hosts = new Map(
      this.db
        .select({ id: users.id, username: users.username, displayName: users.displayName })
        .from(users)
        .where(inArray(users.id, [...new Set(list.map((g) => g.hostUserId))]))
        .all()
        .map((u) => [u.id, u]),
    );
    const teamCounts = new Map(
      this.db
        .select({ gameId: participants.gameId, n: count(), bots: sql<number>`sum(case when ${participants.isBot} then 1 else 0 end)` })
        .from(participants)
        .where(inArray(participants.gameId, ids))
        .groupBy(participants.gameId)
        .all()
        .map((r) => [r.gameId, { n: r.n, bots: Number(r.bots) }]),
    );
    const seasonCounts = new Map(
      this.db
        .select({ gameId: seasons.gameId, n: count() })
        .from(seasons)
        .where(inArray(seasons.gameId, ids))
        .groupBy(seasons.gameId)
        .all()
        .map((r) => [r.gameId, r.n]),
    );
    return list.map((g) => {
      const t = teamCounts.get(g.id) ?? { n: 0, bots: 0 };
      const settings = g.settings as { visibility?: 'private' | 'public' };
      return {
        id: g.id,
        code: g.joinCode,
        name: g.name,
        status: g.status,
        visibility: settings.visibility ?? 'private',
        isTest: g.isTest,
        host: hosts.get(g.hostUserId) ?? null,
        teams: t.n,
        humans: t.n - t.bots,
        bots: t.bots,
        seasons: seasonCounts.get(g.id) ?? 0,
        seed: g.seed,
        createdAt: g.createdAt,
        updatedAt: g.updatedAt,
      };
    });
  }

  list(q: GamesQuery): AdminGamesPage {
    const where: SQL[] = [];
    if (q.status === 'active') where.push(inArray(games.status, ACTIVE));
    else if (q.status === 'test') where.push(eq(games.isTest, true));
    else if (q.status) where.push(eq(games.status, q.status));
    if (q.q) where.push(or(like(games.name, `%${q.q}%`), like(games.joinCode, `%${q.q.toUpperCase()}%`))!);
    if (q.before) where.push(lt(games.createdAt, q.before));
    const list = this.db
      .select()
      .from(games)
      .where(where.length ? and(...where) : undefined)
      .orderBy(desc(games.createdAt))
      .limit(q.limit + 1)
      .all();
    const page = list.slice(0, q.limit);
    return { games: this.rows(page), nextBefore: list.length > q.limit ? page.at(-1)!.createdAt : null };
  }

  detail(code: string): AdminGameDetail {
    const game = this.games.findGame(code);
    const teams = this.games.teams(game.id);
    const managers = new Map(
      this.db
        .select({ id: users.id, displayName: users.displayName })
        .from(users)
        .where(inArray(users.id, teams.map((t) => t.userId).filter((id): id is string => !!id)))
        .all()
        .map((u) => [u.id, u.displayName]),
    );
    const bought = new Map(
      teams.length
        ? this.db
            .select({ id: lineupSlots.participantId, n: count() })
            .from(lineupSlots)
            .where(and(inArray(lineupSlots.participantId, teams.map((t) => t.id)), isNotNull(lineupSlots.poolPlayerId)))
            .groupBy(lineupSlots.participantId)
            .all()
            .map((r) => [r.id, r.n])
        : [],
    );
    const auction = ['auctioning', 'paused'].includes(game.status) ? this.games.auction.viewFor(game) : null;
    return {
      game: this.rows([game])[0]!,
      teams: teams.map((t) => ({
        id: t.id,
        teamName: t.teamName ?? 'Team',
        manager: t.isBot ? null : t.userId ? (managers.get(t.userId) ?? null) : null,
        isBot: t.isBot,
        control: t.isBot ? 'bot' : t.control,
        isConnected: t.isConnected,
        players: bought.get(t.id) ?? 0,
        budgetRemainingM: t.budgetRemainingM,
      })),
      order: normalizeOrder(game.nominationOrder, teams),
      onTheClock: auction && !auction.lot ? auction.nominatorId : null,
    };
  }

  /** Lobby: the host's order endpoint. Running auction: admin-only reorder that keeps the current turn. */
  async reorder(admin: UserRow, code: string, order: string[]): Promise<AdminGameDetail> {
    const game = this.games.findGame(code);
    if (game.status === 'lobby') this.games.setNominationOrder(admin, code, order);
    else if (game.status === 'auctioning' || game.status === 'paused') await this.games.auction.reorder(admin, code, order);
    else throw conflict('ORDER_LOCKED', 'The nomination order can only change in the lobby or during the auction');
    return this.detail(code);
  }
}
