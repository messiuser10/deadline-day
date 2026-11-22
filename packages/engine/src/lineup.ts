/**
 * Eligibility and lineup assignment for auction teams (section 4).
 *
 * A player is eligible for a slot when the slot's group is his main position or one of his
 * alternates (a listed RWB/LWB counts as RB/LB, a listed CF as ST). A roster is valid when its
 * players can be matched one to one to the formation's slots.
 */
import { FORBIDDEN, hungarian } from './assignment';
import { FORMATIONS, type FormationId } from './formations';
import { positionGroup, slotGroup, type Group, type Position, type SlotType } from './positions';

export interface PositionedPlayer {
  id: string;
  position: Position;
  altPositions: readonly Position[];
}

/** slotKey -> player id (null when the slot is open). */
export type Lineup = Record<string, string | null>;

const groupCache = new WeakMap<PositionedPlayer, ReadonlySet<Group>>();

/** Groups a player can fill: his main position plus alternates, each mapped to its group. */
export function playerGroups(p: PositionedPlayer): ReadonlySet<Group> {
  let groups = groupCache.get(p);
  if (!groups) {
    groups = new Set([positionGroup(p.position), ...p.altPositions.map(positionGroup)]);
    groupCache.set(p, groups);
  }
  return groups;
}

export function isEligible(p: PositionedPlayer, slot: SlotType): boolean {
  return playerGroups(p).has(slotGroup(slot));
}

/** True when the slot is of the player's main position group (no "out of main position" tag). */
export function isMainPosition(p: PositionedPlayer, slot: SlotType): boolean {
  return positionGroup(p.position) === slotGroup(slot);
}

export interface LineupResult {
  /** Every roster player has a slot. */
  valid: boolean;
  lineup: Lineup;
  /** Players placed in a slot of their main position. */
  mainCount: number;
  /** Players that could not be placed (only when invalid). */
  unplaced: string[];
}

const MOVE_COST = 100;
const ALT_COST = 1;

/**
 * Assign a roster (at most 11) to a formation's slots.
 * Priority: every player placed; then keep players where `previous` had them (so a manager's swaps
 * survive later sales); then the most players in their main position.
 */
export function assignLineup(
  formation: FormationId,
  roster: readonly PositionedPlayer[],
  previous?: Lineup,
): LineupResult {
  const slots = FORMATIONS[formation].slots;
  const emptyLineup = Object.fromEntries(slots.map((s) => [s.key, null])) as Lineup;
  if (roster.length > slots.length) {
    return { valid: false, lineup: emptyLineup, mainCount: 0, unplaced: roster.map((p) => p.id) };
  }
  const previousSlotOf = new Map<string, string>();
  if (previous) for (const [key, id] of Object.entries(previous)) if (id) previousSlotOf.set(id, key);

  const dummies = slots.length - roster.length;
  const cost = slots.map((slot) => {
    const row = roster.map((p) => {
      if (!isEligible(p, slot.type)) return FORBIDDEN;
      let c = isMainPosition(p, slot.type) ? 0 : ALT_COST;
      const prev = previousSlotOf.get(p.id);
      if (prev !== undefined && prev !== slot.key) c += MOVE_COST;
      return c;
    });
    for (let d = 0; d < dummies; d++) row.push(0);
    return row;
  });

  const choice = hungarian(cost);
  const lineup: Lineup = { ...emptyLineup };
  const placed = new Set<string>();
  let mainCount = 0;
  choice.forEach((col, row) => {
    const slot = slots[row]!;
    if (col < roster.length && cost[row]![col]! < FORBIDDEN) {
      const p = roster[col]!;
      lineup[slot.key] = p.id;
      placed.add(p.id);
      if (isMainPosition(p, slot.type)) mainCount++;
    }
  });
  const unplaced = roster.filter((p) => !placed.has(p.id)).map((p) => p.id);
  return { valid: unplaced.length === 0, lineup, mainCount, unplaced };
}

/** Open slot keys of a lineup. */
export function openSlotKeys(lineup: Lineup): string[] {
  return Object.entries(lineup)
    .filter(([, id]) => id === null)
    .map(([key]) => key);
}

/**
 * Swap whatever is in two slots (either may be empty). Returns the new lineup, or null when one of
 * the players cannot legally play the other slot.
 */
export function swapSlots(
  formation: FormationId,
  lineup: Lineup,
  playersById: ReadonlyMap<string, PositionedPlayer>,
  slotA: string,
  slotB: string,
): Lineup | null {
  const slots = FORMATIONS[formation].slots;
  const a = slots.find((s) => s.key === slotA);
  const b = slots.find((s) => s.key === slotB);
  if (!a || !b || slotA === slotB) return null;
  const idA = lineup[slotA] ?? null;
  const idB = lineup[slotB] ?? null;
  const pA = idA ? playersById.get(idA) : undefined;
  const pB = idB ? playersById.get(idB) : undefined;
  if ((idA && !pA) || (idB && !pB)) return null;
  if (pA && !isEligible(pA, b.type)) return null;
  if (pB && !isEligible(pB, a.type)) return null;
  return { ...lineup, [slotA]: idB, [slotB]: idA };
}
