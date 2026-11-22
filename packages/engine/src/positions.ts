/**
 * Positions, slot types and position groups (spec section 4).
 */

/** Every position a player can be listed as (AI club squads use all 15). */
export const POSITIONS = [
  'GK',
  'RB',
  'CB',
  'LB',
  'RWB',
  'LWB',
  'CDM',
  'CM',
  'CAM',
  'RM',
  'LM',
  'RW',
  'LW',
  'CF',
  'ST',
] as const;
export type Position = (typeof POSITIONS)[number];

/** The 12 position groups. The master auction pool only uses these as main and alternate positions. */
export const GROUPS = ['GK', 'RB', 'LB', 'CB', 'CDM', 'CM', 'CAM', 'RM', 'LM', 'RW', 'LW', 'ST'] as const;
export type Group = (typeof GROUPS)[number];

/** Slot types a formation can contain (no CF slot: a listed CF counts as ST). */
export const SLOT_TYPES = [
  'GK',
  'RB',
  'LB',
  'CB',
  'RWB',
  'LWB',
  'CDM',
  'CM',
  'CAM',
  'RM',
  'LM',
  'RW',
  'LW',
  'ST',
] as const;
export type SlotType = (typeof SLOT_TYPES)[number];

export function isPosition(value: string): value is Position {
  return (POSITIONS as readonly string[]).includes(value);
}

export function isGroup(value: string): value is Group {
  return (GROUPS as readonly string[]).includes(value);
}

export function isSlotType(value: string): value is SlotType {
  return (SLOT_TYPES as readonly string[]).includes(value);
}

/** Group of a formation slot: LWB -> LB, RWB -> RB, every other slot is its own group. */
export function slotGroup(slot: SlotType): Group {
  if (slot === 'LWB') return 'LB';
  if (slot === 'RWB') return 'RB';
  return slot;
}

/** Group a listed position counts as: RWB -> RB, LWB -> LB, CF -> ST. */
export function positionGroup(position: Position): Group {
  if (position === 'RWB') return 'RB';
  if (position === 'LWB') return 'LB';
  if (position === 'CF') return 'ST';
  return position;
}

/**
 * Wider compatibility table (section 4): which listed positions a slot accepts.
 * Used by the simulation for AI club lineups. Stored in app_settings so the admin can edit it.
 */
export type SlotCompatibility = Record<SlotType, Position[]>;

export const DEFAULT_SLOT_COMPATIBILITY: SlotCompatibility = {
  GK: ['GK'],
  RB: ['RB', 'RWB'],
  LB: ['LB', 'LWB'],
  CB: ['CB'],
  RWB: ['RWB', 'RB'],
  LWB: ['LWB', 'LB'],
  CDM: ['CDM', 'CM'],
  CM: ['CM', 'CDM', 'CAM'],
  CAM: ['CAM', 'CM'],
  RM: ['RM', 'RW'],
  LM: ['LM', 'LW'],
  RW: ['RW', 'RM'],
  LW: ['LW', 'LM'],
  ST: ['ST', 'CF'],
};

/**
 * Rule-based default alternates for the master pool (section 5).
 * Every player without verified EA alternates gets these.
 */
export const RULE_ALTERNATES: Record<Group, Group[]> = {
  GK: [],
  RB: [],
  LB: [],
  CB: [],
  CDM: ['CM'],
  CM: ['CDM', 'CAM'],
  CAM: ['CM'],
  RM: ['RW'],
  LM: ['LW'],
  RW: ['RM'],
  LW: ['LM'],
  ST: [],
};
