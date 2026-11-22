import { describe, expect, it } from 'vitest';
import { clubSquads, pickBestXi, rankClubs, removeBoughtPlayers, selectAiClubs, type SquadPlayer } from '../src';
import { loadDataInput } from './fixtures';
import { realData } from './helpers';

const data = realData();
const squads = clubSquads(data.clubs, data.seedPlayers);

const EXPECTED_ORDER = [
  'Paris Saint-Germain',
  'Real Madrid',
  'Arsenal',
  'Bayern Munich',
  'Manchester City',
  'FC Barcelona',
  'Liverpool',
  'Inter Milan',
  'Atlético Madrid',
  'Manchester United',
  'Chelsea',
  'Borussia Dortmund',
  'AC Milan',
  'Juventus',
  'Tottenham Hotspur',
  'Aston Villa',
  'Newcastle United',
  'Brighton and Hove Albion',
  'Al-Nassr',
  'Inter Miami',
];

describe('club strength', () => {
  it('reproduces the expected strength order of the 20 clubs', () => {
    expect(rankClubs(squads).map((c) => c.name)).toEqual(EXPECTED_ORDER);
  });

  it('finds the same best XI average and formation as the supplied club data', () => {
    const raw = loadDataInput().clubs as { name: string; best_formation: string; best_xi_average: number }[];
    for (const club of squads) {
      const xi = pickBestXi(club.squad);
      const ref = raw.find((c) => c.name === club.name)!;
      expect(xi.average, club.name).toBeCloseTo(ref.best_xi_average, 2);
      expect(xi.formation, club.name).toBe(ref.best_formation);
      expect(xi.outOfPositionCount).toBe(0);
      expect(xi.reserveCount).toBe(0);
    }
  });

  it('takes the (20 - N) strongest clubs', () => {
    const ranking = rankClubs(squads);
    expect(selectAiClubs(ranking, 3)).toHaveLength(17);
    expect(selectAiClubs(ranking, 12)).toEqual(ranking.slice(0, 8).map((c) => c.clubId));
    expect(selectAiClubs(ranking, 2)).toHaveLength(18);
    expect(selectAiClubs(ranking, 3)).not.toContain('inter-miami');
  });
});

describe('AI XI', () => {
  const sq = (overrides: Partial<SquadPlayer>[]): SquadPlayer[] =>
    overrides.map((o, i) => ({ id: `p${i}`, name: `P${i}`, position: 'CB', altPositions: [], overall: 80, ...o }));

  it('uses the best remaining outfield player with a penalty when no compatible player is left', () => {
    // A 4-3-3 shape with no goalkeeper: someone plays in goal at -8.
    const squad = sq([
      { position: 'LB' }, { position: 'CB' }, { position: 'CB' }, { position: 'RB' }, { position: 'CDM' },
      { position: 'CM' }, { position: 'CM' }, { position: 'LW' }, { position: 'ST' }, { position: 'RW' },
      { position: 'CB', overall: 78 },
    ]);
    const xi = pickBestXi(squad, { formations: ['4-3-3'] });
    const gk = xi.slots.find((s) => s.slotType === 'GK')!;
    expect(gk.outOfPosition).toBe(true);
    expect(gk.effectiveOverall).toBe(70);
    expect(xi.reserveCount).toBe(0);
  });

  it('fields Academy Reserves rated 62 when the club has nobody left', () => {
    const xi = pickBestXi([], { formations: ['4-3-3'] });
    expect(xi.reserveCount).toBe(11);
    expect(xi.slots.every((s) => s.effectiveOverall === 62)).toBe(true);
  });

  it('never puts a goalkeeper in an outfield slot', () => {
    const squad = sq(Array.from({ length: 11 }, () => ({ position: 'GK' as const })));
    const xi = pickBestXi(squad, { formations: ['4-3-3'] });
    expect(xi.slots.filter((s) => s.player?.position === 'GK')).toHaveLength(1);
    expect(xi.reserveCount).toBe(10);
  });

  it('removes a bought star so he never appears in the club XI', () => {
    const madrid = squads.find((c) => c.id === 'real-madrid')!;
    const mbappe = madrid.squad.find((p) => p.name === 'Kylian Mbappé')!;
    const before = pickBestXi(madrid.squad);
    expect(before.slots.some((s) => s.player?.id === mbappe.id)).toBe(true);
    const [after] = removeBoughtPlayers([madrid], [{ name: 'Kylian Mbappe', overall: 91, seedClubId: 'real-madrid' }]);
    expect(after!.squad.some((p) => p.id === mbappe.id)).toBe(false);
    const xi = pickBestXi(after!.squad);
    expect(xi.slots.some((s) => s.player?.id === mbappe.id)).toBe(false);
    expect(xi.slots).toHaveLength(11);
  });
});
