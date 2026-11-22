import { describe, expect, it } from 'vitest';
import { FORMATION_IDS, FORMATIONS, formationGroupCounts, positionGroup, slotGroup } from '../src';

describe('formations', () => {
  it('has the ten formations from the spec, each with 11 slots and one GK', () => {
    expect(FORMATION_IDS).toHaveLength(10);
    for (const id of FORMATION_IDS) {
      const f = FORMATIONS[id];
      expect(f.slots).toHaveLength(11);
      expect(f.slots.filter((s) => s.type === 'GK')).toHaveLength(1);
      expect(new Set(f.slots.map((s) => s.key)).size).toBe(11);
      for (const s of f.slots) {
        expect(s.x).toBeGreaterThanOrEqual(0);
        expect(s.x).toBeLessThanOrEqual(100);
        expect(s.y).toBeGreaterThanOrEqual(0);
        expect(s.y).toBeLessThanOrEqual(100);
      }
    }
  });

  it('matches the needs from the spec examples', () => {
    expect(formationGroupCounts('4-3-3')).toMatchObject({
      GK: 1, LB: 1, RB: 1, CB: 2, CDM: 1, CM: 2, LW: 1, RW: 1, ST: 1,
      CAM: 0, LM: 0, RM: 0,
    });
    expect(formationGroupCounts('3-5-2')).toMatchObject({
      GK: 1, CB: 3, LB: 1, RB: 1, CM: 2, CDM: 1, ST: 2,
      CAM: 0, LM: 0, RM: 0, LW: 0, RW: 0,
    });
  });

  it('maps slots and listed positions to groups', () => {
    expect(slotGroup('LWB')).toBe('LB');
    expect(slotGroup('RWB')).toBe('RB');
    expect(slotGroup('CDM')).toBe('CDM');
    expect(positionGroup('CF')).toBe('ST');
    expect(positionGroup('LWB')).toBe('LB');
    expect(positionGroup('RWB')).toBe('RB');
  });

  it('numbers repeated slot types and keeps single ones plain', () => {
    expect(FORMATIONS['4-3-3'].slots.map((s) => s.key)).toEqual([
      'GK', 'LB', 'CB1', 'CB2', 'RB', 'CDM', 'CM1', 'CM2', 'LW', 'ST', 'RW',
    ]);
  });
});
