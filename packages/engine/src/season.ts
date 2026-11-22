/**
 * A full season (section 9): rate 20 teams, generate 380 fixtures, simulate every match, keep a
 * table snapshot after every matchday and per-player season stats. Fully deterministic from the seed.
 */
import { generateFixtures, type Fixture } from './fixtures';
import type { FormationId } from './formations';
import { simulateMatch, type LeagueAverages, type MatchEvent, type MatchSide } from './match';
import { withSimDefaults, type SimParams } from './params';
import type { Position, SlotType } from './positions';
import { teamRatings } from './ratings';
import { Rng, deriveSeed } from './rng';

export type TeamKind = 'human' | 'bot' | 'ai';

export interface LeaguePlayer {
  /** pool:<id>, seed:<id> or reserve:<team>:<slot>. */
  ref: string;
  name: string;
  slotKey: string;
  slotType: SlotType;
  /** Effective overall in this slot. */
  overall: number;
  /** Overall before any out-of-position penalty. */
  baseOverall: number;
  /** Main position first, then alternates. */
  positions: Position[];
  club: string | null;
  nationality: string | null;
  outOfPosition: boolean;
  reserve: boolean;
}

export interface LeagueTeam {
  id: string;
  name: string;
  kind: TeamKind;
  formation: FormationId;
  players: LeaguePlayer[];
  primaryColor?: string;
  secondaryColor?: string;
}

export interface RatedTeam {
  id: string;
  name: string;
  kind: TeamKind;
  formation: FormationId;
  attack: number;
  defense: number;
  chemistry: number;
}

export interface StandingRow {
  teamId: string;
  played: number;
  won: number;
  drawn: number;
  lost: number;
  goalsFor: number;
  goalsAgainst: number;
  goalDifference: number;
  points: number;
  position: number;
  /** Last five results, oldest first, e.g. "WWDLW". */
  form: string;
}

export interface FixtureResult extends Fixture {
  homeGoals: number;
  awayGoals: number;
  events: MatchEvent[];
}

export interface PlayerSeasonStat {
  ref: string;
  name: string;
  teamId: string;
  slotType: SlotType;
  positions: Position[];
  baseOverall: number;
  appearances: number;
  goals: number;
  assists: number;
  cleanSheets: number;
  yellows: number;
  reds: number;
  ratingSum: number;
  avgRating: number;
}

export interface SeasonOptions {
  /** Goal scorers, assists, cards, ratings and player stats (default true). */
  events?: boolean;
  /** A table snapshot after every matchday (default true). */
  snapshots?: boolean;
}

export interface SeasonInput {
  teams: readonly LeagueTeam[];
  seed: number;
  params?: Partial<SimParams>;
  options?: SeasonOptions;
}

export interface SeasonResult {
  seed: number;
  params: SimParams;
  teams: RatedTeam[];
  fixtures: FixtureResult[];
  /** standings[i] is the table after matchday i + 1 (empty when snapshots are off). */
  standings: StandingRow[][];
  table: StandingRow[];
  playerStats: PlayerSeasonStat[];
  championId: string;
  matchdays: number;
  totalGoals: number;
  goalsPerMatch: number;
  homeWins: number;
  draws: number;
  awayWins: number;
}

export const INJURY_CHANCE = 0.01;

export function rateTeams(teams: readonly LeagueTeam[], params: SimParams): RatedTeam[] {
  return teams.map((t) => ({
    id: t.id,
    name: t.name,
    kind: t.kind,
    formation: t.formation,
    ...teamRatings(t.players, { chemistry: params.chemistry }),
  }));
}

export function leagueAverages(rated: readonly Pick<RatedTeam, 'attack' | 'defense'>[]): LeagueAverages {
  return {
    attack: rated.reduce((s, t) => s + t.attack, 0) / rated.length,
    defense: rated.reduce((s, t) => s + t.defense, 0) / rated.length,
  };
}

interface Acc {
  teamId: string;
  played: number;
  won: number;
  drawn: number;
  lost: number;
  goalsFor: number;
  goalsAgainst: number;
  points: number;
  results: string[];
}

/** Sort the table: points, then each tiebreaker in order, then a seeded random draw. */
export function rankTable(
  accs: readonly Acc[],
  results: readonly { homeId: string; awayId: string; homeGoals: number; awayGoals: number }[],
  params: SimParams,
  drawKey: (teamId: string) => number,
): StandingRow[] {
  const h2hPoints = (group: readonly Acc[]): Map<string, number> => {
    const ids = new Set(group.map((a) => a.teamId));
    const pts = new Map<string, number>(group.map((a) => [a.teamId, 0]));
    for (const r of results) {
      if (!ids.has(r.homeId) || !ids.has(r.awayId)) continue;
      const [h, a] =
        r.homeGoals > r.awayGoals
          ? [params.points.win, params.points.loss]
          : r.homeGoals < r.awayGoals
            ? [params.points.loss, params.points.win]
            : [params.points.draw, params.points.draw];
      pts.set(r.homeId, pts.get(r.homeId)! + h);
      pts.set(r.awayId, pts.get(r.awayId)! + a);
    }
    return pts;
  };

  const keyFor = (criterion: string, group: readonly Acc[]): ((a: Acc) => number) => {
    switch (criterion) {
      case 'points':
        return (a) => a.points;
      case 'goal_difference':
        return (a) => a.goalsFor - a.goalsAgainst;
      case 'goals_for':
        return (a) => a.goalsFor;
      case 'head_to_head': {
        const pts = h2hPoints(group);
        return (a) => pts.get(a.teamId) ?? 0;
      }
      default:
        return (a) => drawKey(a.teamId);
    }
  };

  const criteria = ['points', ...params.tiebreakers, 'draw'];
  const order = (group: Acc[], level: number): Acc[] => {
    if (group.length <= 1 || level >= criteria.length) return group;
    const key = keyFor(criteria[level]!, group);
    const sorted = [...group].sort((a, b) => key(b) - key(a));
    const out: Acc[] = [];
    let i = 0;
    while (i < sorted.length) {
      let j = i + 1;
      while (j < sorted.length && key(sorted[j]!) === key(sorted[i]!)) j++;
      out.push(...order(sorted.slice(i, j), level + 1));
      i = j;
    }
    return out;
  };

  return order([...accs], 0).map((a, i) => ({
    teamId: a.teamId,
    played: a.played,
    won: a.won,
    drawn: a.drawn,
    lost: a.lost,
    goalsFor: a.goalsFor,
    goalsAgainst: a.goalsAgainst,
    goalDifference: a.goalsFor - a.goalsAgainst,
    points: a.points,
    position: i + 1,
    form: a.results.slice(-5).join(''),
  }));
}

export function simulateSeason(input: SeasonInput): SeasonResult {
  const params = withSimDefaults(input.params);
  const withEvents = input.options?.events ?? true;
  const withSnapshots = input.options?.snapshots ?? true;
  const teams = input.teams;
  if (new Set(teams.map((t) => t.id)).size !== teams.length) throw new Error('Team ids must be unique');

  const rated = rateTeams(teams, params);
  const ratedById = new Map(rated.map((r) => [r.id, r]));
  const league = leagueAverages(rated);
  const teamById = new Map(teams.map((t) => [t.id, t]));
  const fixtures = generateFixtures(
    teams.map((t) => t.id),
    deriveSeed(input.seed, 'fixtures'),
  );
  const matchdays = fixtures.reduce((m, f) => Math.max(m, f.matchday), 0);
  const byMatchday: Fixture[][] = Array.from({ length: matchdays }, () => []);
  for (const f of fixtures) byMatchday[f.matchday - 1]!.push(f);

  // Injuries (off by default): a player misses the next 1-5 matches, replaced by a reserve 10 below him.
  const injuredUntil = new Map<string, number>();
  const sideFor = (teamId: string, matchday: number): { side: MatchSide; players: LeaguePlayer[] } => {
    const team = teamById.get(teamId)!;
    const base = ratedById.get(teamId)!;
    if (!params.injuries) return { side: { id: teamId, attack: base.attack, defense: base.defense, players: team.players }, players: team.players };
    let changed = false;
    const players = team.players.map((p) => {
      if ((injuredUntil.get(`${teamId}|${p.ref}`) ?? 0) <= matchday) return p;
      changed = true;
      return {
        ...p,
        ref: `reserve:${teamId}:${p.slotKey}`,
        name: `${p.name} (reserve cover)`,
        overall: p.overall - 10,
        baseOverall: p.baseOverall - 10,
        club: null,
        nationality: null,
        reserve: true,
      };
    });
    if (!changed) return { side: { id: teamId, attack: base.attack, defense: base.defense, players }, players };
    const r = teamRatings(players, { chemistry: params.chemistry });
    return { side: { id: teamId, attack: r.attack, defense: r.defense, players }, players };
  };

  const accs = new Map<string, Acc>(
    teams.map((t) => [
      t.id,
      { teamId: t.id, played: 0, won: 0, drawn: 0, lost: 0, goalsFor: 0, goalsAgainst: 0, points: 0, results: [] },
    ]),
  );
  const drawKeys = new Map(teams.map((t) => [t.id, Rng.from(input.seed, 'tiebreak', t.id).next()]));
  const drawKey = (id: string) => drawKeys.get(id) ?? 0;
  const stats = new Map<string, PlayerSeasonStat>();
  const results: FixtureResult[] = [];
  const standings: StandingRow[][] = [];
  let homeWins = 0;
  let draws = 0;
  let awayWins = 0;
  let totalGoals = 0;

  const record = (acc: Acc, gf: number, ga: number) => {
    acc.played++;
    acc.goalsFor += gf;
    acc.goalsAgainst += ga;
    if (gf > ga) {
      acc.won++;
      acc.points += params.points.win;
      acc.results.push('W');
    } else if (gf < ga) {
      acc.lost++;
      acc.points += params.points.loss;
      acc.results.push('L');
    } else {
      acc.drawn++;
      acc.points += params.points.draw;
      acc.results.push('D');
    }
  };

  for (let md = 1; md <= matchdays; md++) {
    for (const f of byMatchday[md - 1]!) {
      const home = sideFor(f.homeId, md);
      const away = sideFor(f.awayId, md);
      const seed = deriveSeed(input.seed, md, f.homeId, f.awayId);
      const res = simulateMatch(home.side, away.side, league, params, seed, { events: withEvents });
      results.push({ ...f, homeGoals: res.homeGoals, awayGoals: res.awayGoals, events: res.events });
      record(accs.get(f.homeId)!, res.homeGoals, res.awayGoals);
      record(accs.get(f.awayId)!, res.awayGoals, res.homeGoals);
      totalGoals += res.homeGoals + res.awayGoals;
      if (res.homeGoals > res.awayGoals) homeWins++;
      else if (res.homeGoals < res.awayGoals) awayWins++;
      else draws++;

      if (withEvents) {
        const meta = new Map<string, LeaguePlayer>([...home.players, ...away.players].map((p) => [p.ref, p]));
        for (const line of res.lines) {
          const p = meta.get(line.ref)!;
          let s = stats.get(line.ref);
          if (!s) {
            s = {
              ref: line.ref,
              name: p.name,
              teamId: line.teamId,
              slotType: line.slotType,
              positions: p.positions,
              baseOverall: p.baseOverall,
              appearances: 0,
              goals: 0,
              assists: 0,
              cleanSheets: 0,
              yellows: 0,
              reds: 0,
              ratingSum: 0,
              avgRating: 0,
            };
            stats.set(line.ref, s);
          }
          s.appearances++;
          s.goals += line.goals;
          s.assists += line.assists;
          s.cleanSheets += line.cleanSheet ? 1 : 0;
          s.yellows += line.yellow ? 1 : 0;
          s.reds += line.red ? 1 : 0;
          s.ratingSum += line.rating;
        }
      }

      if (params.injuries) {
        for (const [teamId, side] of [
          [f.homeId, home],
          [f.awayId, away],
        ] as const) {
          const injRng = Rng.from(input.seed, 'injury', md, teamId);
          for (const p of side.players) {
            if (p.reserve) continue;
            if (injRng.chance(INJURY_CHANCE)) injuredUntil.set(`${teamId}|${p.ref}`, md + injRng.int(1, 5) + 1);
          }
        }
      }
    }
    if (withSnapshots) standings.push(rankTable([...accs.values()], results, params, drawKey));
  }

  const table = withSnapshots ? standings[standings.length - 1]! : rankTable([...accs.values()], results, params, drawKey);
  const playerStats = [...stats.values()].map((s) => ({
    ...s,
    ratingSum: Math.round(s.ratingSum * 100) / 100,
    avgRating: s.appearances ? Math.round((s.ratingSum / s.appearances) * 100) / 100 : 0,
  }));
  return {
    seed: input.seed,
    params,
    teams: rated,
    fixtures: results,
    standings,
    table,
    playerStats,
    championId: table[0]!.teamId,
    matchdays,
    totalGoals,
    goalsPerMatch: results.length ? totalGoals / results.length : 0,
    homeWins,
    draws,
    awayWins,
  };
}
