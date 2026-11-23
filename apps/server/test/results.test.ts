/* eslint-disable @typescript-eslint/no-explicit-any -- test responses are loosely typed JSON */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { GRADES } from '@deadline-day/engine';
import { auditLog, gameResults, games, participants, seasons } from '../src/db/schema';
import { toCsv } from '../src/games/results';
import { Client, createGame, guest, signUp, team, testApp, type TestApp } from './helpers';

let t: TestApp;

beforeEach(async () => {
  t = await testApp({ botDelayMs: null, monteCarloRuns: 20 });
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

/** Host (registered) + guest + medium bot, auction ended early, season 1 simulated. */
async function playedSeason(settings: Record<string, unknown> = {}, hostName = 'hosty'): Promise<Setup> {
  const host = await signUp(t.app, hostName);
  const code = await createGame(host, 'Results Test', settings);
  const player = await guest(t.app, 'Pat');
  await player.post(`/api/games/${code}/join`, team('Pat FC'));
  await host.post(`/api/games/${code}/bots`, { level: 'medium', formation: '4-4-2' });
  expect((await host.post(`/api/games/${code}/start`, { force: true })).status).toBe(202);
  expect((await host.post(`/api/games/${code}/auction/end`)).status).toBe(200);
  expect((await host.post(`/api/games/${code}/season/start`)).status).toBe(200);
  const snap = (await host.get(`/api/games/${code}`)).body.snapshot;
  return { code, gameId: snap.game.id, host, player };
}

const gameRow = (s: Setup) => t.db.select().from(games).where(eq(games.id, s.gameId)).get()!;
const resultRows = (s: Setup) => t.db.select().from(gameResults).where(eq(gameResults.gameId, s.gameId)).all();
const finish = (s: Setup) => s.host.post(`/api/games/${s.code}/season/playback`, { action: 'end' });
const results = async (s: Setup, number?: number) => (await s.player.get(`/api/games/${s.code}/results${number ? `?number=${number}` : ''}`)).body.results;

async function download(client: Client, url: string) {
  const res = await t.app.inject({ method: 'GET', url, headers: client.cookie ? { cookie: client.cookie } : {} });
  return { status: res.statusCode, headers: res.headers, body: res.body };
}

describe('results view', () => {
  it('has awards, auction grades with purchase tags, player stats, team reports and head to head', async () => {
    const s = await playedSeason();
    const season = (await s.player.get(`/api/games/${s.code}/season`)).body.season;
    const r = await results(s);

    expect(r.number).toBe(1);
    expect(r.official).toBe(true);

    // Awards
    expect(r.awards.championId).toBe(season.championId);
    const maxGoals = Math.max(...r.players.map((p: any) => p.goals));
    expect(r.awards.goldenBoot.value).toBe(maxGoals);
    expect(r.awards.teamOfTheSeason.slots).toHaveLength(11);
    expect(r.awards.bestBuy).toBeTruthy();
    expect(r.awards.bestBuy.gap).toBeGreaterThanOrEqual(r.awards.biggestOverpay.gap);

    // Grades: three auction teams, eleven purchases each, sorted by final position
    expect(r.grades).toHaveLength(3);
    const final = season.standings.at(-1);
    for (const g of r.grades) {
      expect(GRADES).toContain(g.grade);
      expect(g.purchases).toHaveLength(11);
      expect(g.finalPosition).toBe(final.find((x: any) => x.teamId === g.teamId).position);
      expect(g.spentM).toBe(g.purchases.reduce((sum: number, p: any) => sum + p.priceM, 0));
      expect(g.spentM + g.leftM).toBe(1000);
      expect(g.mostExpensive.priceM).toBe(Math.max(...g.purchases.map((p: any) => p.priceM)));
      for (const p of g.purchases) {
        const ratio = p.priceM / p.marketValueM;
        expect(p.tag).toBe(ratio <= 0.8 ? 'steal' : ratio >= 1.3 ? 'overpay' : 'fair');
      }
    }
    expect(r.grades.map((g: any) => g.finalPosition)).toEqual([...r.grades.map((g: any) => g.finalPosition)].sort((a, b) => a - b));

    // Team reports agree with the final table
    expect(r.reports).toHaveLength(20);
    for (const rep of r.reports) {
      const row = final.find((x: any) => x.teamId === rep.teamId);
      expect(rep.results).toHaveLength(38);
      expect(rep.home.points + rep.away.points).toBe(row.points);
      expect(rep.positions.at(-1)).toBe(row.position);
    }

    // Head to head: 3 pairs, both legs, all time = this season
    expect(r.headToHead).toHaveLength(3);
    for (const h of r.headToHead) {
      expect(h.legs).toHaveLength(2);
      expect(h.allTime).toMatchObject({ seasons: 1, played: 2 });
      const aGoals = h.legs.reduce((sum: number, l: any) => sum + (l.homeId === h.aId ? l.homeGoals : l.awayGoals), 0);
      expect(h.allTime.aGoals).toBe(aGoals);
    }
  });

  it('saves the awards on the season row and serves the same awards again', async () => {
    const s = await playedSeason();
    const first = await results(s);
    const row = t.db.select().from(seasons).where(eq(seasons.gameId, s.gameId)).get()!;
    expect(row.awards).toEqual(first.awards);
    expect((await results(s)).awards).toEqual(first.awards);
  });
});

describe('official results', () => {
  it('publishes season 1 once, when synchronized playback reaches the final whistle', async () => {
    const s = await playedSeason();
    expect(gameRow(s).status).toBe('simulating');
    expect(resultRows(s)).toHaveLength(0);
    expect(gameRow(s).completedAt).toBeNull();

    expect((await finish(s)).status).toBe(200);
    const g = gameRow(s);
    expect(g.status).toBe('completed');
    expect(g.completedAt).toBeTypeOf('number');
    const rows = resultRows(s);
    expect(rows).toHaveLength(3);
    const r = await results(s);
    for (const row of rows) {
      const grade = r.grades.find((x: any) => x.teamId === row.seasonTeamId);
      expect(row).toMatchObject({ grade: grade.grade, position: grade.finalPosition, spentM: grade.spentM });
    }
    expect(rows.filter((x) => x.isBot)).toHaveLength(1);
    expect(rows.find((x) => x.isBot)!.userId).toBeNull();

    // Run It Back and its end do not publish again or change season 1's rows.
    expect((await s.host.post(`/api/games/${s.code}/season/rerun`)).status).toBe(200);
    await finish(s);
    expect(resultRows(s)).toEqual(rows);
    expect(gameRow(s).completedAt).toBe(g.completedAt);
    const actions = t.db.select().from(auditLog).where(eq(auditLog.gameId, s.gameId)).all().map((a) => a.action);
    expect(actions.filter((a) => a === 'game.results.publish')).toHaveLength(1);
  });

  it('publishes at once in own-pace mode', async () => {
    const s = await playedSeason({ playbackMode: 'own_pace' });
    expect(gameRow(s).status).toBe('completed');
    expect(resultRows(s)).toHaveLength(3);
  });

  it('counts every season in head to head after Run It Back', async () => {
    const s = await playedSeason();
    await s.host.post(`/api/games/${s.code}/season/rerun`);
    const r2 = await results(s, 2);
    expect(r2.official).toBe(false);
    for (const h of r2.headToHead) expect(h.allTime).toMatchObject({ seasons: 2, played: 4 });
    // Season 1's view now also counts both seasons.
    for (const h of (await results(s, 1)).headToHead) expect(h.allTime.played).toBe(4);
  });

  it('backfills completed games that were never published', async () => {
    const s = await playedSeason();
    await finish(s);
    t.db.delete(gameResults).where(eq(gameResults.gameId, s.gameId)).run();
    t.db.update(games).set({ completedAt: null }).where(eq(games.id, s.gameId)).run();
    t.app.games.restore();
    expect(resultRows(s)).toHaveLength(3);
  });
});

describe('rematch', () => {
  it('opens one new lobby with the same teams, for the host only', async () => {
    const s = await playedSeason();
    expect((await s.player.post(`/api/games/${s.code}/rematch`)).status).toBe(403);

    const res = await s.host.post(`/api/games/${s.code}/rematch`);
    expect(res.status).toBe(200);
    const code = res.body.code as string;
    expect(code).not.toBe(s.code);
    expect((await s.host.post(`/api/games/${s.code}/rematch`)).body.code).toBe(code);

    const old = (await s.player.get(`/api/games/${s.code}`)).body.snapshot;
    expect(old.game.rematchCode).toBe(code);
    const fresh = (await s.player.get(`/api/games/${code}`)).body.snapshot;
    expect(fresh.game.status).toBe('lobby');
    expect(fresh.game.hostUserId).toBe(old.game.hostUserId);
    expect(fresh.game.settings).toEqual(old.game.settings);
    expect(fresh.participants.map((p: any) => p.teamName)).toEqual(old.participants.map((p: any) => p.teamName));
    expect(fresh.participants.map((p: any) => p.isBot)).toEqual(old.participants.map((p: any) => p.isBot));
    expect(fresh.participants.every((p: any) => p.budgetRemainingM === 1000)).toBe(true);
    expect(fresh.participants.filter((p: any) => !p.isBot).every((p: any) => !p.isReady)).toBe(true);
    // The guest is back in, as the same user.
    const guestRow = t.db.select().from(participants).where(eq(participants.teamName, 'Pat FC')).all();
    expect(new Set(guestRow.map((p) => p.userId)).size).toBe(1);
  });

  it('needs a played season', async () => {
    const host = await signUp(t.app, 'early');
    const code = await createGame(host, 'Too Early');
    expect((await host.post(`/api/games/${code}/rematch`)).status).toBe(409);
  });
});

describe('export', () => {
  it('gives the host JSON and CSV downloads and refuses everyone else', async () => {
    const s = await playedSeason();
    const json = await download(s.host, `/api/games/${s.code}/export?format=json`);
    expect(json.status).toBe(200);
    expect(json.headers['content-disposition']).toMatch(/^attachment; filename="results-test-.*-season-1\.json"$/);
    const data = JSON.parse(json.body);
    expect(data.season.fixtures).toHaveLength(380);
    expect(data.results.grades).toHaveLength(3);

    const table = await download(s.host, `/api/games/${s.code}/export?format=csv&table=table`);
    expect(table.headers['content-type']).toMatch(/^text\/csv/);
    const lines = table.body.trim().split('\r\n');
    expect(lines).toHaveLength(21);
    expect(lines[0]).toBe('Pos,Team,Kind,Manager,P,W,D,L,GF,GA,GD,Pts');
    expect((await download(s.host, `/api/games/${s.code}/export?format=csv&table=fixtures`)).body.trim().split('\r\n')).toHaveLength(381);
    expect((await download(s.host, `/api/games/${s.code}/export?format=csv&table=grades`)).body.trim().split('\r\n')).toHaveLength(34);

    expect((await download(s.player, `/api/games/${s.code}/export`)).status).toBe(403);
    expect((await download(new Client(t.app), `/api/games/${s.code}/export`)).status).toBe(401);
    expect((await download(s.host, `/api/games/${s.code}/export?format=xml`)).status).toBe(400);
  });

  it('escapes CSV cells and defuses formulas', () => {
    expect(toCsv([['a,b', 'say "hi"', '=SUM(A1)', -3, 'ok']])).toBe('"a,b","say ""hi""",\'=SUM(A1),-3,ok\r\n');
  });
});

describe('profiles, Hall of Fame, leaderboard and record book', () => {
  it('builds them from official results only, and hides private games from outsiders', async () => {
    const s = await playedSeason();
    const anon = new Client(t.app);

    // Nothing before the season is over.
    expect((await s.host.get('/api/profile')).body.profile.stats.games).toBe(0);
    await finish(s);

    const me = (await s.host.get('/api/profile')).body.profile;
    expect(me.username).toBe('hosty');
    expect(me.stats.games).toBe(1);
    const mine = resultRows(s).find((r) => r.teamName === 'Host Town')!;
    expect(me.games[0]).toMatchObject({ gameCode: s.code, teamName: 'Host Town', position: mine.position, grade: mine.grade, auctionTeams: 3 });
    expect(me.stats.avgFinish).toBe(mine.position);
    expect(me.stats.bestGrade).toBe(mine.grade);
    expect(me.stats.titles).toBe(mine.champion ? 1 : 0);

    // Private by default: outsiders see the result but not the link.
    const pub = (await anon.get('/api/profiles/HOSTY')).body.profile;
    expect(pub.games[0].gameCode).toBeNull();
    expect((await anon.get('/api/profiles/nobody_here')).status).toBe(404);
    expect((await anon.get('/api/profile')).status).toBe(401);

    expect((await anon.get('/api/hall-of-fame')).body.hallOfFame.games).toHaveLength(0);
    const hall = (await s.player.get('/api/hall-of-fame')).body.hallOfFame;
    expect(hall.games).toHaveLength(1);
    expect(hall.games[0]).toMatchObject({ gameCode: s.code, gameName: 'Results Test', auctionTeams: 3 });
    const best = resultRows(s).sort((a, b) => a.position - b.position)[0]!;
    expect(hall.games[0].bestAuctionTeam).toMatchObject({ name: best.teamName, position: best.position, grade: best.grade });
    expect(hall.games[0].champion.points).toBeGreaterThanOrEqual(best.points);

    // Leaderboard: registered players only (the guest and the bot are left out).
    const board = (await anon.get('/api/leaderboard')).body.leaderboard.rows;
    expect(board.map((r: any) => r.username)).toEqual(['hosty']);
    expect(board[0]).toMatchObject({ rank: 1, games: 1, avgFinish: mine.position });

    const records = (await anon.get('/api/records')).body.records;
    expect(records.mostPoints).toHaveLength(3);
    expect(records.mostPoints[0].value).toBe(Math.max(...resultRows(s).map((r) => r.points)));
    expect(records.mostPoints.every((e: any) => e.gameCode === null)).toBe(true);
    expect(records.bestGoalDifference[0].value).toBe(Math.max(...resultRows(s).map((r) => r.goalDifference)));
    for (const e of records.mostGoalsByBoughtPlayer) {
      expect(e.holder).not.toBe('Unknown player');
      expect(e.value).toBeGreaterThan(0);
    }
  });

  it('shows public games to everyone and pages the Hall of Fame', async () => {
    const s = await playedSeason({ visibility: 'public' });
    await finish(s);
    const anon = new Client(t.app);
    const hall = (await anon.get('/api/hall-of-fame')).body.hallOfFame;
    expect(hall.games[0].gameCode).toBe(s.code);
    expect(hall.nextBefore).toBeNull();
    expect((await anon.get('/api/profiles/hosty')).body.profile.games[0].gameCode).toBe(s.code);
    expect((await anon.get(`/api/hall-of-fame?before=${gameRow(s).completedAt}`)).body.hallOfFame.games).toHaveLength(0);
  });
});
