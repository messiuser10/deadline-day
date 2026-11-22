/**
 * One match (section 9, steps 5 and 6). Goals come from the match seed alone; events, cards and
 * ratings use a separate derived stream, so asking for events never changes a score.
 */
import type { SimParams } from './params';
import { DEFAULT_SIM_PARAMS } from './params';
import type { SlotType } from './positions';
import { Rng } from './rng';

export interface MatchPlayer {
  ref: string;
  slotType: SlotType;
  overall: number;
}

export interface MatchSide {
  id: string;
  attack: number;
  defense: number;
  players: readonly MatchPlayer[];
}

export interface LeagueAverages {
  attack: number;
  defense: number;
}

export type MatchEventType = 'goal' | 'assist' | 'yellow' | 'red';

export interface MatchEvent {
  minute: number;
  type: MatchEventType;
  playerRef: string;
  teamId: string;
}

export interface PlayerMatchLine {
  ref: string;
  teamId: string;
  slotType: SlotType;
  goals: number;
  assists: number;
  yellow: boolean;
  red: boolean;
  cleanSheet: boolean;
  rating: number;
}

export interface MatchResult {
  homeGoals: number;
  awayGoals: number;
  expected: { home: number; away: number };
  events: MatchEvent[];
  lines: PlayerMatchLine[];
}

export const SCORER_WEIGHTS: Record<SlotType, number> = {
  ST: 10,
  LW: 6,
  RW: 6,
  CAM: 5,
  LM: 4.5,
  RM: 4.5,
  CM: 2.5,
  CDM: 1,
  LB: 1,
  RB: 1,
  LWB: 1,
  RWB: 1,
  CB: 0.8,
  GK: 0.02,
};

export const ASSIST_WEIGHTS: Record<SlotType, number> = {
  CAM: 5,
  LW: 4.5,
  RW: 4.5,
  LM: 4,
  RM: 4,
  CM: 3.5,
  ST: 2.5,
  LB: 2,
  RB: 2,
  LWB: 2,
  RWB: 2,
  CDM: 1.5,
  CB: 0.6,
  GK: 0.1,
};

const CARD_WEIGHTS: Record<SlotType, number> = {
  CB: 1.5,
  CDM: 1.6,
  LB: 1.3,
  RB: 1.3,
  LWB: 1.3,
  RWB: 1.3,
  CM: 1.2,
  CAM: 0.8,
  LM: 0.9,
  RM: 0.9,
  LW: 0.8,
  RW: 0.8,
  ST: 0.9,
  GK: 0.3,
};

export const DEFENSIVE_SLOTS: ReadonlySet<SlotType> = new Set(['GK', 'CB', 'LB', 'RB', 'LWB', 'RWB']);
const YELLOWS_PER_TEAM = 1.7;
const RED_CHANCE_PER_TEAM = 0.05;
export const ASSIST_CHANCE = 0.75;
const MAX_MINUTE = 94;

export function expectedGoals(
  home: Pick<MatchSide, 'attack' | 'defense'>,
  away: Pick<MatchSide, 'attack' | 'defense'>,
  league: LeagueAverages,
  params: SimParams = DEFAULT_SIM_PARAMS,
): { home: number; away: number } {
  const s = params.sensitivity;
  return {
    home:
      params.baseGoals *
      params.homeAdvantage *
      Math.exp(s * (home.attack - league.attack - (away.defense - league.defense))),
    away: params.baseGoals * Math.exp(s * (away.attack - league.attack - (home.defense - league.defense))),
  };
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export function simulateMatch(
  home: MatchSide,
  away: MatchSide,
  league: LeagueAverages,
  params: SimParams,
  seed: number,
  options: { events?: boolean } = {},
): MatchResult {
  const rng = new Rng(seed);
  const xg = expectedGoals(home, away, league, params);
  const sigma = params.chaos * 0.2;
  const lamHome = clamp(xg.home * Math.exp(sigma * rng.normal()), 0.15, 4.5);
  const lamAway = clamp(xg.away * Math.exp(sigma * rng.normal()), 0.15, 4.5);
  const homeGoals = rng.poisson(lamHome);
  const awayGoals = rng.poisson(lamAway);
  if (!options.events) return { homeGoals, awayGoals, expected: xg, events: [], lines: [] };

  const ev = Rng.from(seed, 'events');
  const events: MatchEvent[] = [];
  const lines = new Map<string, PlayerMatchLine>();
  const sides = [
    { side: home, scored: homeGoals, conceded: awayGoals },
    { side: away, scored: awayGoals, conceded: homeGoals },
  ];
  for (const { side, scored, conceded } of sides) {
    for (const p of side.players) {
      lines.set(p.ref, {
        ref: p.ref,
        teamId: side.id,
        slotType: p.slotType,
        goals: 0,
        assists: 0,
        yellow: false,
        red: false,
        cleanSheet: conceded === 0 && DEFENSIVE_SLOTS.has(p.slotType),
        rating: 0,
      });
    }
    const quality = side.players.map((p) => (p.overall / 100) ** 2);
    const scorerW = side.players.map((p, i) => SCORER_WEIGHTS[p.slotType] * quality[i]!);
    for (let g = 0; g < scored; g++) {
      const minute = ev.int(1, MAX_MINUTE);
      const si = ev.weightedIndex(scorerW);
      if (si < 0) continue;
      const scorer = side.players[si]!;
      events.push({ minute, type: 'goal', playerRef: scorer.ref, teamId: side.id });
      lines.get(scorer.ref)!.goals++;
      if (ev.chance(ASSIST_CHANCE)) {
        const assistW = side.players.map((p, i) => (i === si ? 0 : ASSIST_WEIGHTS[p.slotType] * quality[i]!));
        const ai = ev.weightedIndex(assistW);
        if (ai >= 0) {
          const assister = side.players[ai]!;
          events.push({ minute, type: 'assist', playerRef: assister.ref, teamId: side.id });
          lines.get(assister.ref)!.assists++;
        }
      }
    }
    const cardW = side.players.map((p) => CARD_WEIGHTS[p.slotType]);
    const yellows = ev.poisson(YELLOWS_PER_TEAM);
    for (let y = 0; y < yellows; y++) {
      const i = ev.weightedIndex(cardW);
      const p = side.players[i]!;
      const line = lines.get(p.ref)!;
      if (line.yellow || line.red) continue;
      line.yellow = true;
      events.push({ minute: ev.int(1, MAX_MINUTE), type: 'yellow', playerRef: p.ref, teamId: side.id });
    }
    if (ev.chance(RED_CHANCE_PER_TEAM)) {
      const p = side.players[ev.weightedIndex(cardW)]!;
      const line = lines.get(p.ref)!;
      if (!line.red) {
        line.red = true;
        events.push({ minute: ev.int(1, MAX_MINUTE), type: 'red', playerRef: p.ref, teamId: side.id });
      }
    }
  }

  // Match rating: 6.0 + 1.0/goal + 0.6/assist + 0.3 win + 0.6 clean sheet (GK and defenders) + noise.
  for (const { side, scored, conceded } of sides) {
    const won = scored > conceded;
    for (const p of side.players) {
      const line = lines.get(p.ref)!;
      const raw =
        6.0 + line.goals * 1.0 + line.assists * 0.6 + (won ? 0.3 : 0) + (line.cleanSheet ? 0.6 : 0) + ev.normal() * 0.4;
      line.rating = Math.round(clamp(raw, 4.0, 10.0) * 100) / 100;
    }
  }

  const order: Record<MatchEventType, number> = { goal: 0, assist: 1, yellow: 2, red: 3 };
  events.sort((a, b) => a.minute - b.minute || order[a.type] - order[b.type]);
  return { homeGoals, awayGoals, expected: xg, events, lines: [...lines.values()] };
}
