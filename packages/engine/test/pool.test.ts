import { describe, expect, it } from 'vitest';
import {
  FORMATION_IDS,
  GROUPS,
  MAX_TEAMS,
  extraFor,
  formationGroupCounts,
  groupNeeds,
  planFromNeeds,
  poolPlan,
  supplyShortfalls,
  worstCaseNeeds,
  validateData,
  type FormationId,
} from '../src';
import { loadDataInput } from './fixtures';

const all433 = (n: number): FormationId[] => Array.from({ length: n }, () => '4-3-3');

describe('pool sizing', () => {
  it('builds the spec example pool sizes for all-4-3-3 games', () => {
    const two = poolPlan(all433(2));
    expect(two.totalNeed).toBe(22);
    expect(two.totalExtra).toBe(18);
    expect(two.totalSize).toBe(40);
    expect(poolPlan(all433(3)).totalSize).toBe(51);
    expect(poolPlan(all433(6)).totalSize).toBe(84);
    const twelve = poolPlan(all433(12));
    expect(twelve.totalNeed).toBe(132);
    expect(twelve.totalExtra).toBe(22);
    expect(twelve.totalSize).toBe(154);
  });

  it('computes extra as max(extra_min, ceil(extra_pct * need))', () => {
    expect(extraFor(0)).toBe(0);
    expect(extraFor(1)).toBe(2);
    expect(extraFor(13)).toBe(2);
    expect(extraFor(14)).toBe(3);
    expect(extraFor(20)).toBe(3); // 0.15 * 20 is exactly 3, no float creep to 4
    expect(extraFor(24)).toBe(4);
    expect(extraFor(10, { extraMin: 1, extraPct: 0.5 })).toBe(5);
  });

  it('follows the formula for mixed formations', () => {
    const formations: FormationId[] = ['4-3-3', '3-5-2', '4-2-3-1', '5-4-1'];
    const plan = poolPlan(formations);
    for (const g of plan.groups) {
      const need = formations.reduce((s, f) => s + formationGroupCounts(f)[g.group], 0);
      expect(g.need).toBe(need);
      expect(g.extra).toBe(need === 0 ? 0 : Math.max(2, Math.ceil(0.15 * need - 1e-9)));
      expect(g.size).toBe(g.need + g.extra);
    }
    expect(plan.totalNeed).toBe(44);
    expect(plan.totalSize).toBe(plan.groups.reduce((s, g) => s + g.size, 0));
  });

  it('counts the LWB and RWB slots as LB and RB', () => {
    const need = groupNeeds(['3-5-2', '5-3-2']);
    expect(need.LB).toBe(2);
    expect(need.RB).toBe(2);
    expect(need.CB).toBe(6);
  });

  it('has enough master players in every group for 12 teams in the worst case', () => {
    const report = validateData(loadDataInput());
    const worst = planFromNeeds(worstCaseNeeds(MAX_TEAMS, FORMATION_IDS));
    expect(supplyShortfalls(worst, report.masterByGroup)).toEqual([]);
    for (const g of GROUPS) {
      const heaviest = Math.max(...FORMATION_IDS.map((f) => formationGroupCounts(f)[g]));
      expect(worst.groups.find((x) => x.group === g)?.need).toBe(heaviest * MAX_TEAMS);
    }
  });

  it('reports a shortfall when the master pool is too thin', () => {
    const plan = poolPlan(all433(12));
    expect(supplyShortfalls(plan, { GK: 10 })).toContainEqual({ group: 'GK', required: 14, available: 10 });
  });
});
