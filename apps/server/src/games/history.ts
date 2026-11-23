/**
 * History (section 10): profiles, the Hall of Fame, the global leaderboard and the record book, all built
 * from the official results in game_results (season 1 of each completed game). Every completed game counts,
 * but a private game's code (the link to it) is only shown to the people who played in it and to admins.
 */
import { and, desc, eq, inArray, like, lt } from 'drizzle-orm';
import { GRADES, type Grade } from '@deadline-day/engine';
import type {
  HallOfFameEntry,
  HallOfFameView,
  LeaderboardRow,
  LeaderboardView,
  ProfileGameView,
  ProfileView,
  RecordBookView,
  RecordEntry,
  ResultTeamView,
  SeasonAwardsView,
  TrophyView,
} from '@deadline-day/protocol';
import type { UserRow } from '../auth/sessions';
import type { Db } from '../db/client';
import { gameResults, games, participants, playerSeasonStats, seasonTeams, seasons, standingRows, users } from '../db/schema';
import { notFound } from '../errors';
import { lineupOf } from './season';
import type { GameRow, GameService } from './service';

type ResultRow = typeof gameResults.$inferSelect;

const HALL_PAGE = 20;
const RECORDS = 5;
const LEADERBOARD = 100;

const round2 = (n: number) => Math.round(n * 100) / 100;
const gradeIndex = (g: string) => {
  const i = GRADES.indexOf(g as Grade);
  return i < 0 ? GRADES.length : i;
};
const bestGrade = (grades: string[]): Grade | null => (grades.length ? GRADES[Math.min(...grades.map(gradeIndex))] ?? null : null);

export class HistoryService {
  constructor(
    private readonly games: GameService,
    private readonly db: Db,
  ) {}

  // -------------------------------------------------------------------------
  // Shared lookups

  private gameRows(ids: string[]): Map<string, GameRow> {
    if (!ids.length) return new Map();
    return new Map(
      this.db
        .select()
        .from(games)
        .where(inArray(games.id, [...new Set(ids)]))
        .all()
        .map((g) => [g.id, g]),
    );
  }

  /** Join code for a game the viewer may open, else null (private game they were not in). */
  private codeFor(viewer: UserRow | null): (g: GameRow) => string | null {
    const played = new Set(
      viewer
        ? this.db
            .select({ gameId: participants.gameId })
            .from(participants)
            .where(eq(participants.userId, viewer.id))
            .all()
            .map((p) => p.gameId)
        : [],
    );
    return (g) => (this.games.gameSettings(g).visibility === 'public' || viewer?.role === 'admin' || played.has(g.id) ? g.joinCode : null);
  }

  /** Manager display names for result rows (bots read "Bot"). */
  private managers(rows: ResultRow[]): (r: ResultRow) => string | null {
    const ids = [...new Set(rows.flatMap((r) => (r.userId ? [r.userId] : [])))];
    const names = new Map(ids.length ? this.db.select({ id: users.id, name: users.displayName }).from(users).where(inArray(users.id, ids)).all().map((u) => [u.id, u.name]) : []);
    return (r) => (r.isBot ? 'Bot' : r.userId ? (names.get(r.userId) ?? null) : null);
  }

  private teamCounts(gameIds: string[]): Map<string, number> {
    const counts = new Map<string, number>();
    if (!gameIds.length) return counts;
    for (const r of this.db.select({ gameId: gameResults.gameId }).from(gameResults).where(inArray(gameResults.gameId, [...new Set(gameIds)])).all()) {
      counts.set(r.gameId, (counts.get(r.gameId) ?? 0) + 1);
    }
    return counts;
  }

  private awardsOf(seasonId: string, game: GameRow): SeasonAwardsView | null {
    const row = this.db.select({ awards: seasons.awards }).from(seasons).where(eq(seasons.id, seasonId)).get();
    if (row?.awards) return row.awards as unknown as SeasonAwardsView;
    try {
      return this.games.results.results(game.joinCode, 1).awards;
    } catch {
      return null;
    }
  }

  // -------------------------------------------------------------------------
  // Profiles

  profile(username: string, viewer: UserRow | null): ProfileView {
    const user = this.db.select().from(users).where(eq(users.username, username.toLowerCase())).get();
    if (!user) throw notFound('USER_NOT_FOUND', 'There is no player with that username');
    const rows = this.db.select().from(gameResults).where(eq(gameResults.userId, user.id)).orderBy(desc(gameResults.createdAt)).all();
    const gameById = this.gameRows(rows.map((r) => r.gameId));
    const counts = this.teamCounts(rows.map((r) => r.gameId));
    const code = this.codeFor(viewer);

    const trophies: TrophyView[] = [];
    for (const r of rows) {
      const g = gameById.get(r.gameId)!;
      const base = { teamName: r.teamName, gameCode: code(g), gameName: g.name, at: r.createdAt };
      if (r.champion) trophies.push({ kind: 'title', detail: `League champions with ${r.points} points`, ...base });
      const a = this.awardsOf(r.seasonId, g);
      if (!a) continue;
      const mine = (x: { teamId: string } | null): x is NonNullable<typeof x> => !!x && x.teamId === r.seasonTeamId;
      if (mine(a.goldenBoot)) trophies.push({ kind: 'golden_boot', detail: `Golden Boot: ${a.goldenBoot.name}, ${a.goldenBoot.value} goals`, ...base });
      if (mine(a.playmaker)) trophies.push({ kind: 'playmaker', detail: `Playmaker: ${a.playmaker.name}, ${a.playmaker.value} assists`, ...base });
      if (mine(a.goldenGlove)) trophies.push({ kind: 'golden_glove', detail: `Golden Glove: ${a.goldenGlove.name}, ${a.goldenGlove.value} clean sheets`, ...base });
      if (mine(a.playerOfTheSeason))
        trophies.push({ kind: 'player_of_the_season', detail: `Player of the Season: ${a.playerOfTheSeason.name}, ${a.playerOfTheSeason.value.toFixed(2)} average`, ...base });
      if (mine(a.bestBuy)) trophies.push({ kind: 'best_buy', detail: `Best Buy: ${a.bestBuy.name} for $${a.bestBuy.priceM}M`, ...base });
    }

    const list: ProfileGameView[] = rows.map((r) => {
      const g = gameById.get(r.gameId)!;
      return {
        gameCode: code(g),
        gameName: g.name,
        teamName: r.teamName,
        color: r.color,
        monogram: r.monogram,
        position: r.position,
        points: r.points,
        grade: r.grade as Grade,
        champion: r.champion,
        auctionTeams: counts.get(r.gameId) ?? 1,
        playedAt: r.createdAt,
      };
    });

    return {
      username: user.username,
      displayName: user.displayName,
      isGuest: user.isGuest,
      joinedAt: user.createdAt,
      stats: {
        games: rows.length,
        titles: rows.filter((r) => r.champion).length,
        topFour: rows.filter((r) => r.position <= 4).length,
        avgFinish: rows.length ? round2(rows.reduce((s, r) => s + r.position, 0) / rows.length) : null,
        bestGrade: bestGrade(rows.map((r) => r.grade)),
      },
      trophies,
      games: list,
    };
  }

  // -------------------------------------------------------------------------
  // Hall of Fame

  /** Completed games, newest first: the league champion and the best auction team of each. */
  hallOfFame(viewer: UserRow | null, before?: number): HallOfFameView {
    const code = this.codeFor(viewer);
    const page: HallOfFameEntry[] = [];
    let cursor = before;
    let more = true;
    // Private games the viewer was not in are skipped, so read in batches until the page is full.
    while (page.length < HALL_PAGE && more) {
      const batch = this.db
        .select()
        .from(games)
        .where(cursor ? and(eq(games.status, 'completed'), lt(games.completedAt, cursor)) : eq(games.status, 'completed'))
        .orderBy(desc(games.completedAt))
        .limit(HALL_PAGE * 3)
        .all()
        .filter((g) => g.completedAt !== null);
      more = batch.length === HALL_PAGE * 3;
      for (const g of batch) {
        cursor = g.completedAt!;
        if (code(g) === null) continue;
        const entry = this.hallEntry(g, code(g));
        if (entry) page.push(entry);
        if (page.length === HALL_PAGE) break;
      }
      if (!batch.length) more = false;
    }
    return { games: page, nextBefore: page.length === HALL_PAGE ? (cursor ?? null) : null };
  }

  private hallEntry(g: GameRow, gameCode: string | null): HallOfFameEntry | null {
    const rows = this.db.select().from(gameResults).where(eq(gameResults.gameId, g.id)).all();
    if (!rows.length) return null;
    const manager = this.managers(rows);
    const best = [...rows].sort((a, b) => a.position - b.position)[0]!;
    const season = this.db.select().from(seasons).where(eq(seasons.id, best.seasonId)).get();
    const champ = season?.championSeasonTeamId ? this.db.select().from(seasonTeams).where(eq(seasonTeams.id, season.championSeasonTeamId)).get() : undefined;
    const champRow = champ ? rows.find((r) => r.seasonTeamId === champ.id) : undefined;
    const champView: ResultTeamView & { points: number } = champ
      ? {
          name: champ.name,
          color: champ.primaryColor,
          monogram: lineupOf(champ).monogram,
          kind: champ.kind,
          managerName: champRow ? manager(champRow) : null,
          points: champRow?.points ?? this.championPoints(best.seasonId, champ.id),
        }
      : { name: best.teamName, color: best.color, monogram: best.monogram, kind: best.isBot ? 'bot' : 'human', managerName: manager(best), points: best.points };
    return {
      gameCode,
      gameName: g.name,
      playedAt: g.completedAt!,
      auctionTeams: rows.length,
      champion: champView,
      bestAuctionTeam: {
        name: best.teamName,
        color: best.color,
        monogram: best.monogram,
        kind: best.isBot ? 'bot' : 'human',
        managerName: manager(best),
        position: best.position,
        points: best.points,
        grade: best.grade as Grade,
      },
    };
  }

  /** Final points of a team (an AI champion has no result row). */
  private championPoints(seasonId: string, seasonTeamId: string): number {
    return (
      this.db
        .select({ points: standingRows.points })
        .from(standingRows)
        .where(and(eq(standingRows.seasonId, seasonId), eq(standingRows.seasonTeamId, seasonTeamId)))
        .orderBy(desc(standingRows.matchday))
        .limit(1)
        .get()?.points ?? 0
    );
  }

  // -------------------------------------------------------------------------
  // Leaderboard

  /** Registered players (not guests, not banned) by titles, then average finish, then games played. */
  leaderboard(): LeaderboardView {
    const rows = this.db
      .select({ r: gameResults, username: users.username, displayName: users.displayName })
      .from(gameResults)
      .innerJoin(users, eq(users.id, gameResults.userId))
      .where(and(eq(users.isGuest, false), eq(users.banned, false)))
      .all();
    const by = new Map<string, { username: string; displayName: string; rows: ResultRow[] }>();
    for (const x of rows) {
      const cur = by.get(x.r.userId!) ?? { username: x.username, displayName: x.displayName, rows: [] };
      cur.rows.push(x.r);
      by.set(x.r.userId!, cur);
    }
    const table = [...by.values()]
      .map((u) => ({
        username: u.username,
        displayName: u.displayName,
        games: u.rows.length,
        titles: u.rows.filter((r) => r.champion).length,
        topFour: u.rows.filter((r) => r.position <= 4).length,
        avgFinish: round2(u.rows.reduce((s, r) => s + r.position, 0) / u.rows.length),
        bestGrade: bestGrade(u.rows.map((r) => r.grade))!,
      }))
      .sort((a, b) => b.titles - a.titles || a.avgFinish - b.avgFinish || b.games - a.games || a.displayName.localeCompare(b.displayName));
    const out: LeaderboardRow[] = [];
    for (const [i, row] of table.slice(0, LEADERBOARD).entries()) {
      const prev = out[i - 1];
      const tied = prev && prev.titles === row.titles && prev.avgFinish === row.avgFinish && prev.games === row.games;
      out.push({ rank: tied ? prev.rank : i + 1, ...row });
    }
    return { rows: out };
  }

  // -------------------------------------------------------------------------
  // Record book

  records(viewer: UserRow | null): RecordBookView {
    const code = this.codeFor(viewer);
    const all = this.db.select().from(gameResults).all();
    const gameById = this.gameRows(all.map((r) => r.gameId));
    const manager = this.managers(all);
    const entry = (r: ResultRow, value: number, holder = r.teamName): RecordEntry => {
      const g = gameById.get(r.gameId)!;
      return { value, holder, teamName: r.teamName, color: r.color, monogram: r.monogram, managerName: manager(r), gameCode: code(g), gameName: g.name, at: r.createdAt };
    };
    const top = (score: (r: ResultRow) => number, tie: (r: ResultRow) => number) =>
      [...all]
        .sort((a, b) => score(b) - score(a) || tie(b) - tie(a) || a.createdAt - b.createdAt)
        .slice(0, RECORDS)
        .map((r) => entry(r, score(r)));

    // Most goals by a bought player: pool players in an auction team's official season.
    const byTeam = new Map(all.map((r) => [r.seasonTeamId, r]));
    const scorers = all.length
      ? this.db
          .select({ ref: playerSeasonStats.playerRef, goals: playerSeasonStats.goals, teamId: playerSeasonStats.seasonTeamId })
          .from(playerSeasonStats)
          .where(and(inArray(playerSeasonStats.seasonTeamId, [...byTeam.keys()]), like(playerSeasonStats.playerRef, 'pool:%')))
          .orderBy(desc(playerSeasonStats.goals))
          .limit(RECORDS * 4)
          .all()
      : [];
    const teamRows = new Map(
      scorers.length
        ? this.db
            .select()
            .from(seasonTeams)
            .where(inArray(seasonTeams.id, [...new Set(scorers.map((s) => s.teamId))]))
            .all()
            .map((t) => [t.id, t])
        : [],
    );
    const nameOf = (teamId: string, ref: string) => lineupOf(teamRows.get(teamId)!).players.find((p) => p.ref === ref)?.name ?? 'Unknown player';

    return {
      mostPoints: top(
        (r) => r.points,
        (r) => r.goalDifference,
      ),
      mostGoalsByBoughtPlayer: scorers
        .filter((s) => s.goals > 0)
        .sort((a, b) => b.goals - a.goals || byTeam.get(a.teamId)!.createdAt - byTeam.get(b.teamId)!.createdAt)
        .slice(0, RECORDS)
        .map((s) => entry(byTeam.get(s.teamId)!, s.goals, nameOf(s.teamId, s.ref))),
      bestGoalDifference: top(
        (r) => r.goalDifference,
        (r) => r.points,
      ),
    };
  }
}
