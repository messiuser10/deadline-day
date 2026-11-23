import { describe, expect, it } from 'vitest';
import { computeAwards, headToHead, simulateSeason, teamReport, type ReportFixture } from '../src';
import { syntheticLeague } from './helpers';

const fx = (id: number, matchday: number, homeId: string, awayId: string, homeGoals: number, awayGoals: number): ReportFixture => ({
  id,
  matchday,
  homeId,
  awayId,
  homeGoals,
  awayGoals,
});

describe('team report', () => {
  const fixtures = [
    fx(1, 1, 'a', 'b', 2, 0), // W home
    fx(2, 2, 'c', 'a', 1, 1), // D away
    fx(3, 3, 'a', 'c', 5, 1), // W home, margin 4
    fx(4, 4, 'b', 'a', 2, 1), // L away
    fx(5, 5, 'a', 'b', 4, 0), // W home, margin 4 with fewer goals
    fx(6, 6, 'c', 'a', 0, 0), // D away
    fx(7, 7, 'a', 'c', 1, 0), // W home
    fx(8, 1, 'b', 'c', 3, 3), // not a's game
  ];
  const standings = Array.from({ length: 7 }, (_, i) => [
    { teamId: 'a', position: i < 3 ? 1 : 2 },
    { teamId: 'b', position: i < 3 ? 2 : 1 },
  ]);

  it('splits home and away and builds the form timeline', () => {
    const r = teamReport('a', fixtures, standings);
    expect(r.results).toEqual(['W', 'D', 'W', 'L', 'W', 'D', 'W']);
    expect(r.home).toEqual({ played: 4, won: 4, drawn: 0, lost: 0, goalsFor: 12, goalsAgainst: 1, points: 12 });
    expect(r.away).toEqual({ played: 3, won: 0, drawn: 2, lost: 1, goalsFor: 2, goalsAgainst: 3, points: 2 });
    expect(r.positions).toEqual([1, 1, 1, 2, 2, 2, 2]);
  });

  it('picks the biggest margin, then the most goals', () => {
    expect(teamReport('a', fixtures, standings).biggestWin).toEqual({ fixtureId: 3, matchday: 3, opponentId: 'c', home: true, goalsFor: 5, goalsAgainst: 1 });
  });

  it('finds the longest unbeaten run (first one on a tie)', () => {
    expect(teamReport('a', fixtures, standings).longestUnbeaten).toEqual({ length: 3, from: 1, to: 3 });
    expect(teamReport('a', fixtures, standings).longestUnbeaten).not.toEqual({ length: 3, from: 5, to: 7 });
  });

  it('has no biggest win or run for a team that lost every game', () => {
    const r = teamReport('b', [fx(1, 1, 'a', 'b', 1, 0), fx(2, 2, 'b', 'a', 0, 2)], []);
    expect(r.biggestWin).toBeNull();
    expect(r.longestUnbeaten).toBeNull();
    expect(r.positions).toEqual([]);
  });

  it('agrees with the season table for a full simulated season', () => {
    const season = simulateSeason({ teams: syntheticLeague(), seed: 11 });
    for (const row of season.table) {
      const r = teamReport(row.teamId, season.fixtures.map((f, i) => ({ ...f, id: i })), season.standings);
      expect(r.home.played + r.away.played).toBe(38);
      expect(r.home.played).toBe(19);
      expect(r.home.points + r.away.points).toBe(row.points);
      expect(r.home.goalsFor + r.away.goalsFor).toBe(row.goalsFor);
      expect(r.positions.at(-1)).toBe(row.position);
      expect(r.results.slice(-5).join('')).toBe(row.form);
    }
  });
});

describe('head to head', () => {
  it('counts wins, draws and goals from the first side', () => {
    const rec = headToHead('a', 'b', [fx(1, 1, 'a', 'b', 2, 0), fx(2, 2, 'b', 'a', 1, 1), fx(3, 3, 'b', 'a', 3, 1), fx(4, 4, 'a', 'c', 9, 0)]);
    expect(rec).toEqual({ aId: 'a', bId: 'b', played: 3, aWins: 1, draws: 1, bWins: 1, aGoals: 4, bGoals: 4 });
  });

  it('follows the same two sides across seasons through a mapping', () => {
    const side = new Map<string, 'a' | 'b'>([
      ['s1-a', 'a'],
      ['s2-a', 'a'],
      ['s1-b', 'b'],
      ['s2-b', 'b'],
    ]);
    const rec = headToHead('a', 'b', [fx(1, 1, 's1-a', 's1-b', 1, 0), fx(2, 1, 's2-b', 's2-a', 2, 2)], (id) => side.get(id) ?? null);
    expect(rec).toMatchObject({ played: 2, aWins: 1, draws: 1, bWins: 0, aGoals: 3, bGoals: 2 });
  });
});

describe('awards from stored data', () => {
  it('gives the same awards from just the champion and player stats', () => {
    const season = simulateSeason({ teams: syntheticLeague(), seed: 5 });
    expect(computeAwards({ championId: season.championId, playerStats: season.playerStats })).toEqual(computeAwards(season));
  });
});
