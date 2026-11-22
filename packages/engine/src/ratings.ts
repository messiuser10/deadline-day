/**
 * Team ratings (section 9, step 3). Auction teams and AI clubs use exactly the same rules.
 */
import type { SlotType } from './positions';

export const SLOT_WEIGHTS: Record<SlotType, { attack: number; defense: number }> = {
  GK: { attack: 0, defense: 1.6 },
  CB: { attack: 0.1, defense: 1.0 },
  LB: { attack: 0.35, defense: 0.7 },
  RB: { attack: 0.35, defense: 0.7 },
  LWB: { attack: 0.35, defense: 0.7 },
  RWB: { attack: 0.35, defense: 0.7 },
  CDM: { attack: 0.2, defense: 0.8 },
  CM: { attack: 0.5, defense: 0.5 },
  CAM: { attack: 0.8, defense: 0.2 },
  LM: { attack: 0.7, defense: 0.3 },
  RM: { attack: 0.7, defense: 0.3 },
  LW: { attack: 0.9, defense: 0.1 },
  RW: { attack: 0.9, defense: 0.1 },
  ST: { attack: 1.0, defense: 0 },
};

export interface RatedSlotPlayer {
  slotType: SlotType;
  /** Effective overall in this slot (after any out-of-position penalty). */
  overall: number;
  /** Real club id, when known. */
  club?: string | null;
  nationality?: string | null;
}

export const CHEMISTRY_CLUB_PAIR = 0.25;
export const CHEMISTRY_CLUB_CAP = 2.0;
export const CHEMISTRY_NATION_PAIR = 0.1;
export const CHEMISTRY_NATION_CAP = 1.0;

function pairsBy(values: readonly (string | null | undefined)[]): number {
  const counts = new Map<string, number>();
  for (const v of values) if (v) counts.set(v, (counts.get(v) ?? 0) + 1);
  let pairs = 0;
  for (const n of counts.values()) pairs += (n * (n - 1)) / 2;
  return pairs;
}

/** 0.25 per pair from the same real club (cap +2.0) plus 0.1 per pair of the same nationality (cap +1.0). */
export function chemistryBonus(players: readonly RatedSlotPlayer[]): number {
  const club = Math.min(CHEMISTRY_CLUB_CAP, CHEMISTRY_CLUB_PAIR * pairsBy(players.map((p) => p.club)));
  const nation = Math.min(CHEMISTRY_NATION_CAP, CHEMISTRY_NATION_PAIR * pairsBy(players.map((p) => p.nationality)));
  return club + nation;
}

export interface TeamRatings {
  attack: number;
  defense: number;
  chemistry: number;
}

/** Weighted averages of overall by slot weights, plus the chemistry bonus to both when enabled. */
export function teamRatings(players: readonly RatedSlotPlayer[], options: { chemistry?: boolean } = {}): TeamRatings {
  let att = 0;
  let attW = 0;
  let def = 0;
  let defW = 0;
  for (const p of players) {
    const w = SLOT_WEIGHTS[p.slotType];
    att += w.attack * p.overall;
    attW += w.attack;
    def += w.defense * p.overall;
    defW += w.defense;
  }
  const chemistry = options.chemistry ? chemistryBonus(players) : 0;
  return {
    attack: (attW ? att / attW : 0) + chemistry,
    defense: (defW ? def / defW : 0) + chemistry,
    chemistry,
  };
}

/** Single number used to rank teams by strength: the mean of attack and defense. */
export function overallStrength(r: Pick<TeamRatings, 'attack' | 'defense'>): number {
  return (r.attack + r.defense) / 2;
}
