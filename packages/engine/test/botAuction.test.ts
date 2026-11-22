import { describe, expect, it } from 'vitest';
import {
  FORMATIONS,
  LEAGUE_SIZE,
  assignLineup,
  isEligible,
  runTestGame,
  type BotLevel,
  type TestGameResult,
} from '../src';
import { realData } from './helpers';

const data = realData();
const game = (teams: number, seed: number, botLevel: BotLevel | 'mixed' = 'mixed'): TestGameResult =>
  runTestGame({ master: data.master, clubs: data.clubs, seedPlayers: data.seedPlayers, teams, seed, botLevel });

function expectValidOutcome(g: TestGameResult, teams: number) {
  const { auction } = g;
  // Every team holds a valid XI: 11 players, each in a slot he is eligible for.
  for (const t of auction.teams) {
    expect(t.roster).toHaveLength(11);
    expect(t.budgetM).toBeGreaterThanOrEqual(0);
    for (const slot of FORMATIONS[t.formation].slots) {
      const id = t.lineup[slot.key];
      expect(id, `${t.name} ${slot.key}`).toBeTruthy();
      expect(isEligible(auction.players[id!]!, slot.type)).toBe(true);
    }
    const spent = t.roster.reduce((s, r) => s + r.priceM, 0);
    expect(spent + t.budgetM).toBe(1000);
    expect(assignLineup(t.formation, t.roster.map((r) => auction.players[r.playerId]!)).valid).toBe(true);
  }
  // A player is sold to exactly one team, and the extras go unsold.
  const sold = auction.teams.flatMap((t) => t.roster.map((r) => r.playerId));
  expect(new Set(sold).size).toBe(sold.length);
  expect(sold).toHaveLength(teams * 11);
  const unsold = Object.values(auction.status).filter((s) => s === 'unsold').length;
  expect(unsold).toBe(g.pool.plan.totalSize - teams * 11);
  expect(Object.values(auction.status).filter((s) => s === 'available' || s === 'live')).toHaveLength(0);
  // League: always 20 teams and 380 fixtures over 38 matchdays.
  expect(g.league).toHaveLength(LEAGUE_SIZE);
  expect(g.aiClubIds).toHaveLength(LEAGUE_SIZE - teams);
  expect(g.season.fixtures).toHaveLength(380);
  expect(g.season.matchdays).toBe(38);
}

describe('bot auction', () => {
  it('finishes a 2-team game with valid XIs and 18 AI clubs', () => {
    expectValidOutcome(game(2, 1), 2);
  });

  it('finishes a 3-team game for each bot level', () => {
    for (const level of ['easy', 'medium', 'hard'] as const) expectValidOutcome(game(3, 7, level), 3);
  });

  it('finishes a 12-team game with exactly 8 AI clubs', () => {
    const g = game(12, 3);
    expectValidOutcome(g, 12);
    expect(g.pool.plan.totalSize).toBeGreaterThanOrEqual(132);
  });

  it('is deterministic for a seed and differs across seeds', () => {
    const a = game(3, 99);
    const b = game(3, 99);
    expect(b.auction.sales).toEqual(a.auction.sales);
    expect(b.season.table).toEqual(a.season.table);
    const c = game(3, 100);
    expect(c.auction.sales).not.toEqual(a.auction.sales);
  });

  it('keeps bought players out of every AI XI, and every AI club still fields 11', () => {
    for (const seed of [11, 12]) {
      const g = game(6, seed);
      const boughtNames = new Set(
        g.auction.teams.flatMap((t) => t.roster.map((r) => {
          const p = g.auction.players[r.playerId]!;
          return `${p.seedClub}|${p.name}|${p.overall}`;
        })),
      );
      for (const team of g.league.filter((t) => t.kind === 'ai')) {
        expect(team.players).toHaveLength(11);
        for (const p of team.players) {
          expect(boughtNames.has(`${team.id}|${p.name}|${p.baseOverall}`), `${p.name} still at ${team.name}`).toBe(false);
        }
      }
    }
  });

  it('spends a realistic share of the budget', () => {
    const g = game(3, 5);
    const spent = g.auction.teams.reduce((s, t) => s + (1000 - t.budgetM), 0);
    expect(spent / 3000).toBeGreaterThan(0.6);
  });
});
