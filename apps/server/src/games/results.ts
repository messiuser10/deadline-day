/**
 * Results (section 10, Season Complete). For any stored season: awards, auction grades with Steal / Fair /
 * Overpay tags, player stats, team reports and head to head. Season 1 is the official result: the first
 * time a game reaches `completed` its auction teams' finishes and grades are published to game_results,
 * which feeds profiles, the leaderboard, the Hall of Fame and the record book. The host can export a
 * season as JSON or CSV.
 */
import { asc, eq, inArray, isNull, and } from 'drizzle-orm';
import {
  auctionGrade,
  computeAwards,
  headToHead,
  purchaseTag,
  teamReport,
  withSimDefaults,
  type PlayerSeasonStat,
  type Position,
  type Purchase,
  type SimParams,
} from '@deadline-day/engine';
import type {
  AuctionGradeView,
  ExportQuery,
  HeadToHeadView,
  PlayerStatView,
  PurchaseView,
  ResultsView,
  SeasonAwardsView,
  SeasonView,
  TeamReportView,
} from '@deadline-day/protocol';
import { audit } from '../audit';
import type { UserRow } from '../auth/sessions';
import type { Db } from '../db/client';
import { fixtures, gamePool, gameResults, games, lineupSlots, playerSeasonStats, seasonTeams, seasons } from '../db/schema';
import { lineupOf, type SeasonRow } from './season';
import type { GameRow, GameService } from './service';

const RESULTS_CACHE = 40;

interface SnapshotFields {
  name: string;
  position: string;
  overall: number;
  marketValueM: number;
}

export interface ExportFile {
  filename: string;
  contentType: string;
  body: string;
}

export class ResultsService {
  private readonly cache = new Map<string, ResultsView>();

  constructor(
    private readonly games: GameService,
    private readonly db: Db,
  ) {}

  // -------------------------------------------------------------------------
  // Results view

  results(code: string, number?: number): ResultsView {
    const game = this.games.findGame(code);
    const view = this.games.season.view(code, number);
    const rows = this.games.season.seasonRows(game.id);
    const row = rows.find((r) => r.seasonNumber === view.number)!;
    // Head to head counts every season of the game, so a new season changes the view.
    const key = `${row.id}:${rows.length}`;
    const cached = this.cache.get(key);
    if (cached) return cached;
    const results = this.build(game, row, view, rows);
    this.cache.set(key, results);
    if (this.cache.size > RESULTS_CACHE) this.cache.delete(this.cache.keys().next().value!);
    return results;
  }

  private build(game: GameRow, row: SeasonRow, view: SeasonView, allRows: SeasonRow[]): ResultsView {
    const purchases = this.purchases(game, view);
    const awards = this.awards(row, view, purchases);
    const players = this.players(row, view);
    const params = withSimDefaults(row.parametersSnapshot as Partial<SimParams>);
    return {
      number: row.seasonNumber,
      official: row.seasonNumber === 1,
      awards,
      grades: this.grades(game, view, purchases),
      players,
      reports: this.reports(view, players, params),
      headToHead: this.headToHead(view, allRows),
    };
  }

  /** What each auction team paid for its XI, keyed by season team id. Prices and market values are from the auction itself. */
  private purchases(game: GameRow, view: SeasonView): Map<string, PurchaseView[]> {
    const auctionTeams = view.teams.filter((t) => t.kind !== 'ai' && t.participantId);
    const out = new Map<string, PurchaseView[]>(auctionTeams.map((t) => [t.id, []]));
    if (!auctionTeams.length) return out;
    const teamOf = new Map(auctionTeams.map((t) => [t.participantId!, t]));
    const snapshots = new Map(
      this.db
        .select({ id: gamePool.poolPlayerId, snapshot: gamePool.snapshot })
        .from(gamePool)
        .where(eq(gamePool.gameId, game.id))
        .all()
        .map((r) => [r.id, r.snapshot as unknown as SnapshotFields]),
    );
    const slots = this.db
      .select()
      .from(lineupSlots)
      .where(inArray(lineupSlots.participantId, [...teamOf.keys()]))
      .all();
    for (const s of slots) {
      if (!s.poolPlayerId) continue;
      const team = teamOf.get(s.participantId)!;
      const snap = snapshots.get(s.poolPlayerId);
      if (!snap) continue;
      const ref = `pool:${s.poolPlayerId}`;
      const inXi = team.players.find((p) => p.ref === ref);
      const priceM = s.priceM ?? 0;
      out.get(team.id)!.push({
        ref,
        name: snap.name,
        position: snap.position as Position,
        slotKey: inXi?.slotKey ?? s.slotKey,
        overall: snap.overall,
        priceM,
        marketValueM: snap.marketValueM,
        tag: purchaseTag(priceM, snap.marketValueM),
        autoFilled: s.autoFilled,
      });
    }
    for (const list of out.values()) list.sort((a, b) => b.priceM - a.priceM || b.overall - a.overall || a.ref.localeCompare(b.ref));
    return out;
  }

  /** Awards from the stored stats, saved on the season row the first time. */
  private awards(row: SeasonRow, view: SeasonView, purchases: Map<string, PurchaseView[]>): SeasonAwardsView {
    if (row.awards) return row.awards as unknown as SeasonAwardsView;
    const info = new Map<string, Pick<PlayerSeasonStat, 'name' | 'slotType' | 'positions' | 'baseOverall'>>();
    for (const t of this.games.season.teamsOf(row.id)) {
      for (const p of lineupOf(t).players) info.set(p.ref, { name: p.name, slotType: p.slotType, positions: p.positions, baseOverall: p.baseOverall });
    }
    const stats: PlayerSeasonStat[] = this.statRows(row.id).flatMap((s) => {
      const p = info.get(s.playerRef);
      if (!p) return []; // injury cover: never eligible for awards
      return [
        {
          ref: s.playerRef,
          teamId: s.seasonTeamId,
          ...p,
          appearances: s.appearances,
          goals: s.goals,
          assists: s.assists,
          cleanSheets: s.cleanSheets,
          yellows: s.yellows,
          reds: s.reds,
          ratingSum: s.ratingSum,
          avgRating: s.avgRating,
        },
      ];
    });
    const bought: Purchase[] = [...purchases].flatMap(([teamId, list]) => list.map((p) => ({ ref: p.ref, teamId, priceM: p.priceM, marketValueM: p.marketValueM })));
    const awards: SeasonAwardsView = computeAwards({ championId: view.championId, playerStats: stats }, bought, this.games.appSettings().price_curve);
    this.db
      .update(seasons)
      .set({ awards: awards as unknown as Record<string, unknown> })
      .where(eq(seasons.id, row.id))
      .run();
    return awards;
  }

  private statRows(seasonId: string) {
    return this.db.select().from(playerSeasonStats).where(eq(playerSeasonStats.seasonId, seasonId)).all();
  }

  private players(row: SeasonRow, view: SeasonView): PlayerStatView[] {
    const names = new Map<string, { name: string; slotKey: string | null }>();
    for (const t of view.teams) for (const p of t.players) names.set(p.ref, { name: p.name, slotKey: p.slotKey });
    for (const e of view.extras) if (!names.has(e.ref)) names.set(e.ref, { name: e.name, slotKey: null });
    return this.statRows(row.id)
      .map((s) => ({
        ref: s.playerRef,
        name: names.get(s.playerRef)?.name ?? 'Unknown player',
        teamId: s.seasonTeamId,
        slotKey: names.get(s.playerRef)?.slotKey ?? null,
        appearances: s.appearances,
        goals: s.goals,
        assists: s.assists,
        cleanSheets: s.cleanSheets,
        yellows: s.yellows,
        reds: s.reds,
        avgRating: s.avgRating,
      }))
      .sort((a, b) => b.goals - a.goals || b.avgRating - a.avgRating || a.ref.localeCompare(b.ref));
  }

  private grades(game: GameRow, view: SeasonView, purchases: Map<string, PurchaseView[]>): AuctionGradeView[] {
    const settings = this.games.gameSettings(game);
    const finalRow = new Map((view.standings.at(-1) ?? []).map((r) => [r.teamId, r]));
    const budgetLeft = new Map(this.games.teams(game.id).map((p) => [p.id, p.budgetRemainingM]));
    return view.teams
      .filter((t) => t.kind !== 'ai' && t.participantId)
      .map((t) => {
        const list = purchases.get(t.id) ?? [];
        const spentM = list.reduce((s, p) => s + p.priceM, 0);
        const finalPosition = finalRow.get(t.id)?.position ?? view.teams.length;
        const g = auctionGrade({
          preRank: t.rank,
          finalPosition,
          startingBudgetM: settings.budgetM,
          xiMarketValueM: list.reduce((s, p) => s + p.marketValueM, 0),
          leagueSize: view.teams.length,
        });
        const won = list.filter((p) => !p.autoFilled && p.marketValueM > 0);
        const ratio = (p: PurchaseView) => p.priceM / p.marketValueM;
        return {
          teamId: t.id,
          participantId: t.participantId!,
          grade: g.grade,
          score: g.score,
          strengthScore: round2(g.strengthScore),
          finishScore: round2(g.finishScore),
          valueScore: round2(g.valueScore),
          preRank: t.rank,
          finalPosition,
          budgetM: settings.budgetM,
          spentM,
          leftM: budgetLeft.get(t.participantId!) ?? settings.budgetM - spentM,
          purchases: list,
          mostExpensive: list[0] ?? null,
          bestBargain: won.length ? won.reduce((best, p) => (ratio(p) < ratio(best) || (ratio(p) === ratio(best) && p.overall > best.overall) ? p : best)) : null,
        };
      })
      .sort((a, b) => a.finalPosition - b.finalPosition);
  }

  private reports(view: SeasonView, players: PlayerStatView[], params: SimParams): TeamReportView[] {
    return view.teams.map((t) => {
      const r = teamReport(t.id, view.fixtures, view.standings, params.points);
      const scorer = players
        .filter((p) => p.teamId === t.id && p.goals > 0)
        .sort((a, b) => b.goals - a.goals || b.avgRating - a.avgRating || a.ref.localeCompare(b.ref))[0];
      return {
        ...r,
        biggestWin: r.biggestWin ? { ...r.biggestWin, fixtureId: Number(r.biggestWin.fixtureId) } : null,
        topScorer: scorer ? { ref: scorer.ref, name: scorer.name, goals: scorer.goals } : null,
      };
    });
  }

  /** Every pair of auction teams: this season's two meetings and the record over all of the game's seasons. */
  private headToHead(view: SeasonView, allRows: SeasonRow[]): HeadToHeadView[] {
    const auction = view.teams.filter((t) => t.kind !== 'ai' && t.participantId);
    if (auction.length < 2) return [];
    const seasonIds = allRows.map((r) => r.id);
    const participantOf = new Map(
      this.db
        .select({ id: seasonTeams.id, participantId: seasonTeams.participantId })
        .from(seasonTeams)
        .where(inArray(seasonTeams.seasonId, seasonIds))
        .all()
        .filter((t) => t.participantId)
        .map((t) => [t.id, t.participantId!]),
    );
    const meetings = this.db
      .select()
      .from(fixtures)
      .where(inArray(fixtures.seasonId, seasonIds))
      .orderBy(asc(fixtures.id))
      .all()
      .filter((f) => participantOf.has(f.homeTeamId) && participantOf.has(f.awayTeamId))
      .map((f) => ({
        id: f.id,
        matchday: f.matchday,
        homeId: participantOf.get(f.homeTeamId)!,
        awayId: participantOf.get(f.awayTeamId)!,
        homeGoals: f.homeGoals ?? 0,
        awayGoals: f.awayGoals ?? 0,
      }));
    const out: HeadToHeadView[] = [];
    for (let i = 0; i < auction.length; i++) {
      for (let j = i + 1; j < auction.length; j++) {
        const a = auction[i]!;
        const b = auction[j]!;
        const rec = headToHead(a.participantId!, b.participantId!, meetings);
        out.push({
          aId: a.id,
          bId: b.id,
          legs: view.fixtures
            .filter((f) => (f.homeId === a.id && f.awayId === b.id) || (f.homeId === b.id && f.awayId === a.id))
            .map((f) => ({ fixtureId: f.id, matchday: f.matchday, homeId: f.homeId, awayId: f.awayId, homeGoals: f.homeGoals, awayGoals: f.awayGoals })),
          allTime: { seasons: allRows.length, played: rec.played, aWins: rec.aWins, draws: rec.draws, bWins: rec.bWins, aGoals: rec.aGoals, bGoals: rec.bGoals },
        });
      }
    }
    return out;
  }

  // -------------------------------------------------------------------------
  // Official results

  /**
   * Publish season 1 as the game's official result, once. Called when the game first reaches `completed`
   * (end of synchronized playback, or straight away in own-pace mode) and at boot for older games.
   */
  /** Drop cached results of a game's seasons. */
  forget(gameId: string): void {
    const ids = new Set(this.games.season.seasonRows(gameId).map((r) => r.id));
    for (const key of [...this.cache.keys()]) if (ids.has(key.split(':')[0]!)) this.cache.delete(key);
  }

  publish(gameId: string): void {
    const game = this.games.gameById(gameId);
    if (game.completedAt) return;
    if (game.isTest) {
      // Admin Test Auction games are all bots and never count for history.
      this.db.update(games).set({ completedAt: Date.now() }).where(eq(games.id, gameId)).run();
      return;
    }
    const first = this.games.season.seasonRows(gameId).find((r) => r.seasonNumber === 1);
    if (!first) return;
    const view = this.games.season.view(game.joinCode, 1);
    const results = this.results(game.joinCode, 1);
    const table = new Map((view.standings.at(-1) ?? []).map((r) => [r.teamId, r]));
    const teamById = new Map(view.teams.map((t) => [t.id, t]));
    const people = new Map(this.games.teams(gameId).map((p) => [p.id, p]));
    const now = Date.now();
    this.db.transaction((tx) => {
      for (const g of results.grades) {
        const t = teamById.get(g.teamId)!;
        const r = table.get(g.teamId);
        const p = people.get(g.participantId);
        if (!r) continue;
        tx.insert(gameResults)
          .values({
            gameId,
            seasonId: first.id,
            seasonTeamId: g.teamId,
            participantId: g.participantId,
            userId: p?.isBot ? null : (p?.userId ?? null),
            isBot: p?.isBot ?? false,
            teamName: t.name,
            color: t.color,
            monogram: t.monogram,
            position: r.position,
            points: r.points,
            won: r.won,
            drawn: r.drawn,
            lost: r.lost,
            goalsFor: r.goalsFor,
            goalsAgainst: r.goalsAgainst,
            goalDifference: r.goalDifference,
            preRank: g.preRank,
            grade: g.grade,
            gradeScore: g.score,
            spentM: g.spentM,
            budgetM: g.budgetM,
            champion: r.position === 1,
          })
          .onConflictDoNothing()
          .run();
      }
      tx.update(games).set({ completedAt: now }).where(eq(games.id, gameId)).run();
      audit(tx, { actorUserId: null, action: 'game.results.publish', target: game.joinCode, gameId, details: { season: 1, teams: results.grades.length } });
    });
  }

  /** Completed games from before results were published (or a crash in between). */
  backfill(): void {
    const pending = this.db
      .select({ id: games.id })
      .from(games)
      .where(and(eq(games.status, 'completed'), isNull(games.completedAt)))
      .all();
    for (const g of pending) {
      try {
        this.publish(g.id);
      } catch (err) {
        console.error(`[results ${g.id}]`, err);
      }
    }
  }

  // -------------------------------------------------------------------------
  // Export (host or admin)

  export(user: UserRow, code: string, q: ExportQuery): ExportFile {
    const game = this.games.findGame(code);
    this.games.requireHost(game, user);
    const view = this.games.season.view(code, q.number);
    const results = this.results(code, view.number);
    audit(this.db, { actorUserId: user.id, action: 'game.export', target: game.joinCode, gameId: game.id, details: { season: view.number, format: q.format, table: q.table } });
    const base = `${slug(game.name)}-${game.joinCode.toLowerCase()}-season-${view.number}`;
    if (q.format === 'json') {
      return {
        filename: `${base}.json`,
        contentType: 'application/json; charset=utf-8',
        body: JSON.stringify({ game: { code: game.joinCode, name: game.name, seed: game.seed, settings: this.games.gameSettings(game) }, season: view, results }, null, 2),
      };
    }
    const team = new Map(view.teams.map((t) => [t.id, t]));
    const name = (id: string) => team.get(id)?.name ?? '';
    let rows: (string | number)[][];
    switch (q.table) {
      case 'table':
        rows = [
          ['Pos', 'Team', 'Kind', 'Manager', 'P', 'W', 'D', 'L', 'GF', 'GA', 'GD', 'Pts'],
          ...(view.standings.at(-1) ?? []).map((r) => {
            const t = team.get(r.teamId);
            return [r.position, t?.name ?? '', t?.kind ?? '', t?.managerName ?? '', r.played, r.won, r.drawn, r.lost, r.goalsFor, r.goalsAgainst, r.goalDifference, r.points];
          }),
        ];
        break;
      case 'fixtures': {
        const playerName = new Map(results.players.map((p) => [p.ref, p.name]));
        rows = [
          ['Matchday', 'Home', 'Away', 'Home goals', 'Away goals', 'Scorers'],
          ...view.fixtures.map((f) => [
            f.matchday,
            name(f.homeId),
            name(f.awayId),
            f.homeGoals,
            f.awayGoals,
            f.events
              .filter((e) => e.type === 'goal')
              .map((e) => `${playerName.get(e.playerRef) ?? '?'} ${e.minute}'`)
              .join('; '),
          ]),
        ];
        break;
      }
      case 'players':
        rows = [
          ['Team', 'Player', 'Slot', 'Apps', 'Goals', 'Assists', 'Clean sheets', 'Yellows', 'Reds', 'Avg rating'],
          ...results.players.map((p) => [name(p.teamId), p.name, p.slotKey ?? '', p.appearances, p.goals, p.assists, p.cleanSheets, p.yellows, p.reds, p.avgRating]),
        ];
        break;
      case 'grades':
        rows = [
          ['Team', 'Manager', 'Grade', 'Score', 'Pre-season rank', 'Final position', 'Spent $M', 'Left $M', 'Player', 'Price $M', 'Market value $M', 'Tag'],
          ...results.grades.flatMap((g) =>
            g.purchases.map((p) => [name(g.teamId), team.get(g.teamId)?.managerName ?? '', g.grade, g.score, g.preRank, g.finalPosition, g.spentM, g.leftM, p.name, p.priceM, p.marketValueM, p.autoFilled ? `${p.tag} (auto-filled)` : p.tag]),
          ),
        ];
        break;
    }
    return { filename: `${base}-${q.table}.csv`, contentType: 'text/csv; charset=utf-8', body: toCsv(rows) };
  }
}

const round2 = (n: number) => Math.round(n * 100) / 100;

function slug(s: string): string {
  return (
    s
      .normalize('NFKD')
      .replace(/[^\w\s-]/g, '')
      .trim()
      .replace(/[\s_]+/g, '-')
      .toLowerCase()
      .slice(0, 40) || 'game'
  );
}

/** RFC 4180 CSV; cells starting with = + - @ are prefixed with ' so spreadsheets never run them as formulas. */
export function toCsv(rows: readonly (readonly (string | number)[])[]): string {
  const cell = (v: string | number) => {
    let s = String(v);
    if (typeof v === 'string' && /^[=+\-@]/.test(s)) s = `'${s}`;
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return rows.map((r) => r.map(cell).join(',')).join('\r\n') + '\r\n';
}
