/* eslint-disable @typescript-eslint/no-explicit-any -- test responses are loosely typed JSON */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { simulateSeason } from '@deadline-day/engine';
import { MATCHDAY_MS, SEASON_MATCHDAYS } from '@deadline-day/protocol';
import { buildApp } from '../src/app';
import { auditLog, fixtures, games, matchEvents, playerSeasonStats, seasonTeams, seasons, standingRows } from '../src/db/schema';
import { createGame, guest, signUp, team, testApp, type Client, type TestApp } from './helpers';

let t: TestApp;

beforeEach(async () => {
  t = await testApp({ botDelayMs: null, monteCarloRuns: 60 });
});

afterEach(async () => {
  await t.close();
});

interface Setup {
  code: string;
  gameId: string;
  host: Client;
  player: Client;
}

/** Host + one human + one bot, auction ended early (auto-filled), reveal countdown running. */
async function finishedAuction(settings: Record<string, unknown> = {}): Promise<Setup> {
  const host = await signUp(t.app, 'hosty');
  const code = await createGame(host, 'Season Test', settings);
  const player = await guest(t.app, 'Pat');
  await player.post(`/api/games/${code}/join`, team('Pat FC'));
  await host.post(`/api/games/${code}/bots`, { level: 'medium', formation: '4-4-2' });
  const start = await host.post(`/api/games/${code}/start`, { force: true });
  if (start.status !== 202) throw new Error(JSON.stringify(start.body));
  const end = await host.post(`/api/games/${code}/auction/end`);
  if (end.status !== 200) throw new Error(JSON.stringify(end.body));
  const snap = (await host.get(`/api/games/${code}`)).body.snapshot;
  return { code, gameId: snap.game.id, host, player };
}

const gameRow = (s: Setup) => t.db.select().from(games).where(eq(games.id, s.gameId)).get()!;
const snapshot = async (s: Setup) => (await s.host.get(`/api/games/${s.code}`)).body.snapshot;
const seasonView = async (s: Setup, number?: number) =>
  (await s.player.get(`/api/games/${s.code}/season${number ? `?number=${number}` : ''}`)).body.season;
const actions = (gameId: string) =>
  t.db
    .select()
    .from(auditLog)
    .where(eq(auditLog.gameId, gameId))
    .all()
    .map((a) => a.action);

async function startSeason(s: Setup): Promise<void> {
  t.db.update(games).set({ countdownDeadline: Date.now() - 1 }).where(eq(games.id, s.gameId)).run();
  await t.app.games.auction.tick(s.gameId);
}

describe('season simulation', () => {
  it('simulates and saves the whole season when the reveal countdown runs out', async () => {
    const s = await finishedAuction();
    await startSeason(s);

    const g = gameRow(s);
    expect(g.status).toBe('simulating');
    expect(g.countdownDeadline).toBeNull();
    const rows = t.db.select().from(seasons).where(eq(seasons.gameId, s.gameId)).all();
    expect(rows).toHaveLength(1);
    const row = rows[0]!;
    expect(row).toMatchObject({ seasonNumber: 1, status: 'simulated' });
    expect(row.championSeasonTeamId).toBeTruthy();
    expect(t.db.select().from(seasonTeams).where(eq(seasonTeams.seasonId, row.id)).all()).toHaveLength(20);
    const fx = t.db.select().from(fixtures).where(eq(fixtures.seasonId, row.id)).all();
    expect(fx).toHaveLength(380);
    expect(t.db.select().from(standingRows).where(eq(standingRows.seasonId, row.id)).all()).toHaveLength(20 * 38);
    expect(t.db.select().from(playerSeasonStats).where(eq(playerSeasonStats.seasonId, row.id)).all().length).toBeGreaterThanOrEqual(220);
    const goalEvents = t.db.select().from(matchEvents).all().filter((e) => e.type === 'goal');
    expect(goalEvents).toHaveLength(fx.reduce((n, f) => n + f.homeGoals! + f.awayGoals!, 0));
    expect(actions(s.gameId)).toContain('game.season.start');

    // The snapshot carries the season list and the shared clock, running from kick-off.
    const snap = await snapshot(s);
    expect(snap.game.status).toBe('simulating');
    expect(snap.season.seasons).toEqual([expect.objectContaining({ number: 1, championId: row.championSeasonTeamId })]);
    expect(snap.season.playback).toMatchObject({ mode: 'synchronized', season: 1, playing: true, speed: '1x', anchorPos: 0 });

    // The season view: everything playback needs, and the section 14 invariants.
    const v = await seasonView(s);
    expect(v.teams).toHaveLength(20);
    expect(v.teams.filter((x: any) => x.kind === 'human')).toHaveLength(2);
    expect(v.teams.filter((x: any) => x.kind === 'bot')).toHaveLength(1);
    expect(v.teams.every((x: any) => x.players.length === 11)).toBe(true);
    expect(v.teams.map((x: any) => x.rank)).toEqual(Array.from({ length: 20 }, (_, i) => i + 1));
    expect(v.fixtures).toHaveLength(380);
    expect(v.standings).toHaveLength(SEASON_MATCHDAYS);
    const final = v.standings.at(-1);
    expect(final[0].teamId).toBe(v.championId);
    for (const r of final) {
      expect(r.played).toBe(38);
      expect(r.points).toBe(3 * r.won + r.drawn);
      expect(v.fixtures.filter((f: any) => f.homeId === r.teamId)).toHaveLength(19);
    }
    const gf = final.reduce((n: number, r: any) => n + r.goalsFor, 0);
    expect(gf).toBe(final.reduce((n: number, r: any) => n + r.goalsAgainst, 0));
    expect(v.goalsPerMatch).toBeGreaterThan(1.5);
    // Three auction teams meet twice each: 6 auction derbies.
    expect(v.moments.filter((m: any) => m.kind === 'auction_derby')).toHaveLength(6);
    expect(v.bands.map((b: any) => b.label)).toContain('Champions');

    // Bought players never appear in an AI club's XI.
    const bought = new Set(v.teams.filter((x: any) => x.kind !== 'ai').flatMap((x: any) => x.players.map((p: any) => `${p.name}|${p.baseOverall}`)));
    const aiNames = v.teams.filter((x: any) => x.kind === 'ai').flatMap((x: any) => x.players.map((p: any) => `${p.name}|${p.baseOverall}`));
    expect(aiNames.filter((n: string) => bought.has(n))).toEqual([]);
  });

  it('is fully reproducible from the stored seed, and a different seed differs', async () => {
    const s = await finishedAuction();
    const league = t.app.games.auction.gameLeague(s.gameId, false);
    await startSeason(s);
    const v = await seasonView(s);
    const nameOf = new Map(v.teams.map((x: any) => [x.id, x.name]));
    const stored = v.standings.at(-1).map((r: any) => `${nameOf.get(r.teamId)}:${r.points}:${r.goalsFor}`);
    const nameById = new Map(league.teams.map((x) => [x.id, x.name]));
    const again = simulateSeason({ teams: league.teams, seed: v.seed, params: league.params });
    expect(again.table.map((r) => `${nameById.get(r.teamId)}:${r.points}:${r.goalsFor}`)).toEqual(stored);
    const other = simulateSeason({ teams: league.teams, seed: v.seed + 1, params: league.params });
    expect(other.table.map((r) => `${nameById.get(r.teamId)}:${r.points}:${r.goalsFor}`)).not.toEqual(stored);
  });

  it('lets only the host start the season early, once', async () => {
    const s = await finishedAuction();
    expect((await s.player.post(`/api/games/${s.code}/season/start`)).status).toBe(403);
    const res = await s.host.post(`/api/games/${s.code}/season/start`);
    expect(res.status).toBe(200);
    expect(gameRow(s).status).toBe('simulating');
    expect((await s.host.post(`/api/games/${s.code}/season/start`)).body.error.code).toBe('NOT_COMPLETE');
    expect(t.db.select().from(seasons).all()).toHaveLength(1);
    expect((await s.host.post(`/api/games/${s.code}/cancel`)).body.error.code).toBe('SEASON_PLAYED');
  });

  it('answers 404 before there is a season', async () => {
    const s = await finishedAuction();
    const res = await s.player.get(`/api/games/${s.code}/season`);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('SEASON_NOT_FOUND');
  });
});

describe('league size (section 14)', () => {
  it.each([
    [2, 40, 18],
    [12, 154, 8],
  ])('a %i-team all-4-3-3 game builds a %i-player pool, takes %i AI clubs and plays a 20-team, 380-match season', async (teams, poolSize, aiClubs) => {
    const host = await signUp(t.app, `host${teams}`);
    const code = await createGame(host, `Size ${teams}`, { maxTeams: teams });
    for (let i = 1; i < teams; i++) {
      const res = await host.post(`/api/games/${code}/bots`, { level: 'easy', formation: '4-3-3' });
      expect(res.status).toBe(201);
    }
    const start = await host.post(`/api/games/${code}/start`, { force: true });
    expect(start.status).toBe(202);
    const s: Setup = { code, gameId: (await host.get(`/api/games/${code}`)).body.snapshot.game.id, host, player: host };
    const g = gameRow(s);
    expect(g.aiClubIds).toHaveLength(aiClubs);
    expect((await snapshot(s)).pool.totalSize).toBe(poolSize);
    expect((await snapshot(s)).auction.teams.every((x: any) => x.budgetM === 1000)).toBe(true);

    expect((await host.post(`/api/games/${code}/auction/end`)).status).toBe(200);
    expect((await snapshot(s)).auction.teams.every((x: any) => x.filled === 11 && x.budgetM >= 0)).toBe(true);
    await startSeason(s);

    const v = await seasonView(s);
    expect(v.teams).toHaveLength(20);
    expect(v.teams.filter((x: any) => x.kind === 'ai')).toHaveLength(aiClubs);
    expect(v.fixtures).toHaveLength(380);
    expect(new Set(v.fixtures.map((f: any) => f.matchday)).size).toBe(38);
    for (const team of v.teams) {
      const mine = v.fixtures.filter((f: any) => f.homeId === team.id || f.awayId === team.id);
      expect(mine).toHaveLength(38);
      expect(mine.filter((f: any) => f.homeId === team.id)).toHaveLength(19);
      const opponents = new Map<string, number>();
      for (const f of mine) {
        const other = f.homeId === team.id ? f.awayId : f.homeId;
        opponents.set(other, (opponents.get(other) ?? 0) + 1);
      }
      expect(opponents.size).toBe(19);
      expect([...opponents.values()].every((n) => n === 2)).toBe(true);
    }
  });
});

describe('playback', () => {
  it('lets the host drive one shared clock that others cannot touch', async () => {
    const s = await finishedAuction();
    await startSeason(s);
    const url = `/api/games/${s.code}/season/playback`;
    expect((await s.player.post(url, { action: 'pause' })).body.error.code).toBe('HOST_ONLY');
    expect((await s.host.post(url, { action: 'seek', matchday: 39 })).status).toBe(400);

    const paused = (await s.host.post(url, { action: 'pause' })).body.playback;
    expect(paused.playing).toBe(false);
    const fast = (await s.host.post(url, { action: 'speed', speed: '5x' })).body.playback;
    expect(fast).toMatchObject({ playing: false, speed: '5x' });
    expect(fast.version).toBeGreaterThan(paused.version);
    const sought = (await s.host.post(url, { action: 'seek', matchday: 12 })).body.playback;
    expect(sought.anchorPos).toBe(12);
    const playing = (await s.host.post(url, { action: 'play' })).body.playback;
    expect(playing).toMatchObject({ playing: true, anchorPos: 12 });
    expect(gameRow(s).status).toBe('simulating');

    const ended = (await s.host.post(url, { action: 'end' })).body.playback;
    expect(ended).toMatchObject({ playing: false, anchorPos: 38 });
    expect(gameRow(s).status).toBe('completed');
    // Play after the final whistle replays from kick-off; the game stays completed.
    const replay = (await s.host.post(url, { action: 'play' })).body.playback;
    expect(replay).toMatchObject({ playing: true, anchorPos: 0 });
    expect(gameRow(s).status).toBe('completed');
    expect(actions(s.gameId)).toEqual(expect.arrayContaining(['game.playback.pause', 'game.playback.seek', 'game.playback.end']));
  });

  it('marks the game completed when the shared clock reaches the final whistle', async () => {
    const s = await finishedAuction();
    await startSeason(s);
    const g = gameRow(s);
    const p = g.playbackState as any;
    // Not there yet: nothing changes.
    await t.app.games.season.tick(s.gameId);
    expect(gameRow(s).status).toBe('simulating');
    t.db
      .update(games)
      .set({ playbackState: { ...p, anchorAt: Date.now() - SEASON_MATCHDAYS * MATCHDAY_MS['1x'] - 1 } })
      .where(eq(games.id, s.gameId))
      .run();
    await t.app.games.season.tick(s.gameId);
    expect(gameRow(s).status).toBe('completed');
    expect((await snapshot(s)).season.playback).toMatchObject({ playing: false, anchorPos: 38 });
    expect(actions(s.gameId)).toContain('game.season.complete');
  });

  it('re-arms the end-of-season timer after a restart', async () => {
    const s = await finishedAuction();
    await startSeason(s);
    await s.host.post(`/api/games/${s.code}/season/playback`, { action: 'pause' });
    const p = gameRow(s).playbackState as any;
    // Playing, with 60 ms of the final matchday left.
    t.db
      .update(games)
      .set({ playbackState: { ...p, playing: true, speed: '1x', anchorPos: 38 - 0.006, anchorAt: Date.now() } })
      .where(eq(games.id, s.gameId))
      .run();
    const again = buildApp({ db: t.db, botDelayMs: null, startCountdownMs: 0 });
    await again.ready();
    await new Promise((resolve) => setTimeout(resolve, 250));
    expect(gameRow(s).status).toBe('completed');
    await again.close();
  });

  it('completes at once in own-pace mode, where nobody drives a shared clock', async () => {
    const s = await finishedAuction({ playbackMode: 'own_pace' });
    await startSeason(s);
    expect(gameRow(s).status).toBe('completed');
    expect((await snapshot(s)).season.playback.mode).toBe('own_pace');
    const res = await s.host.post(`/api/games/${s.code}/season/playback`, { action: 'pause' });
    expect(res.body.error.code).toBe('OWN_PACE');
  });
});

describe('run it back, multi-season and expected strength', () => {
  it('plays another season with the same teams and a new seed, keeping the first', async () => {
    const s = await finishedAuction();
    await startSeason(s);
    const first = await seasonView(s);
    expect((await s.player.post(`/api/games/${s.code}/season/rerun`)).status).toBe(403);

    const res = await s.host.post(`/api/games/${s.code}/season/rerun`);
    expect(res.status).toBe(200);
    expect(res.body.season.seasons.map((x: any) => x.number)).toEqual([1, 2]);
    expect(res.body.season.playback).toMatchObject({ season: 2, playing: true, anchorPos: 0 });
    expect(gameRow(s).status).toBe('simulating');

    const second = await seasonView(s);
    expect(second.number).toBe(2);
    expect(second.seed).not.toBe(first.seed);
    const lineups = (v: any) => v.teams.map((x: any) => `${x.name}:${x.players.map((p: any) => p.ref).join(',')}`).sort();
    expect(lineups(second)).toEqual(lineups(first));
    expect((await seasonView(s, 1)).seed).toBe(first.seed);
    expect((await s.player.get(`/api/games/${s.code}/season?number=9`)).status).toBe(404);
    expect(actions(s.gameId)).toContain('game.season.rerun');
  });

  it('runs 2 to 10 seasons with a titles table, and the Monte Carlo expected strength', async () => {
    const s = await finishedAuction();
    await startSeason(s);
    const v = await seasonView(s);
    const ids = new Set(v.teams.map((x: any) => x.id));

    const multi = (await s.player.get(`/api/games/${s.code}/season/multi?seasons=4`)).body.multi;
    expect(multi.champions).toHaveLength(4);
    expect(multi.titles.reduce((n: number, r: any) => n + r.titles, 0)).toBe(4);
    expect(multi.titles.every((r: any) => ids.has(r.teamId))).toBe(true);
    const again = (await s.player.get(`/api/games/${s.code}/season/multi?seasons=4`)).body.multi;
    expect(again).toEqual(multi);
    expect((await s.player.get(`/api/games/${s.code}/season/multi?seasons=11`)).status).toBe(400);
    expect((await s.player.get(`/api/games/${s.code}/season/multi?seasons=1`)).status).toBe(400);

    const expected = (await s.player.get(`/api/games/${s.code}/season/expected`)).body.expected;
    expect(expected.runs).toBe(60);
    expect(expected.teams).toHaveLength(20);
    expect(expected.teams.every((r: any) => ids.has(r.teamId))).toBe(true);
    expect(expected.teams.reduce((n: number, r: any) => n + r.titleChance, 0)).toBeCloseTo(1, 1);
    expect(expected.teams[0].avgPoints).toBeGreaterThanOrEqual(expected.teams[19].avgPoints);
  });
});

describe('league teams page', () => {
  it('ranks all 20 teams, provisionally while the auction runs', async () => {
    const host = await signUp(t.app, 'hosty');
    const code = await createGame(host, 'League Test');
    await host.post(`/api/games/${code}/bots`, { level: 'easy', formation: '4-3-3' });
    expect((await host.get(`/api/games/${code}/league`)).body.error.code).toBe('NOT_STARTED');
    await host.post(`/api/games/${code}/start`, { force: true });

    const during = (await host.get(`/api/games/${code}/league`)).body.league;
    expect(during.season).toBeNull();
    expect(during.teams).toHaveLength(20);
    const auctionTeams = during.teams.filter((x: any) => x.kind !== 'ai');
    expect(auctionTeams).toHaveLength(2);
    expect(auctionTeams.every((x: any) => x.provisional && x.filled === 0)).toBe(true);
    expect(during.teams.filter((x: any) => x.kind === 'ai').every((x: any) => x.filled === 11 && !x.provisional)).toBe(true);

    await host.post(`/api/games/${code}/auction/end`);
    await host.post(`/api/games/${code}/season/start`);
    const after = (await host.get(`/api/games/${code}/league`)).body.league;
    expect(after.season).toBe(1);
    expect(after.teams.every((x: any) => x.filled === 11 && !x.provisional)).toBe(true);
    const strengths = after.teams.map((x: any) => x.strength);
    expect([...strengths].sort((a, b) => b - a)).toEqual(strengths);
  });
});
