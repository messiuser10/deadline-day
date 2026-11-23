import { describe, expect, it } from 'vitest';
import {
  createMonteCarlo,
  findKeyMoments,
  monteCarlo,
  simulateSeason,
  FULL_TIME_MINUTE,
  type KeyMomentFixture,
  type MatchEvent,
  type StandingRow,
  type TeamKind,
} from '../src';
import { syntheticLeague } from './helpers';

const goal = (minute: number, teamId: string, playerRef: string): MatchEvent => ({ minute, type: 'goal', playerRef, teamId });

function row(teamId: string, position: number, points = 0): StandingRow {
  return { teamId, played: 0, won: 0, drawn: 0, lost: 0, goalsFor: 0, goalsAgainst: 0, goalDifference: 0, points, position, form: '' };
}

/** A table where the teams sit in the given order. */
const table = (order: string[]): StandingRow[] => order.map((id, i) => row(id, i + 1));

const teams = Array.from({ length: 10 }, (_, i) => `t${i + 1}`);
const kinds: Record<string, TeamKind> = Object.fromEntries(teams.map((t) => [t, 'ai' as TeamKind]));
const preseasonRank = Object.fromEntries(teams.map((t, i) => [t, i + 1]));

describe('key moments', () => {
  it('finds a hat-trick at the minute of the third goal', () => {
    const fixtures: KeyMomentFixture[] = [
      {
        matchday: 1,
        homeId: 't1',
        awayId: 't2',
        homeGoals: 4,
        awayGoals: 1,
        events: [goal(80, 't1', 'pool:a'), goal(10, 't1', 'pool:a'), goal(33, 't2', 'pool:b'), goal(55, 't1', 'pool:a'), goal(70, 't1', 'pool:c')],
      },
    ];
    const moments = findKeyMoments({ fixtures, standings: [table(teams)], kinds, preseasonRank });
    const hat = moments.find((m) => m.kind === 'hat_trick')!;
    expect(hat).toMatchObject({ matchday: 1, minute: 80, teamId: 't1', otherTeamId: 't2', playerRef: 'pool:a', goals: 3, fixtureIndex: 0 });
  });

  it('flags 4-goal margins but not 3-goal ones', () => {
    const fixtures: KeyMomentFixture[] = [
      { matchday: 1, homeId: 't1', awayId: 't2', homeGoals: 0, awayGoals: 4, events: [] },
      { matchday: 1, homeId: 't3', awayId: 't4', homeGoals: 3, awayGoals: 0, events: [] },
    ];
    const big = findKeyMoments({ fixtures, standings: [table(teams)], kinds, preseasonRank }).filter((m) => m.kind === 'big_win');
    expect(big).toHaveLength(1);
    expect(big[0]).toMatchObject({ teamId: 't2', otherTeamId: 't1', goals: 4, conceded: 0, minute: FULL_TIME_MINUTE });
  });

  it('flags an upset from the table before the matchday (pre-season rank on matchday 1)', () => {
    // Matchday 1: t9 (rank 9) beats t2 (rank 2): 7 places lower against a top-5 side.
    // Matchday 2: by then t9 is 2nd, so beating t1 is no upset; t10 (10th) beating t4 (4th) is exactly 6 places.
    const md2Order = ['t1', 't9', 't3', 't4', 't5', 't6', 't7', 't8', 't2', 't10'];
    const fixtures: KeyMomentFixture[] = [
      { matchday: 1, homeId: 't2', awayId: 't9', homeGoals: 0, awayGoals: 1, events: [] },
      { matchday: 1, homeId: 't6', awayId: 't5', homeGoals: 2, awayGoals: 1, events: [] },
      { matchday: 2, homeId: 't9', awayId: 't1', homeGoals: 2, awayGoals: 0, events: [] },
      { matchday: 2, homeId: 't10', awayId: 't4', homeGoals: 1, awayGoals: 0, events: [] },
    ];
    const upsets = findKeyMoments({ fixtures, standings: [table(md2Order), table(md2Order)], kinds, preseasonRank }).filter((m) => m.kind === 'upset');
    expect(upsets.map((u) => [u.matchday, u.teamId, u.otherTeamId, u.teamPosition, u.otherPosition])).toEqual([
      [1, 't9', 't2', 9, 2],
      [2, 't10', 't4', 10, 4],
    ]);
  });

  it('reports a new leader only when the top spot changes', () => {
    const fixtures: KeyMomentFixture[] = [1, 2, 3].map((md) => ({ matchday: md, homeId: 't1', awayId: 't2', homeGoals: 1, awayGoals: 1, events: [] }));
    const standings = [table(teams), table(teams), table(['t2', ...teams.filter((t) => t !== 't2')])];
    const leaders = findKeyMoments({ fixtures, standings, kinds, preseasonRank }).filter((m) => m.kind === 'new_leader');
    expect(leaders.map((m) => [m.matchday, m.teamId, m.otherTeamId])).toEqual([
      [1, 't1', null],
      [3, 't2', 't1'],
    ]);
  });

  it('marks fixtures between two auction teams at kick-off', () => {
    const k: Record<string, TeamKind> = { ...kinds, t1: 'human', t2: 'bot', t3: 'human' };
    const fixtures: KeyMomentFixture[] = [
      { matchday: 1, homeId: 't1', awayId: 't2', homeGoals: 1, awayGoals: 1, events: [] },
      { matchday: 1, homeId: 't3', awayId: 't4', homeGoals: 1, awayGoals: 1, events: [] },
    ];
    const derbies = findKeyMoments({ fixtures, standings: [table(teams)], kinds: k, preseasonRank }).filter((m) => m.kind === 'auction_derby');
    expect(derbies).toEqual([expect.objectContaining({ matchday: 1, minute: 0, teamId: 't1', otherTeamId: 't2', fixtureIndex: 0 })]);
  });

  it('runs over a real simulated season, sorted by matchday then minute', () => {
    const league = syntheticLeague();
    const season = simulateSeason({ teams: league, seed: 7 });
    const moments = findKeyMoments({
      fixtures: season.fixtures,
      standings: season.standings,
      kinds: Object.fromEntries(league.map((t, i) => [t.id, i < 3 ? 'human' : 'ai'])),
      preseasonRank: Object.fromEntries(league.map((t, i) => [t.id, i + 1])),
    });
    expect(moments.length).toBeGreaterThan(10);
    expect(moments.filter((m) => m.kind === 'auction_derby')).toHaveLength(6);
    for (let i = 1; i < moments.length; i++) {
      const a = moments[i - 1]!;
      const b = moments[i]!;
      expect(a.matchday * 1000 + a.minute).toBeLessThanOrEqual(b.matchday * 1000 + b.minute);
    }
  });
});

describe('stepped Monte Carlo', () => {
  it('gives the same result in steps as in one go', () => {
    const league = syntheticLeague();
    const whole = monteCarlo(league, { seed: 3, runs: 60 });
    const run = createMonteCarlo(league, { seed: 3, runs: 60 });
    let finished = false;
    let steps = 0;
    while (!finished) {
      finished = run.step(25);
      steps++;
    }
    expect(steps).toBe(3);
    expect(run.done()).toBe(60);
    expect(run.result()).toEqual(whole);
    expect(whole.teams.reduce((s, t) => s + t.titleChance, 0)).toBeCloseTo(1, 10);
  });
});
