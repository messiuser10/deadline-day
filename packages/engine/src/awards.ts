/**
 * Awards, auction grades and purchase tags (section 10).
 */
import { hungarian } from './assignment';
import { FORMATIONS, type FormationId } from './formations';
import { DEFAULT_SLOT_COMPATIBILITY, positionGroup, slotGroup, type SlotType } from './positions';
import { DEFAULT_PRICE_PARAMS, type PriceParams } from './pricing';
import type { PlayerSeasonStat, SeasonResult } from './season';

export interface PlayerAward {
  ref: string;
  name: string;
  teamId: string;
  value: number;
}

export interface TeamOfSeasonSlot {
  slotKey: string;
  slotType: SlotType;
  ref: string;
  name: string;
  teamId: string;
  avgRating: number;
}

export interface Purchase {
  /** pool:<id> */
  ref: string;
  teamId: string;
  priceM: number;
  marketValueM: number;
}

export interface BuyAward extends PlayerAward {
  priceM: number;
  /** Season average rating minus the rating his price implied. */
  gap: number;
  impliedRating: number;
}

export interface SeasonAwards {
  championId: string;
  goldenBoot: PlayerAward | null;
  playmaker: PlayerAward | null;
  goldenGlove: PlayerAward | null;
  playerOfTheSeason: PlayerAward | null;
  teamOfTheSeason: { formation: FormationId; slots: TeamOfSeasonSlot[] };
  bestBuy: BuyAward | null;
  biggestOverpay: BuyAward | null;
}

const isReserve = (s: PlayerSeasonStat) => s.ref.startsWith('reserve:');

function topBy(stats: readonly PlayerSeasonStat[], value: (s: PlayerSeasonStat) => number): PlayerAward | null {
  let best: PlayerSeasonStat | null = null;
  for (const s of stats) {
    if (value(s) <= 0) continue;
    if (
      !best ||
      value(s) > value(best) ||
      (value(s) === value(best) && (s.avgRating > best.avgRating || (s.avgRating === best.avgRating && s.ref < best.ref)))
    ) {
      best = s;
    }
  }
  return best ? { ref: best.ref, name: best.name, teamId: best.teamId, value: value(best) } : null;
}

/** Slot eligibility for the Team of the Season: the compatibility map or any listed position's group. */
function canPlay(stat: PlayerSeasonStat, slot: SlotType): boolean {
  const main = stat.positions[0];
  if (main && DEFAULT_SLOT_COMPATIBILITY[slot].includes(main)) return true;
  return stat.positions.some((p) => positionGroup(p) === slotGroup(slot));
}

export function teamOfTheSeason(
  stats: readonly PlayerSeasonStat[],
  formation: FormationId = '4-3-3',
  minAppearanceShare = 0.5,
): { formation: FormationId; slots: TeamOfSeasonSlot[] } {
  const maxApps = Math.max(0, ...stats.map((s) => s.appearances));
  const pool = stats
    .filter((s) => !isReserve(s) && s.appearances >= maxApps * minAppearanceShare)
    .sort((a, b) => b.avgRating - a.avgRating || a.ref.localeCompare(b.ref));
  const slots = FORMATIONS[formation].slots;
  if (pool.length < slots.length) return { formation, slots: [] };
  const BAD = 1e6;
  const cost = slots.map((slot) => pool.map((s) => (canPlay(s, slot.type) ? -s.avgRating : BAD)));
  const choice = hungarian(cost);
  return {
    formation,
    slots: slots.flatMap((slot, i) => {
      const s = pool[choice[i]!]!;
      if (cost[i]![choice[i]!]! >= BAD) return [];
      return [{ slotKey: slot.key, slotType: slot.type, ref: s.ref, name: s.name, teamId: s.teamId, avgRating: s.avgRating }];
    }),
  };
}

/** Overall implied by a price, inverting the market value curve. */
export function impliedOverall(priceM: number, params: PriceParams = DEFAULT_PRICE_PARAMS): number {
  return 80 + Math.log(Math.max(1, priceM) / params.anchor) / Math.log(params.growth);
}

/** Least-squares line of average rating against overall across regular players this season. */
function ratingByOverall(stats: readonly PlayerSeasonStat[]): (overall: number) => number {
  const xs = stats.map((s) => s.baseOverall);
  const ys = stats.map((s) => s.avgRating);
  const n = xs.length;
  if (n < 2) return () => 6.5;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let sxy = 0;
  let sxx = 0;
  for (let i = 0; i < n; i++) {
    sxy += (xs[i]! - mx) * (ys[i]! - my);
    sxx += (xs[i]! - mx) ** 2;
  }
  const slope = sxx ? sxy / sxx : 0;
  return (overall) => my + slope * (overall - mx);
}

export function computeAwards(
  season: SeasonResult,
  purchases: readonly Purchase[] = [],
  priceParams: PriceParams = DEFAULT_PRICE_PARAMS,
): SeasonAwards {
  const stats = season.playerStats.filter((s) => !isReserve(s));
  const maxApps = Math.max(0, ...stats.map((s) => s.appearances));
  const regulars = stats.filter((s) => s.appearances >= maxApps * 0.5);

  const expected = ratingByOverall(regulars);
  const statByRef = new Map(stats.map((s) => [s.ref, s]));
  const buys = purchases
    .map((p) => {
      const s = statByRef.get(p.ref);
      if (!s || s.appearances === 0) return null;
      const impliedRating = expected(impliedOverall(p.priceM, priceParams));
      return {
        ref: p.ref,
        name: s.name,
        teamId: p.teamId,
        value: s.avgRating,
        priceM: p.priceM,
        impliedRating: Math.round(impliedRating * 100) / 100,
        gap: Math.round((s.avgRating - impliedRating) * 100) / 100,
      };
    })
    .filter((b): b is BuyAward => b !== null)
    .sort((a, b) => b.gap - a.gap || a.ref.localeCompare(b.ref));

  return {
    championId: season.championId,
    goldenBoot: topBy(stats, (s) => s.goals),
    playmaker: topBy(stats, (s) => s.assists),
    goldenGlove: topBy(
      stats.filter((s) => s.slotType === 'GK'),
      (s) => s.cleanSheets,
    ),
    playerOfTheSeason: topBy(regulars, (s) => s.avgRating),
    teamOfTheSeason: teamOfTheSeason(stats),
    bestBuy: buys[0] ?? null,
    biggestOverpay: buys.length > 1 ? buys[buys.length - 1]! : null,
  };
}

// ---------------------------------------------------------------------------
// Auction grades

export type PurchaseTag = 'steal' | 'fair' | 'overpay';

/** Steal: paid at most 80% of market value. Overpay: paid at least 130%. */
export function purchaseTag(priceM: number, marketValueM: number): PurchaseTag {
  if (priceM <= 0.8 * marketValueM) return 'steal';
  if (priceM >= 1.3 * marketValueM) return 'overpay';
  return 'fair';
}

export const GRADES = ['A+', 'A', 'A-', 'B+', 'B', 'B-', 'C+', 'C', 'C-', 'D', 'F'] as const;
export type Grade = (typeof GRADES)[number];
const GRADE_FLOORS: [Grade, number][] = [
  ['A+', 90],
  ['A', 83],
  ['A-', 77],
  ['B+', 71],
  ['B', 65],
  ['B-', 59],
  ['C+', 53],
  ['C', 47],
  ['C-', 41],
  ['D', 33],
  ['F', 0],
];

export interface GradeInput {
  /** Pre-season strength rank among the league (1 = strongest). */
  preRank: number;
  /** Final league position; omit for the Team Reveal preview (expected finish = strength rank). */
  finalPosition?: number;
  startingBudgetM: number;
  /** Total market value of the XI the team bought. */
  xiMarketValueM: number;
  leagueSize?: number;
}

export interface GradeResult {
  grade: Grade;
  score: number;
  strengthScore: number;
  finishScore: number;
  valueScore: number;
}

/**
 * Score 0-100 = 35% pre-season strength rank + 45% actual finish + 20% value (market value of the
 * XI bought per dollar of budget, full marks at 100%), then mapped to A+ ... F.
 */
export function auctionGrade(input: GradeInput): GradeResult {
  const n = input.leagueSize ?? 20;
  const rankScore = (rank: number) => Math.min(1, Math.max(0, (n - rank) / (n - 1)));
  const strengthScore = rankScore(input.preRank);
  const finishScore = rankScore(input.finalPosition ?? input.preRank);
  const valueScore = Math.min(1, Math.max(0, input.xiMarketValueM / Math.max(1, input.startingBudgetM)));
  const score = Math.round(100 * (0.35 * strengthScore + 0.45 * finishScore + 0.2 * valueScore) * 10) / 10;
  const grade = GRADE_FLOORS.find(([, floor]) => score >= floor)![0];
  return { grade, score, strengthScore, finishScore, valueScore };
}
