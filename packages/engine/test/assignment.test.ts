import { describe, expect, it } from 'vitest';
import { FORBIDDEN, Rng, buildAuctionPool, hungarian, maxBipartiteMatching, poolPlan, type PoolCandidate } from '../src';
import { realData } from './helpers';

/** Brute force: minimum total cost over every injective row -> column map. */
function bruteForce(cost: number[][]): number {
  const cols = cost[0]!.length;
  let best = Infinity;
  const used = new Array<boolean>(cols).fill(false);
  const walk = (row: number, total: number) => {
    if (row === cost.length) {
      best = Math.min(best, total);
      return;
    }
    for (let c = 0; c < cols; c++) {
      if (used[c]) continue;
      used[c] = true;
      walk(row + 1, total + cost[row]![c]!);
      used[c] = false;
    }
  };
  walk(0, 0);
  return best;
}

describe('hungarian', () => {
  it('matches brute force on random square and rectangular matrices', () => {
    const rng = new Rng(17);
    for (let trial = 0; trial < 200; trial++) {
      const rows = rng.int(1, 5);
      const cols = rng.int(rows, 6);
      const cost = Array.from({ length: rows }, () => Array.from({ length: cols }, () => rng.int(0, 50)));
      const assignment = hungarian(cost);
      expect(new Set(assignment).size).toBe(rows);
      const total = assignment.reduce((s, c, r) => s + cost[r]![c]!, 0);
      expect(total).toBe(bruteForce(cost));
    }
  });

  it('avoids forbidden cells when a legal assignment exists', () => {
    const cost = [
      [FORBIDDEN, 1, FORBIDDEN],
      [2, FORBIDDEN, FORBIDDEN],
      [FORBIDDEN, FORBIDDEN, 3],
    ];
    expect(hungarian(cost)).toEqual([1, 0, 2]);
  });
});

describe('maxBipartiteMatching', () => {
  it('finds the maximum matching through augmenting paths', () => {
    // A greedy pass would take 0-0 and leave 1 unmatched; augmenting fixes it.
    expect(maxBipartiteMatching([[0, 1], [0]], 2).size).toBe(2);
    // Two left nodes that can only use the same right node.
    expect(maxBipartiteMatching([[0], [0], [1]], 2).size).toBe(2);
    expect(maxBipartiteMatching([[]], 1)).toEqual({ size: 0, matchOfLeft: [-1] });
  });
});

describe('buildAuctionPool', () => {
  const data = realData();

  it('takes each group\'s best players by overall, breaking ties by position rank', () => {
    const build = buildAuctionPool(data.master, ['4-3-3', '4-3-3', '4-3-3']);
    expect(build.shortfalls).toEqual([]);
    expect(build.players).toHaveLength(build.plan.totalSize);
    for (const g of build.groups.filter((x) => x.size > 0)) {
      const taken = build.players.filter((p) => p.position === g.group);
      expect(taken).toHaveLength(g.size);
      const rest = data.master.filter((p) => p.position === g.group && !taken.includes(p));
      const worst = taken[taken.length - 1]!;
      for (const p of rest) {
        expect(p.overall < worst.overall || (p.overall === worst.overall && p.positionRank > worst.positionRank)).toBe(true);
      }
    }
  });

  it('always includes the top of every group, even for 12 teams', () => {
    const build = buildAuctionPool(data.master, Array(12).fill('4-3-3'));
    expect(build.shortfalls).toEqual([]);
    for (const g of build.groups.filter((x) => x.size > 0)) {
      const ranks = build.players.filter((p) => p.position === g.group).map((p) => p.positionRank);
      // The group's number 1 is always in the pool.
      expect(ranks).toContain(1);
    }
  });

  it('skips inactive players and reports a shortfall', () => {
    const tiny: PoolCandidate[] = [
      { id: 'a', position: 'GK', overall: 90, positionRank: 1 },
      { id: 'b', position: 'GK', overall: 95, positionRank: 2, isActive: false },
    ];
    const build = buildAuctionPool(tiny, ['4-3-3', '4-3-3']);
    expect(build.players.map((p) => p.id)).toEqual(['a']);
    const gk = poolPlan(['4-3-3', '4-3-3']).groups.find((g) => g.group === 'GK')!;
    expect(build.shortfalls).toContainEqual({ group: 'GK', required: gk.size, available: 1 });
  });
});
