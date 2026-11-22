import { describe, expect, it } from 'vitest';
import { assignLineup, isEligible, isMainPosition, swapSlots, type PositionedPlayer } from '../src';

const messi: PositionedPlayer = { id: 'messi', position: 'CAM', altPositions: ['ST', 'RW', 'RM'] };
const p = (id: string, position: PositionedPlayer['position'], alts: PositionedPlayer['altPositions'] = []): PositionedPlayer => ({
  id,
  position,
  altPositions: alts,
});

describe('eligibility', () => {
  it('lets Messi fill CAM, ST, RW and RM slots but not CB', () => {
    for (const slot of ['CAM', 'ST', 'RW', 'RM'] as const) expect(isEligible(messi, slot)).toBe(true);
    for (const slot of ['CB', 'GK', 'LW', 'CM', 'CDM', 'LB'] as const) expect(isEligible(messi, slot)).toBe(false);
  });

  it('never lets a striker keep goal or a left-back play centre-back', () => {
    expect(isEligible(p('s', 'ST'), 'GK')).toBe(false);
    expect(isEligible(p('l', 'LB'), 'CB')).toBe(false);
  });

  it('treats wing-back slots as their full-back group and a listed CF as ST', () => {
    expect(isEligible(p('r', 'RB'), 'RWB')).toBe(true);
    expect(isMainPosition(p('r', 'RB'), 'RWB')).toBe(true);
    expect(isEligible(p('cf', 'CF'), 'ST')).toBe(true);
    expect(isEligible(p('lwb', 'LWB'), 'LB')).toBe(true);
  });
});

describe('assignLineup', () => {
  it('places Messi at CAM when the formation has one (main position)', () => {
    const res = assignLineup('4-2-3-1', [messi]);
    expect(res.valid).toBe(true);
    expect(res.lineup.CAM).toBe('messi');
    expect(res.mainCount).toBe(1);
  });

  it('finds a fit for Messi in a 4-3-3 and prefers main positions for everyone else', () => {
    const rw = p('rw', 'RW', ['RM']);
    const res = assignLineup('4-3-3', [messi, rw]);
    expect(res.valid).toBe(true);
    expect(res.lineup.RW).toBe('rw');
    expect(res.lineup.ST).toBe('messi');
    expect(res.mainCount).toBe(1);
  });

  it('maximizes main positions when several assignments are valid', () => {
    // A CM with alt CDM and a CDM: the CDM should hold the CDM slot, the CM a CM slot.
    const res = assignLineup('4-3-3', [p('cm', 'CM', ['CDM', 'CAM']), p('cdm', 'CDM', ['CM'])]);
    expect(res.lineup.CDM).toBe('cdm');
    expect(['cm']).toContain(res.lineup.CM1 ?? res.lineup.CM2);
    expect(res.mainCount).toBe(2);
  });

  it('rejects a roster that cannot be matched one to one', () => {
    expect(assignLineup('4-3-3', [p('g1', 'GK'), p('g2', 'GK')]).valid).toBe(false);
    expect(assignLineup('4-3-3', [p('s1', 'ST'), p('s2', 'ST')]).valid).toBe(false);
    const twelve = Array.from({ length: 12 }, (_, i) => p(`x${i}`, 'CB'));
    expect(assignLineup('4-3-3', twelve).valid).toBe(false);
  });

  it('uses alternates to make a roster fit', () => {
    // Two strikers in a 4-3-3 fail, but a striker plus Messi fits (Messi moves to RW).
    const res = assignLineup('4-3-3', [p('s1', 'ST'), messi]);
    expect(res.valid).toBe(true);
    expect(res.lineup.ST).toBe('s1');
    expect(res.lineup.RW).toBe('messi');
  });

  it('keeps players where the previous lineup had them when possible', () => {
    const cm = p('cm', 'CM', ['CDM', 'CAM']);
    const first = assignLineup('4-3-3', [cm]);
    const moved = { ...first.lineup, [Object.keys(first.lineup).find((k) => first.lineup[k] === 'cm')!]: null, CDM: 'cm' };
    const next = assignLineup('4-3-3', [cm, p('st', 'ST')], moved);
    expect(next.lineup.CDM).toBe('cm');
  });
});

describe('swapSlots', () => {
  const cm = p('cm', 'CM', ['CDM', 'CAM']);
  const cdm = p('cdm', 'CDM', ['CM']);
  const st = p('st', 'ST');
  const cb = p('cb', 'CB');
  const byId = new Map([cm, cdm, st, cb].map((x) => [x.id, x]));
  const lineup = assignLineup('4-3-3', [cm, cdm, st, cb]).lineup;

  it('swaps two players who can both play the other slot', () => {
    const cmSlot = Object.keys(lineup).find((k) => lineup[k] === 'cm')!;
    const swapped = swapSlots('4-3-3', lineup, byId, cmSlot, 'CDM');
    expect(swapped?.CDM).toBe('cm');
    expect(swapped?.[cmSlot]).toBe('cdm');
  });

  it('refuses an illegal swap', () => {
    const cbSlot = Object.keys(lineup).find((k) => lineup[k] === 'cb')!;
    expect(swapSlots('4-3-3', lineup, byId, cbSlot, 'ST')).toBeNull();
  });

  it('moves a player into an empty slot he can play', () => {
    const cmSlot = Object.keys(lineup).find((k) => lineup[k] === 'cm')!;
    const out = swapSlots('4-3-3', { ...lineup, CM2: null, CM1: 'cm' }, byId, 'CM1', 'CM2');
    expect(out?.CM2).toBe('cm');
    expect(out?.CM1).toBeNull();
    expect(cmSlot).toBeTruthy();
  });
});
