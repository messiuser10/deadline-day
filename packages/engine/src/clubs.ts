/**
 * AI clubs (sections 1 and 9): best XI under the compatibility map, club strength, which clubs join
 * the league, and removing bought players from their squads.
 */
import { hungarian } from './assignment';
import { FORMATION_IDS, FORMATIONS, type FormationId } from './formations';
import { DEFAULT_SLOT_COMPATIBILITY, type Position, type SlotCompatibility, type SlotType } from './positions';
import { DEFAULT_SIM_PARAMS } from './params';
import { normalizeName } from './text';

export interface SquadPlayer {
  id: string;
  name: string;
  position: Position;
  altPositions: readonly Position[];
  overall: number;
  nationality?: string | null;
}

export interface ClubSquad {
  id: string;
  name: string;
  squad: readonly SquadPlayer[];
}

export interface XiSlot {
  slotKey: string;
  slotType: SlotType;
  /** null for a generic Academy Reserve. */
  player: SquadPlayer | null;
  effectiveOverall: number;
  outOfPosition: boolean;
  reserve: boolean;
}

export interface BestXi {
  formation: FormationId;
  slots: XiSlot[];
  average: number;
  outOfPositionCount: number;
  reserveCount: number;
}

export interface XiOptions {
  formations?: readonly FormationId[];
  compatibility?: SlotCompatibility;
  outOfPositionPenalty?: number;
  reserveRating?: number;
}

const COMPATIBLE = 1000;
const OUT_OF_POSITION = 500;
const NOT_ALLOWED = 1e6;

/**
 * A player is compatible with a slot when the slot accepts his listed main position.
 * Weights make the assignment lexicographic: most compatible slots first, then out-of-position
 * outfielders (overall - penalty) for slots nobody compatible is left for, then Academy Reserves,
 * and within that the highest total overall.
 */
function bestXiForFormation(
  squad: readonly SquadPlayer[],
  formation: FormationId,
  compat: SlotCompatibility,
  penalty: number,
  reserveRating: number,
): { xi: BestXi; score: number } {
  const slots = FORMATIONS[formation].slots;
  const weight = (slotType: SlotType, p: SquadPlayer): number | null => {
    if (compat[slotType].includes(p.position)) return COMPATIBLE + p.overall;
    if (p.position !== 'GK') return OUT_OF_POSITION + p.overall - penalty;
    return null;
  };
  const cost = slots.map((slot) => {
    const row = squad.map((p) => {
      const w = weight(slot.type, p);
      return w === null ? NOT_ALLOWED : -w;
    });
    for (let r = 0; r < slots.length; r++) row.push(-reserveRating);
    return row;
  });
  const choice = hungarian(cost);
  let score = 0;
  const xiSlots: XiSlot[] = slots.map((slot, i) => {
    const col = choice[i]!;
    score -= cost[i]![col]!;
    if (col >= squad.length || cost[i]![col]! >= NOT_ALLOWED) {
      return { slotKey: slot.key, slotType: slot.type, player: null, effectiveOverall: reserveRating, outOfPosition: false, reserve: true };
    }
    const p = squad[col]!;
    const compatible = compat[slot.type].includes(p.position);
    return {
      slotKey: slot.key,
      slotType: slot.type,
      player: p,
      effectiveOverall: compatible ? p.overall : p.overall - penalty,
      outOfPosition: !compatible,
      reserve: false,
    };
  });
  const average = xiSlots.reduce((s, x) => s + x.effectiveOverall, 0) / xiSlots.length;
  return {
    score,
    xi: {
      formation,
      slots: xiSlots,
      average,
      outOfPositionCount: xiSlots.filter((x) => x.outOfPosition).length,
      reserveCount: xiSlots.filter((x) => x.reserve).length,
    },
  };
}

/** Try every enabled formation and keep the best XI. */
export function pickBestXi(squad: readonly SquadPlayer[], options: XiOptions = {}): BestXi {
  const formations = options.formations?.length ? options.formations : FORMATION_IDS;
  const compat = options.compatibility ?? DEFAULT_SLOT_COMPATIBILITY;
  const penalty = options.outOfPositionPenalty ?? DEFAULT_SIM_PARAMS.outOfPositionPenalty;
  const reserve = options.reserveRating ?? DEFAULT_SIM_PARAMS.reserveRating;
  let best: { xi: BestXi; score: number } | null = null;
  for (const f of formations) {
    const res = bestXiForFormation(squad, f, compat, penalty, reserve);
    if (!best || res.score > best.score + 1e-9) best = res;
  }
  return best!.xi;
}

export interface ClubStrength {
  clubId: string;
  name: string;
  /** Average overall of the best XI. */
  xiAverage: number;
  /** Average overall of the best 11 players outside the XI (a second XI; reserves fill gaps). */
  benchAverage: number;
  strength: number;
  formation: FormationId;
}

export const BENCH_SIZE = 11;
export const BENCH_WEIGHT = 0.175;

/**
 * Pre-auction squad strength: XI average blended with depth,
 * strength = 0.825 x best XI average + 0.175 x average of the next 11 best players.
 * Calibrated so the 20 clubs rank in the order the spec expects (see DECISIONS.md).
 */
export function clubStrength(club: ClubSquad, options: XiOptions = {}): ClubStrength {
  const xi = pickBestXi(club.squad, options);
  const inXi = new Set(xi.slots.map((s) => s.player?.id).filter(Boolean));
  const bench = club.squad
    .filter((p) => !inXi.has(p.id))
    .map((p) => p.overall)
    .sort((a, b) => b - a)
    .slice(0, BENCH_SIZE);
  const reserve = options.reserveRating ?? DEFAULT_SIM_PARAMS.reserveRating;
  while (bench.length < BENCH_SIZE) bench.push(reserve);
  const benchAverage = bench.reduce((s, v) => s + v, 0) / BENCH_SIZE;
  return {
    clubId: club.id,
    name: club.name,
    xiAverage: xi.average,
    benchAverage,
    strength: (1 - BENCH_WEIGHT) * xi.average + BENCH_WEIGHT * benchAverage,
    formation: xi.formation,
  };
}

/** All clubs ranked by strength, strongest first (ties by name). */
export function rankClubs(clubs: readonly ClubSquad[], options: XiOptions = {}): ClubStrength[] {
  return clubs
    .map((c) => clubStrength(c, options))
    .sort((a, b) => b.strength - a.strength || a.name.localeCompare(b.name));
}

/** The (20 - N) strongest clubs join the league. */
export function selectAiClubs(ranking: readonly ClubStrength[], auctionTeams: number, leagueSize = 20): string[] {
  const count = leagueSize - auctionTeams;
  if (count < 0 || count > ranking.length) throw new Error(`Cannot pick ${count} AI clubs from ${ranking.length}`);
  return ranking.slice(0, count).map((c) => c.clubId);
}

export interface BoughtPlayerRef {
  name: string;
  overall: number;
  /** Club id of the AI squad he appears in, if any. */
  seedClubId: string | null;
}

/**
 * Remove bought players from AI squads: same club, same normalized name, same overall.
 * Returns new squads; clubs without bought players are returned unchanged.
 */
export function removeBoughtPlayers(clubs: readonly ClubSquad[], bought: readonly BoughtPlayerRef[]): ClubSquad[] {
  const byClub = new Map<string, BoughtPlayerRef[]>();
  for (const b of bought) {
    if (!b.seedClubId) continue;
    const list = byClub.get(b.seedClubId) ?? [];
    list.push(b);
    byClub.set(b.seedClubId, list);
  }
  return clubs.map((club) => {
    const gone = byClub.get(club.id);
    if (!gone) return club;
    const keys = new Set(gone.map((b) => `${normalizeName(b.name)}|${b.overall}`));
    return { ...club, squad: club.squad.filter((p) => !keys.has(`${normalizeName(p.name)}|${p.overall}`)) };
  });
}
