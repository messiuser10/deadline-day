/**
 * Formations (section 4). Each is 11 slots with pitch coordinates.
 * Coordinates: x 0..100 from left touchline to right, y 0..100 from the opponent's goal line (top)
 * to the team's own goal line (bottom).
 */
import { slotGroup, type Group, type SlotType, GROUPS } from './positions';

export const FORMATION_IDS = [
  '4-3-3',
  '4-4-2',
  '4-2-3-1',
  '4-1-4-1',
  '4-3-2-1',
  '4-4-1-1',
  '3-5-2',
  '3-4-3',
  '5-3-2',
  '5-4-1',
] as const;
export type FormationId = (typeof FORMATION_IDS)[number];

export interface FormationSlot {
  /** Unique within the formation, used as lineup_slots.slot_key (for example CB1). */
  key: string;
  type: SlotType;
  x: number;
  y: number;
}

export interface Formation {
  id: FormationId;
  slots: FormationSlot[];
}

type SlotSpec = [type: SlotType, x: number, y: number];

const GK: SlotSpec = ['GK', 50, 92];

function back4(): SlotSpec[] {
  return [
    ['LB', 14, 72],
    ['CB', 37, 76],
    ['CB', 63, 76],
    ['RB', 86, 72],
  ];
}

function back3(): SlotSpec[] {
  return [
    ['CB', 28, 76],
    ['CB', 50, 78],
    ['CB', 72, 76],
  ];
}

function back5(): SlotSpec[] {
  return [
    ['LWB', 10, 66],
    ['CB', 30, 76],
    ['CB', 50, 78],
    ['CB', 70, 76],
    ['RWB', 90, 66],
  ];
}

const SPECS: Record<FormationId, SlotSpec[]> = {
  '4-3-3': [
    GK,
    ...back4(),
    ['CDM', 50, 58],
    ['CM', 30, 48],
    ['CM', 70, 48],
    ['LW', 16, 22],
    ['ST', 50, 14],
    ['RW', 84, 22],
  ],
  '4-4-2': [
    GK,
    ...back4(),
    ['LM', 14, 44],
    ['CM', 38, 50],
    ['CM', 62, 50],
    ['RM', 86, 44],
    ['ST', 38, 16],
    ['ST', 62, 16],
  ],
  '4-2-3-1': [
    GK,
    ...back4(),
    ['CDM', 37, 58],
    ['CDM', 63, 58],
    ['LM', 16, 34],
    ['CAM', 50, 34],
    ['RM', 84, 34],
    ['ST', 50, 13],
  ],
  '4-1-4-1': [
    GK,
    ...back4(),
    ['CDM', 50, 60],
    ['LM', 14, 40],
    ['CM', 37, 44],
    ['CM', 63, 44],
    ['RM', 86, 40],
    ['ST', 50, 14],
  ],
  '4-3-2-1': [
    GK,
    ...back4(),
    ['CM', 26, 52],
    ['CDM', 50, 58],
    ['CM', 74, 52],
    ['CAM', 34, 30],
    ['CAM', 66, 30],
    ['ST', 50, 13],
  ],
  '4-4-1-1': [
    GK,
    ...back4(),
    ['LM', 14, 46],
    ['CM', 38, 52],
    ['CM', 62, 52],
    ['RM', 86, 46],
    ['CAM', 50, 30],
    ['ST', 50, 13],
  ],
  '3-5-2': [
    GK,
    ...back3(),
    ['LWB', 10, 52],
    ['CM', 34, 46],
    ['CDM', 50, 58],
    ['CM', 66, 46],
    ['RWB', 90, 52],
    ['ST', 38, 16],
    ['ST', 62, 16],
  ],
  '3-4-3': [
    GK,
    ...back3(),
    ['LM', 12, 48],
    ['CM', 38, 52],
    ['CM', 62, 52],
    ['RM', 88, 48],
    ['LW', 18, 22],
    ['ST', 50, 14],
    ['RW', 82, 22],
  ],
  '5-3-2': [
    GK,
    ...back5(),
    ['CM', 30, 46],
    ['CDM', 50, 54],
    ['CM', 70, 46],
    ['ST', 38, 16],
    ['ST', 62, 16],
  ],
  '5-4-1': [
    GK,
    ...back5(),
    ['LM', 14, 40],
    ['CM', 38, 46],
    ['CM', 62, 46],
    ['RM', 86, 40],
    ['ST', 50, 14],
  ],
};

function buildFormation(id: FormationId): Formation {
  const counts = new Map<SlotType, number>();
  const totals = new Map<SlotType, number>();
  for (const [type] of SPECS[id]) totals.set(type, (totals.get(type) ?? 0) + 1);
  const slots = SPECS[id].map(([type, x, y]) => {
    const n = (counts.get(type) ?? 0) + 1;
    counts.set(type, n);
    const key = (totals.get(type) ?? 0) > 1 ? `${type}${n}` : type;
    return { key, type, x, y };
  });
  return { id, slots };
}

export const FORMATIONS: Record<FormationId, Formation> = Object.fromEntries(
  FORMATION_IDS.map((id) => [id, buildFormation(id)]),
) as Record<FormationId, Formation>;

export function isFormationId(value: string): value is FormationId {
  return (FORMATION_IDS as readonly string[]).includes(value);
}

export function getFormation(id: FormationId): Formation {
  return FORMATIONS[id];
}

export type GroupCounts = Record<Group, number>;

export function emptyGroupCounts(): GroupCounts {
  return Object.fromEntries(GROUPS.map((g) => [g, 0])) as GroupCounts;
}

/** Number of slots of each group in a formation (LWB counts as LB, RWB as RB). */
export function formationGroupCounts(id: FormationId): GroupCounts {
  const counts = emptyGroupCounts();
  for (const slot of FORMATIONS[id].slots) counts[slotGroup(slot.type)] += 1;
  return counts;
}
