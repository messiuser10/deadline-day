/**
 * Pool sizing (section 5). Counts main positions only: alternates add flexibility, never supply.
 *
 *   need[g]  = total slots of group g across every team's formation
 *   extra[g] = max(extra_min, ceil(extra_pct * need[g]))
 *   pool[g]  = need[g] + extra[g]
 */
import { FORMATION_IDS, formationGroupCounts, emptyGroupCounts, type FormationId, type GroupCounts } from './formations';
import { GROUPS, type Group } from './positions';

export interface PoolParams {
  extraMin: number;
  extraPct: number;
}

export const DEFAULT_POOL_PARAMS: PoolParams = {
  extraMin: 2,
  extraPct: 0.15,
};

export const MIN_TEAMS = 2;
export const MAX_TEAMS = 12;
export const LEAGUE_SIZE = 20;

export function extraFor(need: number, params: PoolParams = DEFAULT_POOL_PARAMS): number {
  if (need <= 0) return 0;
  // Round the product to 9 decimals first so 0.15 * 20 is exactly 3, not 3.0000000000000004.
  const scaled = Math.round(params.extraPct * need * 1e9) / 1e9;
  return Math.max(params.extraMin, Math.ceil(scaled));
}

export interface GroupPlan {
  group: Group;
  need: number;
  extra: number;
  size: number;
}

export interface PoolPlan {
  groups: GroupPlan[];
  totalNeed: number;
  totalExtra: number;
  totalSize: number;
}

/** Need per group for a list of team formations (one entry per team). */
export function groupNeeds(formations: readonly FormationId[]): GroupCounts {
  const need = emptyGroupCounts();
  for (const f of formations) {
    const counts = formationGroupCounts(f);
    for (const g of GROUPS) need[g] += counts[g];
  }
  return need;
}

export function planFromNeeds(need: GroupCounts, params: PoolParams = DEFAULT_POOL_PARAMS): PoolPlan {
  const groups = GROUPS.map((group) => {
    const n = need[group];
    const extra = extraFor(n, params);
    return { group, need: n, extra, size: n + extra };
  });
  return {
    groups,
    totalNeed: groups.reduce((s, g) => s + g.need, 0),
    totalExtra: groups.reduce((s, g) => s + g.extra, 0),
    totalSize: groups.reduce((s, g) => s + g.size, 0),
  };
}

export function poolPlan(formations: readonly FormationId[], params: PoolParams = DEFAULT_POOL_PARAMS): PoolPlan {
  return planFromNeeds(groupNeeds(formations), params);
}

/**
 * Worst case for a team count: every team in the formation that is heaviest for each group,
 * taken group by group (so this is an upper bound no real lobby can exceed).
 */
export function worstCaseNeeds(
  teams: number,
  enabled: readonly FormationId[] = FORMATION_IDS,
): GroupCounts {
  const need = emptyGroupCounts();
  for (const g of GROUPS) {
    const heaviest = Math.max(0, ...enabled.map((f) => formationGroupCounts(f)[g]));
    need[g] = heaviest * teams;
  }
  return need;
}

export interface PoolCandidate {
  id: string;
  position: Group;
  overall: number;
  positionRank: number;
  isActive?: boolean;
}

export interface GroupSelection extends GroupPlan {
  /** Players actually taken (less than size only when the master pool is short). */
  taken: number;
  minOverall: number | null;
  maxOverall: number | null;
}

export interface AuctionPoolBuild<T extends PoolCandidate> {
  plan: PoolPlan;
  groups: GroupSelection[];
  players: T[];
  shortfalls: SupplyShortfall[];
}

/**
 * pool[g] = the best (need[g] + extra[g]) active players whose main position is g,
 * by overall, ties by position_rank (then id, so the result is fully deterministic).
 */
export function buildAuctionPool<T extends PoolCandidate>(
  master: readonly T[],
  formations: readonly FormationId[],
  params: PoolParams = DEFAULT_POOL_PARAMS,
): AuctionPoolBuild<T> {
  const plan = poolPlan(formations, params);
  const byGroup = new Map<Group, T[]>();
  for (const p of master) {
    if (p.isActive === false) continue;
    const list = byGroup.get(p.position) ?? [];
    list.push(p);
    byGroup.set(p.position, list);
  }
  const players: T[] = [];
  const groups: GroupSelection[] = [];
  const shortfalls: SupplyShortfall[] = [];
  for (const g of plan.groups) {
    const ranked = (byGroup.get(g.group) ?? [])
      .slice()
      .sort((a, b) => b.overall - a.overall || a.positionRank - b.positionRank || a.id.localeCompare(b.id));
    const taken = ranked.slice(0, g.size);
    players.push(...taken);
    if (taken.length < g.size) shortfalls.push({ group: g.group, required: g.size, available: taken.length });
    groups.push({
      ...g,
      taken: taken.length,
      maxOverall: taken.length ? taken[0]!.overall : null,
      minOverall: taken.length ? taken[taken.length - 1]!.overall : null,
    });
  }
  return { plan, groups, players, shortfalls };
}

export interface SupplyShortfall {
  group: Group;
  required: number;
  available: number;
}

/** Groups where the master pool (counted by main position) has fewer players than the plan needs. */
export function supplyShortfalls(plan: PoolPlan, masterCountByGroup: Partial<Record<Group, number>>): SupplyShortfall[] {
  return plan.groups
    .filter((g) => (masterCountByGroup[g.group] ?? 0) < g.size)
    .map((g) => ({ group: g.group, required: g.size, available: masterCountByGroup[g.group] ?? 0 }));
}
