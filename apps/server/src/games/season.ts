/**
 * Season (section 10). When the post-auction countdown ends, or the host starts it, the server simulates
 * the season once and saves every fixture, event, matchday table and player stat. Clients then play it
 * back. In synchronized mode the host drives one clock that every screen follows; the server only stores
 * that clock and marks the game completed when it reaches the final whistle. In own-pace mode every client
 * keeps its own clock. Run It Back adds another season with the same 20 teams and a new seed. Multi-season
 * runs and the Monte Carlo "Expected Strength" are computed on request and not stored.
 */
import { randomUUID } from 'node:crypto';
import { asc, desc, eq } from 'drizzle-orm';
import {
  createMonteCarlo,
  deriveSeed,
  findKeyMoments,
  overallStrength,
  rankLeague,
  simulateMultiSeason,
  simulateSeason,
  withSimDefaults,
  type FormationId,
  type LeaguePlayer,
  type LeagueTeam,
  type SeasonResult,
  type SimParams,
} from '@deadline-day/engine';
import {
  SEASON_MATCHDAYS,
  playbackEndsAt,
  playbackPos,
  reanchor,
  type ExpectedStrengthView,
  type FixtureView,
  type KeyMomentView,
  type LeagueTeamRow,
  type LeagueView,
  type MatchEventView,
  type MultiSeasonView,
  type PlaybackAction,
  type PlaybackClock,
  type PlaybackSpeed,
  type PlaybackView,
  type SeasonInfo,
  type SeasonPlayerView,
  type SeasonTeamView,
  type SeasonView,
  type StandingView,
} from '@deadline-day/protocol';
import { audit } from '../audit';
import type { UserRow } from '../auth/sessions';
import type { Db } from '../db/client';
import { fixtures, games, matchEvents, playerSeasonStats, seasonTeams, seasons, standingRows } from '../db/schema';
import { conflict, notFound } from '../errors';
import type { GameRow, GameService } from './service';
import type { Timers } from './timers';

/** Where a league team comes from, for colours and links. */
export interface TeamOrigin {
  participantId: string | null;
  clubId: string | null;
  color: string;
  secondaryColor: string;
  monogram: string;
}

/** The 20 league teams handed over by the auction (or rebuilt from a stored season). */
export interface GameLeague {
  teams: LeagueTeam[];
  /** By league team id (participant id or club id). */
  meta: Record<string, TeamOrigin>;
  params: SimParams;
}

type SeasonRow = typeof seasons.$inferSelect;
type SeasonTeamRow = typeof seasonTeams.$inferSelect;
type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

/** season_teams.lineup: the XI exactly as simulated, plus what the views need. */
interface StoredLineup {
  /** League team id used by the engine (participant id or club id); the same in every season of a game. */
  sourceId: string;
  /** Position in the engine's team list; fixtures depend on it, so a season can be reproduced exactly. */
  order: number;
  players: LeaguePlayer[];
  /** Injury cover who played but is not in the XI. */
  extras: { ref: string; name: string }[];
  monogram: string;
  strength: number;
  rank: number;
}

/** games.playback_state once the season exists (revealStartedAt is kept from the reveal). */
type StoredPlayback = PlaybackView & { revealStartedAt?: number };

export interface SeasonServiceOptions {
  db: Db;
  timers: Timers;
  /** Seasons per Monte Carlo run (default 1,000; tests use fewer). */
  monteCarloRuns?: number;
}

/** Run It Back stops here, so one game cannot grow the database without limit. */
export const MAX_SEASONS = 25;
const EARLY_MS = 15;
const INSERT_CHUNK = 400;
const MONTE_CARLO_SLICE = 100;
const VIEW_CACHE = 40;
const timerKey = (gameId: string) => `playback:${gameId}`;
const round1 = (n: number) => Math.round(n * 10) / 10;
const round3 = (n: number) => Math.round(n * 1000) / 1000;
const lineupOf = (t: SeasonTeamRow) => t.lineup as unknown as StoredLineup;

function playerView(p: LeaguePlayer): SeasonPlayerView {
  return {
    ref: p.ref,
    name: p.name,
    slotKey: p.slotKey,
    slotType: p.slotType,
    position: p.positions[0] ?? p.slotType,
    overall: p.overall,
    baseOverall: p.baseOverall,
    outOfPosition: p.outOfPosition,
    reserve: p.reserve,
  };
}

export class SeasonService {
  private readonly db: Db;
  /** Stored seasons never change, so their views are cached by season id. */
  private readonly viewCache = new Map<string, SeasonView>();
  private readonly expected = new Map<string, Promise<ExpectedStrengthView>>();

  constructor(
    private readonly games: GameService,
    private readonly opts: SeasonServiceOptions,
  ) {
    this.db = opts.db;
  }

  // -------------------------------------------------------------------------
  // Reading

  private seasonRows(gameId: string): SeasonRow[] {
    return this.db.select().from(seasons).where(eq(seasons.gameId, gameId)).orderBy(asc(seasons.seasonNumber)).all();
  }

  private latest(gameId: string): SeasonRow | undefined {
    return this.db.select().from(seasons).where(eq(seasons.gameId, gameId)).orderBy(desc(seasons.seasonNumber)).limit(1).get();
  }

  private requireSeason(game: GameRow, number?: number): SeasonRow {
    const row =
      number === undefined
        ? this.latest(game.id)
        : this.seasonRows(game.id).find((r) => r.seasonNumber === number);
    if (!row) throw notFound('SEASON_NOT_FOUND', number === undefined ? 'The season has not started yet' : `There is no season ${number}`);
    return row;
  }

  private teamsOf(seasonId: string): SeasonTeamRow[] {
    return this.db.select().from(seasonTeams).where(eq(seasonTeams.seasonId, seasonId)).all();
  }

  private playbackView(game: GameRow, seasonNumber: number): PlaybackView {
    const p = (game.playbackState ?? {}) as Partial<StoredPlayback>;
    return {
      mode: p.mode ?? this.games.gameSettings(game).playbackMode,
      season: p.season ?? seasonNumber,
      playing: p.playing ?? false,
      speed: p.speed ?? '1x',
      anchorPos: p.anchorPos ?? SEASON_MATCHDAYS,
      anchorAt: p.anchorAt ?? game.updatedAt,
      version: p.version ?? game.updatedAt,
    };
  }

  /** Seasons played and the playback clock, for the game snapshot. */
  info(game: GameRow): SeasonInfo | null {
    if (game.status !== 'simulating' && game.status !== 'completed' && game.status !== 'cancelled') return null;
    const rows = this.seasonRows(game.id);
    if (!rows.length) return null;
    const names = new Map<string, string>();
    for (const r of rows) {
      if (!r.championSeasonTeamId) continue;
      const t = this.db.select({ name: seasonTeams.name }).from(seasonTeams).where(eq(seasonTeams.id, r.championSeasonTeamId)).get();
      if (t) names.set(r.championSeasonTeamId, t.name);
    }
    return {
      seasons: rows.map((r) => ({
        number: r.seasonNumber,
        championId: r.championSeasonTeamId ?? '',
        championName: names.get(r.championSeasonTeamId ?? '') ?? '',
        createdAt: r.createdAt,
      })),
      playback: this.playbackView(game, rows.at(-1)!.seasonNumber),
    };
  }

  view(code: string, number?: number): SeasonView {
    const game = this.games.findGame(code);
    const row = this.requireSeason(game, number);
    const cached = this.viewCache.get(row.id);
    if (cached) return cached;
    const view = this.buildView(game, row);
    this.viewCache.set(row.id, view);
    if (this.viewCache.size > VIEW_CACHE) this.viewCache.delete(this.viewCache.keys().next().value!);
    return view;
  }

  private teamView(t: SeasonTeamRow, managerOf: ReadonlyMap<string, string>): SeasonTeamView {
    const lineup = lineupOf(t);
    return {
      id: t.id,
      kind: t.kind,
      participantId: t.participantId,
      clubId: t.clubId,
      name: t.name,
      managerName: t.participantId ? (managerOf.get(t.participantId) ?? null) : null,
      color: t.primaryColor,
      secondaryColor: t.secondaryColor,
      monogram: lineup.monogram,
      formation: t.formation as FormationId,
      attack: round1(t.attackRating),
      defense: round1(t.defenseRating),
      chemistry: round1(t.chemistryBonus),
      strength: round1(lineup.strength),
      rank: lineup.rank,
      players: lineup.players.map(playerView),
    };
  }

  private buildView(game: GameRow, row: SeasonRow): SeasonView {
    const teamRows = this.teamsOf(row.id);
    const managerOf = new Map(this.games.participantViewsFor(game).map((p) => [p.id, p.managerName]));
    const teams = teamRows.map((t) => this.teamView(t, managerOf)).sort((a, b) => a.rank - b.rank);

    const fixtureRows = this.db.select().from(fixtures).where(eq(fixtures.seasonId, row.id)).orderBy(asc(fixtures.matchday), asc(fixtures.id)).all();
    const eventRows = this.db
      .select({ fixtureId: matchEvents.fixtureId, minute: matchEvents.minute, type: matchEvents.type, playerRef: matchEvents.playerRef, teamId: matchEvents.seasonTeamId })
      .from(matchEvents)
      .innerJoin(fixtures, eq(fixtures.id, matchEvents.fixtureId))
      .where(eq(fixtures.seasonId, row.id))
      .orderBy(asc(matchEvents.fixtureId), asc(matchEvents.minute), asc(matchEvents.id))
      .all();
    const eventsBy = new Map<number, MatchEventView[]>();
    for (const e of eventRows) {
      const list = eventsBy.get(e.fixtureId) ?? [];
      list.push({ minute: e.minute, type: e.type, playerRef: e.playerRef, teamId: e.teamId });
      eventsBy.set(e.fixtureId, list);
    }
    const fixtureViews: FixtureView[] = fixtureRows.map((f) => ({
      id: f.id,
      matchday: f.matchday,
      homeId: f.homeTeamId,
      awayId: f.awayTeamId,
      homeGoals: f.homeGoals ?? 0,
      awayGoals: f.awayGoals ?? 0,
      events: eventsBy.get(f.id) ?? [],
    }));

    const matchdays = fixtureViews.reduce((m, f) => Math.max(m, f.matchday), 0) || SEASON_MATCHDAYS;
    const standings: StandingView[][] = Array.from({ length: matchdays }, () => []);
    for (const s of this.db.select().from(standingRows).where(eq(standingRows.seasonId, row.id)).orderBy(asc(standingRows.matchday), asc(standingRows.position)).all()) {
      standings[s.matchday - 1]?.push({
        teamId: s.seasonTeamId,
        played: s.played,
        won: s.won,
        drawn: s.drawn,
        lost: s.lost,
        goalsFor: s.goalsFor,
        goalsAgainst: s.goalsAgainst,
        goalDifference: s.goalDifference,
        points: s.points,
        position: s.position,
        form: s.form,
      });
    }

    const moments: KeyMomentView[] = findKeyMoments({
      fixtures: fixtureViews,
      standings,
      kinds: Object.fromEntries(teams.map((t) => [t.id, t.kind])),
      preseasonRank: Object.fromEntries(teams.map((t) => [t.id, t.rank])),
    }).map(({ fixtureIndex, ...m }) => ({ ...m, fixtureId: fixtureIndex === null ? null : fixtureViews[fixtureIndex]!.id }));

    const goals = fixtureViews.reduce((s, f) => s + f.homeGoals + f.awayGoals, 0);
    return {
      number: row.seasonNumber,
      seed: row.seed,
      matchdays,
      teams,
      extras: teamRows.flatMap((t) => lineupOf(t).extras.map((e) => ({ ...e, teamId: t.id }))),
      fixtures: fixtureViews,
      standings,
      moments,
      championId: row.championSeasonTeamId ?? standings.at(-1)?.[0]?.teamId ?? '',
      bands: this.games.appSettings().table_bands,
      goalsPerMatch: fixtureViews.length ? Math.round((goals / fixtureViews.length) * 100) / 100 : 0,
    };
  }

  // -------------------------------------------------------------------------
  // Simulating and storing

  /** Season 1. Called by the auction service inside the game's queue. */
  startFirst(gameId: string, league: GameLeague, actorUserId: string | null): void {
    const game = this.games.gameById(gameId);
    if (this.latest(gameId)) throw conflict('SEASON_STARTED', 'The season has already started');
    this.begin(game, 1, league, actorUserId, 'game.season.start', '1x');
  }

  /** Simulate, store, and restart the playback clock at kick-off of matchday 1. */
  private begin(game: GameRow, number: number, league: GameLeague, actorUserId: string | null, action: string, speed: PlaybackSpeed): void {
    const mode = this.games.gameSettings(game).playbackMode;
    const seed = deriveSeed(game.seed ?? 0, 'season', number);
    const result = simulateSeason({ teams: league.teams, seed, params: league.params });
    const now = Date.now();
    const prev = (game.playbackState ?? {}) as Partial<StoredPlayback>;
    const playback: StoredPlayback = {
      revealStartedAt: prev.revealStartedAt,
      mode,
      season: number,
      playing: mode === 'synchronized',
      speed,
      anchorPos: 0,
      anchorAt: now,
      version: Math.max(now, (prev.version ?? 0) + 1),
    };
    this.db.transaction((tx) => {
      const seasonId = this.store(tx, game.id, number, seed, league, result);
      tx.update(games)
        .set({ status: mode === 'synchronized' ? 'simulating' : 'completed', countdownDeadline: null, playbackState: playback as unknown as Record<string, unknown>, updatedAt: now })
        .where(eq(games.id, game.id))
        .run();
      audit(tx, {
        actorUserId,
        action,
        target: game.joinCode,
        gameId: game.id,
        details: { season: number, seed, seasonId, champion: league.teams.find((t) => t.id === result.championId)?.name ?? null, mode },
      });
    });
    this.syncTimer(game.id);
  }

  private store(tx: Tx, gameId: string, number: number, seed: number, league: GameLeague, result: SeasonResult): string {
    const seasonId = randomUUID();
    tx.insert(seasons)
      .values({ id: seasonId, gameId, seasonNumber: number, seed, status: 'simulated', parametersSnapshot: result.params as unknown as Record<string, unknown> })
      .run();

    const ranked = result.teams
      .map((r) => ({ id: r.id, name: r.name, strength: overallStrength(r) }))
      .sort((a, b) => b.strength - a.strength || a.name.localeCompare(b.name));
    const rankOf = new Map(ranked.map((r, i) => [r.id, { rank: i + 1, strength: r.strength }]));
    const idOf = new Map<string, string>();
    for (const [order, t] of league.teams.entries()) {
      const rated = result.teams.find((r) => r.id === t.id)!;
      const origin = league.meta[t.id]!;
      const xi = new Set(t.players.map((p) => p.ref));
      const id = randomUUID();
      idOf.set(t.id, id);
      const lineup: StoredLineup = {
        sourceId: t.id,
        order,
        players: t.players,
        extras: result.playerStats.filter((s) => s.teamId === t.id && !xi.has(s.ref)).map((s) => ({ ref: s.ref, name: s.name })),
        monogram: origin.monogram,
        strength: rankOf.get(t.id)!.strength,
        rank: rankOf.get(t.id)!.rank,
      };
      tx.insert(seasonTeams)
        .values({
          id,
          seasonId,
          kind: t.kind,
          participantId: origin.participantId,
          clubId: origin.clubId,
          name: t.name,
          primaryColor: origin.color,
          secondaryColor: origin.secondaryColor,
          lineup: lineup as unknown as Record<string, unknown>,
          formation: t.formation,
          attackRating: rated.attack,
          defenseRating: rated.defense,
          chemistryBonus: rated.chemistry,
        })
        .run();
    }
    const sid = (engineId: string) => idOf.get(engineId)!;

    const events: (typeof matchEvents.$inferInsert)[] = [];
    for (const f of result.fixtures) {
      const row = tx
        .insert(fixtures)
        .values({ seasonId, matchday: f.matchday, homeTeamId: sid(f.homeId), awayTeamId: sid(f.awayId), homeGoals: f.homeGoals, awayGoals: f.awayGoals })
        .returning({ id: fixtures.id })
        .get();
      for (const e of f.events) events.push({ fixtureId: row.id, minute: e.minute, type: e.type, playerRef: e.playerRef, seasonTeamId: sid(e.teamId) });
    }
    for (let i = 0; i < events.length; i += INSERT_CHUNK) tx.insert(matchEvents).values(events.slice(i, i + INSERT_CHUNK)).run();

    const tables = result.standings.flatMap((table, i) =>
      table.map((r) => ({
        seasonId,
        matchday: i + 1,
        seasonTeamId: sid(r.teamId),
        played: r.played,
        won: r.won,
        drawn: r.drawn,
        lost: r.lost,
        goalsFor: r.goalsFor,
        goalsAgainst: r.goalsAgainst,
        goalDifference: r.goalDifference,
        points: r.points,
        position: r.position,
        form: r.form,
      })),
    );
    for (let i = 0; i < tables.length; i += INSERT_CHUNK) tx.insert(standingRows).values(tables.slice(i, i + INSERT_CHUNK)).run();

    const stats = result.playerStats.map((s) => ({
      seasonId,
      playerRef: s.ref,
      seasonTeamId: sid(s.teamId),
      appearances: s.appearances,
      goals: s.goals,
      assists: s.assists,
      cleanSheets: s.cleanSheets,
      yellows: s.yellows,
      reds: s.reds,
      ratingSum: s.ratingSum,
      avgRating: s.avgRating,
    }));
    for (let i = 0; i < stats.length; i += INSERT_CHUNK) tx.insert(playerSeasonStats).values(stats.slice(i, i + INSERT_CHUNK)).run();

    tx.update(seasons).set({ championSeasonTeamId: sid(result.championId) }).where(eq(seasons.id, seasonId)).run();
    return seasonId;
  }

  /** The stored season's 20 teams as engine input, with engine id -> season team id. */
  private leagueFromSeason(seasonId: string): { teams: LeagueTeam[]; meta: Record<string, TeamOrigin>; seasonTeamId: Map<string, string> } {
    const rows = this.teamsOf(seasonId);
    const meta: Record<string, TeamOrigin> = {};
    const seasonTeamId = new Map<string, string>();
    const sorted = [...rows].sort((a, b) => lineupOf(a).order - lineupOf(b).order);
    const teams = sorted.map((t) => {
      const lineup = lineupOf(t);
      meta[lineup.sourceId] = { participantId: t.participantId, clubId: t.clubId, color: t.primaryColor, secondaryColor: t.secondaryColor, monogram: lineup.monogram };
      seasonTeamId.set(lineup.sourceId, t.id);
      return { id: lineup.sourceId, name: t.name, kind: t.kind, formation: t.formation as FormationId, players: lineup.players };
    });
    return { teams, meta, seasonTeamId };
  }

  // -------------------------------------------------------------------------
  // Host actions

  /** Same 20 teams, the next seed, kept in history. */
  runItBack(user: UserRow, code: string): Promise<SeasonInfo> {
    const game = this.games.findGame(code);
    this.games.requireHost(game, user);
    return this.games.auction.serialized(game.id, () => {
      const g = this.games.gameById(game.id);
      if (g.status !== 'simulating' && g.status !== 'completed') throw conflict('NOT_PLAYED', 'Run It Back needs a finished auction and a season');
      const last = this.requireSeason(g);
      if (last.seasonNumber >= MAX_SEASONS) throw conflict('TOO_MANY_SEASONS', `A game can have at most ${MAX_SEASONS} seasons`);
      const { teams, meta } = this.leagueFromSeason(last.id);
      const params = withSimDefaults(this.games.appSettings().sim_params);
      this.begin(g, last.seasonNumber + 1, { teams, meta, params }, user.id, 'game.season.rerun', this.playbackView(g, last.seasonNumber).speed);
      const fresh = this.games.gameById(g.id);
      const info = this.info(fresh)!;
      this.games.broadcastLobby(g.id);
      this.games.broadcaster.seasonPlayback(g.id, info.playback);
      return info;
    });
  }

  /** Host controls for synchronized playback. */
  control(user: UserRow, code: string, input: PlaybackAction): Promise<PlaybackView> {
    const game = this.games.findGame(code);
    this.games.requireHost(game, user);
    return this.games.auction.serialized(game.id, () => {
      const g = this.games.gameById(game.id);
      const last = this.requireSeason(g);
      const current = this.playbackView(g, last.seasonNumber);
      if (current.mode !== 'synchronized') throw conflict('OWN_PACE', 'Everyone controls their own playback in this game');
      const now = Date.now();
      const pos = playbackPos(current, now);
      let next: PlaybackClock;
      switch (input.action) {
        case 'play':
          next = reanchor(current, now, { playing: true, anchorPos: pos >= SEASON_MATCHDAYS ? 0 : pos });
          break;
        case 'pause':
          next = reanchor(current, now, { playing: false });
          break;
        case 'speed':
          next = reanchor(current, now, { speed: input.speed });
          break;
        case 'seek':
          next = reanchor(current, now, { anchorPos: input.matchday });
          break;
        case 'end':
          next = reanchor(current, now, { anchorPos: SEASON_MATCHDAYS, playing: false });
          break;
      }
      const status = g.status === 'simulating' && next.anchorPos >= SEASON_MATCHDAYS ? 'completed' : g.status;
      audit(this.db, { actorUserId: user.id, action: `game.playback.${input.action}`, target: g.joinCode, gameId: g.id, details: { ...input, season: last.seasonNumber } });
      return this.savePlayback(g, current, next, status);
    });
  }

  private savePlayback(g: GameRow, current: PlaybackView, next: PlaybackClock, status: GameRow['status']): PlaybackView {
    const now = Date.now();
    const view: PlaybackView = { ...current, ...next, version: Math.max(now, current.version + 1) };
    const stored: StoredPlayback = { ...((g.playbackState ?? {}) as Partial<StoredPlayback>), ...view };
    this.db.update(games).set({ playbackState: stored as unknown as Record<string, unknown>, status, updatedAt: now }).where(eq(games.id, g.id)).run();
    this.games.broadcaster.seasonPlayback(g.id, view);
    if (status !== g.status) this.games.broadcastLobby(g.id);
    this.syncTimer(g.id);
    return view;
  }

  // -------------------------------------------------------------------------
  // The end-of-season timer (synchronized playback only)

  private syncTimer(gameId: string): void {
    const key = timerKey(gameId);
    const g = this.games.gameById(gameId);
    const last = g.status === 'simulating' ? this.latest(gameId) : undefined;
    const p = last ? this.playbackView(g, last.seasonNumber) : null;
    const endsAt = p && p.mode === 'synchronized' ? playbackEndsAt(p) : null;
    if (endsAt === null) {
      this.opts.timers.cancel(key);
      return;
    }
    this.opts.timers.schedule(key, endsAt - Date.now(), () => {
      this.tick(gameId).catch((err: unknown) => console.error(`[season ${gameId}]`, err));
    });
  }

  /** Marks the game completed once the shared clock has reached the final whistle. Tests call it directly. */
  tick(gameId: string): Promise<void> {
    return this.games.auction.serialized(gameId, () => {
      const g = this.games.gameById(gameId);
      if (g.status !== 'simulating') return;
      const last = this.latest(gameId);
      if (!last) return;
      const p = this.playbackView(g, last.seasonNumber);
      if (playbackPos(p, Date.now() + EARLY_MS) < SEASON_MATCHDAYS) {
        this.syncTimer(gameId);
        return;
      }
      audit(this.db, { actorUserId: null, action: 'game.season.complete', target: g.joinCode, gameId: g.id, details: { season: last.seasonNumber } });
      this.savePlayback(g, p, { playing: false, speed: p.speed, anchorPos: SEASON_MATCHDAYS, anchorAt: Date.now() }, 'completed');
    });
  }

  /** Re-arm the end-of-season timer after a restart. */
  resumeTimer(gameId: string): void {
    this.syncTimer(gameId);
  }

  stopTimer(gameId: string): void {
    this.opts.timers.cancel(timerKey(gameId));
  }

  // -------------------------------------------------------------------------
  // Analysis: Expected Strength (Monte Carlo) and multi-season runs

  expectedStrength(code: string): Promise<ExpectedStrengthView> {
    const game = this.games.findGame(code);
    const last = this.requireSeason(game);
    let result = this.expected.get(last.id);
    if (!result) {
      result = this.runMonteCarlo(game, last);
      this.expected.set(last.id, result);
      result.catch(() => this.expected.delete(last.id));
      if (this.expected.size > VIEW_CACHE) this.expected.delete(this.expected.keys().next().value!);
    }
    return result;
  }

  /** 1,000 seasons in slices, so sockets and other games keep running in between. */
  private async runMonteCarlo(game: GameRow, season: SeasonRow): Promise<ExpectedStrengthView> {
    const { teams, seasonTeamId } = this.leagueFromSeason(season.id);
    const params = withSimDefaults(season.parametersSnapshot as Partial<SimParams>);
    const run = createMonteCarlo(teams, { seed: deriveSeed(game.seed ?? 0, 'expected'), runs: this.opts.monteCarloRuns ?? 1000, params });
    while (!run.step(MONTE_CARLO_SLICE)) await new Promise<void>((resolve) => setImmediate(resolve));
    const res = run.result();
    return {
      season: season.seasonNumber,
      runs: res.runs,
      goalsPerMatch: Math.round(res.goalsPerMatch * 100) / 100,
      teams: res.teams.map((t) => ({
        teamId: seasonTeamId.get(t.teamId)!,
        avgPoints: round1(t.avgPoints),
        avgPosition: round1(t.avgPosition),
        titleChance: round3(t.titleChance),
        top4Chance: round3(t.top4Chance),
        bottom3Chance: round3(t.bottom3Chance),
      })),
    };
  }

  multiSeason(code: string, q: { seasons: number; run: number }): MultiSeasonView {
    const game = this.games.findGame(code);
    const last = this.requireSeason(game);
    const { teams, seasonTeamId } = this.leagueFromSeason(last.id);
    const params = withSimDefaults(last.parametersSnapshot as Partial<SimParams>);
    const res = simulateMultiSeason(teams, { seed: deriveSeed(game.seed ?? 0, 'multiseason', q.run), seasons: q.seasons, params });
    return {
      seasons: q.seasons,
      run: q.run,
      champions: res.seasons.map((s) => ({ season: s.seasonNumber, teamId: seasonTeamId.get(s.championId)!, points: s.table[0]!.points })),
      titles: res.titles.map((t) => ({
        teamId: seasonTeamId.get(t.teamId)!,
        titles: t.titles,
        avgPoints: round1(t.avgPoints),
        avgPosition: round1(t.avgPosition),
        bestFinish: t.bestFinish,
      })),
    };
  }

  // -------------------------------------------------------------------------
  // League Teams page

  league(code: string): LeagueView {
    const game = this.games.findGame(code);
    const last = this.latest(game.id);
    if (last) {
      const view = this.view(code, last.seasonNumber);
      return {
        season: last.seasonNumber,
        teams: view.teams.map((t) => ({
          id: t.id,
          kind: t.kind,
          participantId: t.participantId,
          clubId: t.clubId,
          name: t.name,
          managerName: t.managerName,
          color: t.color,
          monogram: t.monogram,
          formation: t.formation,
          attack: t.attack,
          defense: t.defense,
          chemistry: t.chemistry,
          strength: t.strength,
          rank: t.rank,
          filled: t.players.length,
          provisional: false,
          players: t.players,
        })),
      };
    }
    if (game.status !== 'auctioning' && game.status !== 'paused' && game.status !== 'auction_complete') {
      throw conflict('NOT_STARTED', 'The League Teams page opens when the auction starts');
    }
    const league = this.games.auction.gameLeague(game.id, true);
    const managerOf = new Map(this.games.participantViewsFor(game).map((p) => [p.id, p.managerName]));
    const byId = new Map(league.teams.map((t) => [t.id, t]));
    const teams: LeagueTeamRow[] = rankLeague(league.teams, league.params).map((r) => {
      const t = byId.get(r.id)!;
      const o = league.meta[r.id]!;
      return {
        id: r.id,
        kind: r.kind,
        participantId: o.participantId,
        clubId: o.clubId,
        name: r.name,
        managerName: o.participantId ? (managerOf.get(o.participantId) ?? null) : null,
        color: o.color,
        monogram: o.monogram,
        formation: r.formation,
        attack: round1(r.attack),
        defense: round1(r.defense),
        chemistry: round1(r.chemistry),
        strength: round1(r.strength),
        rank: r.rank,
        filled: t.players.length,
        provisional: t.players.length < 11,
        players: t.players.map(playerView),
      };
    });
    return { season: null, teams };
  }
}
