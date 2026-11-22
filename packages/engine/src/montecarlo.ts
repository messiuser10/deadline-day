/**
 * Monte Carlo ("Expected Strength") and multi-season runs (sections 9 and 10).
 */
import type { SimParams } from './params';
import { simulateSeason, type LeagueTeam, type StandingRow } from './season';
import { deriveSeed } from './rng';

export interface MonteCarloTeam {
  teamId: string;
  name: string;
  avgPoints: number;
  avgPosition: number;
  titleChance: number;
  top4Chance: number;
  bottom3Chance: number;
  /** positionCounts[i] = seasons finished in position i + 1. */
  positionCounts: number[];
}

export interface MonteCarloResult {
  runs: number;
  goalsPerMatch: number;
  teams: MonteCarloTeam[];
}

export function monteCarlo(
  teams: readonly LeagueTeam[],
  options: { seed: number; runs?: number; params?: Partial<SimParams> },
): MonteCarloResult {
  const runs = options.runs ?? 1000;
  const n = teams.length;
  const acc = new Map(
    teams.map((t) => [t.id, { points: 0, positions: 0, counts: new Array<number>(n).fill(0) }]),
  );
  let goals = 0;
  let matches = 0;
  for (let i = 0; i < runs; i++) {
    const season = simulateSeason({
      teams,
      seed: deriveSeed(options.seed, 'montecarlo', i),
      params: options.params,
      options: { events: false, snapshots: false },
    });
    goals += season.totalGoals;
    matches += season.fixtures.length;
    for (const row of season.table) {
      const a = acc.get(row.teamId)!;
      a.points += row.points;
      a.positions += row.position;
      a.counts[row.position - 1]!++;
    }
  }
  const out = teams.map((t) => {
    const a = acc.get(t.id)!;
    const share = (from: number, to: number) => a.counts.slice(from, to).reduce((s, v) => s + v, 0) / runs;
    return {
      teamId: t.id,
      name: t.name,
      avgPoints: a.points / runs,
      avgPosition: a.positions / runs,
      titleChance: share(0, 1),
      top4Chance: share(0, 4),
      bottom3Chance: share(n - 3, n),
      positionCounts: a.counts,
    };
  });
  out.sort((x, y) => y.avgPoints - x.avgPoints || x.avgPosition - y.avgPosition);
  return { runs, goalsPerMatch: matches ? goals / matches : 0, teams: out };
}

export interface MultiSeasonEntry {
  seasonNumber: number;
  seed: number;
  championId: string;
  table: StandingRow[];
}

export interface TitlesRow {
  teamId: string;
  name: string;
  titles: number;
  avgPoints: number;
  avgPosition: number;
  bestFinish: number;
}

/** Same teams, a new seed per season (2 to 10), with a cumulative titles table. */
export function simulateMultiSeason(
  teams: readonly LeagueTeam[],
  options: { seed: number; seasons: number; params?: Partial<SimParams> },
): { seasons: MultiSeasonEntry[]; titles: TitlesRow[] } {
  const count = Math.max(1, Math.floor(options.seasons));
  const seasons: MultiSeasonEntry[] = [];
  for (let k = 1; k <= count; k++) {
    const seed = deriveSeed(options.seed, 'season', k);
    const s = simulateSeason({ teams, seed, params: options.params, options: { events: false, snapshots: false } });
    seasons.push({ seasonNumber: k, seed, championId: s.championId, table: s.table });
  }
  const titles = teams.map((t) => {
    const rows = seasons.map((s) => s.table.find((r) => r.teamId === t.id)!);
    return {
      teamId: t.id,
      name: t.name,
      titles: seasons.filter((s) => s.championId === t.id).length,
      avgPoints: rows.reduce((s, r) => s + r.points, 0) / rows.length,
      avgPosition: rows.reduce((s, r) => s + r.position, 0) / rows.length,
      bestFinish: Math.min(...rows.map((r) => r.position)),
    };
  });
  titles.sort((a, b) => b.titles - a.titles || a.avgPosition - b.avgPosition);
  return { seasons, titles };
}
