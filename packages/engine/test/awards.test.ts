import { describe, expect, it } from 'vitest';
import {
  FORMATIONS,
  auctionGrade,
  computeAwards,
  impliedOverall,
  purchaseTag,
  runTestGame,
  slotGroup,
  positionGroup,
  DEFAULT_SLOT_COMPATIBILITY,
} from '../src';
import { realData } from './helpers';

describe('purchase tags', () => {
  it('tags steals, fair deals and overpays', () => {
    expect(purchaseTag(80, 100)).toBe('steal');
    expect(purchaseTag(81, 100)).toBe('fair');
    expect(purchaseTag(129, 100)).toBe('fair');
    expect(purchaseTag(130, 100)).toBe('overpay');
  });
});

describe('auction grades', () => {
  it('gives the strongest team that wins with full value an A+, and the reverse an F', () => {
    expect(auctionGrade({ preRank: 1, finalPosition: 1, startingBudgetM: 1000, xiMarketValueM: 1100 }).grade).toBe('A+');
    expect(auctionGrade({ preRank: 20, finalPosition: 20, startingBudgetM: 1000, xiMarketValueM: 300 }).grade).toBe('F');
  });

  it('previews a grade from the strength rank when the season has not been played', () => {
    const preview = auctionGrade({ preRank: 3, startingBudgetM: 1000, xiMarketValueM: 900 });
    expect(preview.finishScore).toBe(preview.strengthScore);
  });

  it('rewards finishing higher', () => {
    const base = { preRank: 5, startingBudgetM: 1000, xiMarketValueM: 900 };
    expect(auctionGrade({ ...base, finalPosition: 1 }).score).toBeGreaterThan(auctionGrade({ ...base, finalPosition: 10 }).score);
  });

  it('inverts the price curve', () => {
    expect(impliedOverall(60)).toBeCloseTo(80);
    expect(impliedOverall(133)).toBeCloseTo(91, 0);
  });
});

describe('season awards', () => {
  const data = realData();
  const g = runTestGame({ master: data.master, clubs: data.clubs, seedPlayers: data.seedPlayers, teams: 3, seed: 21 });
  const purchases = g.auction.teams.flatMap((t) =>
    t.roster.map((r) => ({ ref: `pool:${r.playerId}`, teamId: t.id, priceM: r.priceM, marketValueM: g.auction.players[r.playerId]!.marketValueM })),
  );
  const awards = computeAwards(g.season, purchases);
  const stats = g.season.playerStats;

  it('names the champion and the stat leaders', () => {
    expect(awards.championId).toBe(g.season.table[0]!.teamId);
    expect(awards.goldenBoot?.value).toBe(Math.max(...stats.map((s) => s.goals)));
    expect(awards.playmaker?.value).toBe(Math.max(...stats.map((s) => s.assists)));
    const gks = stats.filter((s) => s.slotType === 'GK');
    expect(awards.goldenGlove?.value).toBe(Math.max(...gks.map((s) => s.cleanSheets)));
    expect(stats.find((s) => s.ref === awards.goldenGlove?.ref)?.slotType).toBe('GK');
    expect(awards.playerOfTheSeason?.value).toBe(Math.max(...stats.map((s) => s.avgRating)));
  });

  it('picks a Team of the Season where every player can play his slot', () => {
    const tots = awards.teamOfTheSeason;
    expect(tots.slots).toHaveLength(11);
    expect(new Set(tots.slots.map((s) => s.ref)).size).toBe(11);
    for (const slot of tots.slots) {
      const stat = stats.find((s) => s.ref === slot.ref)!;
      const ok =
        DEFAULT_SLOT_COMPATIBILITY[slot.slotType].includes(stat.positions[0]!) ||
        stat.positions.some((p) => positionGroup(p) === slotGroup(slot.slotType));
      expect(ok, `${stat.name} at ${slot.slotKey}`).toBe(true);
    }
    expect(FORMATIONS[tots.formation].slots.map((s) => s.key)).toEqual(tots.slots.map((s) => s.slotKey));
  });

  it('picks a best buy and a biggest overpay among the purchases', () => {
    expect(awards.bestBuy).not.toBeNull();
    expect(awards.biggestOverpay).not.toBeNull();
    expect(awards.bestBuy!.gap).toBeGreaterThanOrEqual(awards.biggestOverpay!.gap);
    expect(purchases.some((p) => p.ref === awards.bestBuy!.ref)).toBe(true);
  });
});
