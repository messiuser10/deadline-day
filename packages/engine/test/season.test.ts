import { describe, expect, it } from 'vitest';
import {
  chemistryBonus,
  doubleRoundRobinTemplate,
  generateFixtures,
  longestRun,
  monteCarlo,
  simulateMatch,
  simulateMultiSeason,
  simulateSeason,
  teamRatings,
  expectedGoals,
  DEFAULT_SIM_PARAMS,
  Rng,
  type RatedSlotPlayer,
} from '../src';
import { flatTeam, syntheticLeague } from './helpers';

const ids = Array.from({ length: 20 }, (_, i) => `t${i}`);

describe('fixtures', () => {
  const fixtures = generateFixtures(ids, 42);

  it('has 380 matches over 38 matchdays, each team once per matchday', () => {
    expect(fixtures).toHaveLength(380);
    for (let md = 1; md <= 38; md++) {
      const day = fixtures.filter((f) => f.matchday === md);
      expect(day).toHaveLength(10);
      expect(new Set(day.flatMap((f) => [f.homeId, f.awayId])).size).toBe(20);
    }
  });

  it('has every team play every opponent twice, once at home and once away', () => {
    for (const a of ids) {
      for (const b of ids) {
        if (a === b) continue;
        expect(fixtures.filter((f) => f.homeId === a && f.awayId === b)).toHaveLength(1);
      }
    }
  });

  it('gives each team 19 home and 19 away matches, never more than 2 in a row', () => {
    for (const t of ids) {
      expect(fixtures.filter((f) => f.homeId === t)).toHaveLength(19);
      expect(fixtures.filter((f) => f.awayId === t)).toHaveLength(19);
      let run = 0;
      let last = '';
      for (let md = 1; md <= 38; md++) {
        const f = fixtures.find((x) => x.matchday === md && (x.homeId === t || x.awayId === t))!;
        const side = f.homeId === t ? 'H' : 'A';
        run = side === last ? run + 1 : 1;
        last = side;
        expect(run).toBeLessThanOrEqual(2);
      }
    }
    expect(longestRun(doubleRoundRobinTemplate(20), 20)).toBeLessThanOrEqual(2);
  });

  it('mirrors the first half with home and away swapped', () => {
    for (const f of fixtures.filter((x) => x.matchday <= 19)) {
      expect(fixtures.find((x) => x.matchday === f.matchday + 19 && x.homeId === f.awayId && x.awayId === f.homeId)).toBeTruthy();
    }
  });

  it('depends on the seed', () => {
    expect(generateFixtures(ids, 42)).toEqual(fixtures);
    expect(generateFixtures(ids, 43)).not.toEqual(fixtures);
  });
});

describe('ratings', () => {
  it('uses the slot weights for attack and defense', () => {
    const xi = flatTeam('x', 80).players;
    const flat = teamRatings(xi);
    expect(flat.attack).toBeCloseTo(80, 9);
    expect(flat.defense).toBeCloseTo(80, 9);
    expect(flat.chemistry).toBe(0);
    const strikerUp = xi.map((p) => (p.slotType === 'ST' ? { ...p, overall: 90 } : p));
    const r = teamRatings(strikerUp);
    expect(r.attack).toBeGreaterThan(80);
    expect(r.defense).toBeCloseTo(80, 9); // ST has defense weight 0
    const gkUp = xi.map((p) => (p.slotType === 'GK' ? { ...p, overall: 90 } : p));
    expect(teamRatings(gkUp).attack).toBeCloseTo(80, 9);
    expect(teamRatings(gkUp).defense).toBeGreaterThan(80);
  });

  it('computes chemistry with caps, and only adds it when enabled', () => {
    const p = (club: string | null, nationality: string | null): RatedSlotPlayer => ({ slotType: 'CM', overall: 80, club, nationality });
    expect(chemistryBonus([p('a', 'x'), p('a', 'x')])).toBeCloseTo(0.35);
    expect(chemistryBonus(Array.from({ length: 11 }, () => p('a', 'x')))).toBeCloseTo(3.0);
    expect(chemistryBonus([p(null, null), p(null, null)])).toBe(0);
    const same = Array.from({ length: 11 }, () => p('a', null));
    expect(teamRatings(same).chemistry).toBe(0);
    const chem = teamRatings(same, { chemistry: true });
    expect(chem.chemistry).toBe(2);
    expect(chem.attack).toBeCloseTo(82, 9);
    expect(chem.defense).toBeCloseTo(82, 9);
  });
});

describe('match', () => {
  const league = { attack: 80, defense: 80 };
  const strong = { id: 'h', attack: 86, defense: 86, players: flatTeam('h', 86).players };
  const weak = { id: 'a', attack: 76, defense: 76, players: flatTeam('a', 76).players };

  it('follows the expected goals formula', () => {
    const xg = expectedGoals(strong, weak, league, DEFAULT_SIM_PARAMS);
    const s = DEFAULT_SIM_PARAMS.sensitivity;
    expect(xg.home).toBeCloseTo(DEFAULT_SIM_PARAMS.baseGoals * DEFAULT_SIM_PARAMS.homeAdvantage * Math.exp(s * (6 + 4)));
    expect(xg.away).toBeCloseTo(DEFAULT_SIM_PARAMS.baseGoals * Math.exp(s * (-4 - 6)));
  });

  it('produces the same score with or without events, and events that add up', () => {
    for (let seed = 1; seed <= 50; seed++) {
      const plain = simulateMatch(strong, weak, league, DEFAULT_SIM_PARAMS, seed);
      const full = simulateMatch(strong, weak, league, DEFAULT_SIM_PARAMS, seed, { events: true });
      expect([full.homeGoals, full.awayGoals]).toEqual([plain.homeGoals, plain.awayGoals]);
      expect(full.events.filter((e) => e.type === 'goal' && e.teamId === 'h')).toHaveLength(full.homeGoals);
      expect(full.events.filter((e) => e.type === 'goal' && e.teamId === 'a')).toHaveLength(full.awayGoals);
      for (const e of full.events) {
        expect(e.minute).toBeGreaterThanOrEqual(1);
        expect(e.minute).toBeLessThanOrEqual(94);
      }
      for (const l of full.lines) {
        expect(l.rating).toBeGreaterThanOrEqual(4);
        expect(l.rating).toBeLessThanOrEqual(10);
      }
    }
  });
});

describe('season', () => {
  const teams = syntheticLeague();
  const season = simulateSeason({ teams, seed: 2024 });

  it('keeps the table invariants', () => {
    expect(season.fixtures).toHaveLength(380);
    expect(season.standings).toHaveLength(38);
    expect(season.table).toEqual(season.standings[37]);
    let gf = 0;
    let ga = 0;
    for (const row of season.table) {
      expect(row.played).toBe(38);
      expect(row.won + row.drawn + row.lost).toBe(38);
      expect(row.points).toBe(3 * row.won + row.drawn);
      expect(row.goalDifference).toBe(row.goalsFor - row.goalsAgainst);
      gf += row.goalsFor;
      ga += row.goalsAgainst;
    }
    expect(gf).toBe(ga);
    expect(season.table.map((r) => r.position)).toEqual(Array.from({ length: 20 }, (_, i) => i + 1));
    expect(season.championId).toBe(season.table[0]!.teamId);
  });

  it('orders the table by points, then goal difference, then goals scored', () => {
    for (const day of season.standings) {
      for (let i = 1; i < day.length; i++) {
        const a = day[i - 1]!;
        const b = day[i]!;
        expect(a.points >= b.points).toBe(true);
        if (a.points === b.points) {
          expect(a.goalDifference >= b.goalDifference).toBe(true);
          if (a.goalDifference === b.goalDifference) expect(a.goalsFor >= b.goalsFor).toBe(true);
        }
      }
    }
  });

  it('credits every goal to a player of the scoring team', () => {
    for (const row of season.table) {
      const goals = season.playerStats.filter((s) => s.teamId === row.teamId).reduce((s, p) => s + p.goals, 0);
      expect(goals).toBe(row.goalsFor);
    }
    expect(season.playerStats.every((s) => s.appearances === 38)).toBe(true);
  });

  it('is identical for the same seed and different for another', () => {
    expect(simulateSeason({ teams, seed: 2024 })).toEqual(season);
    const other = simulateSeason({ teams, seed: 2025 });
    expect(other.fixtures.map((f) => [f.homeGoals, f.awayGoals])).not.toEqual(season.fixtures.map((f) => [f.homeGoals, f.awayGoals]));
  });

  it('keeps form as the last five results', () => {
    const after5 = season.standings[4]!;
    for (const row of after5) expect(row.form).toMatch(/^[WDL]{5}$/);
    expect(season.standings[1]![0]!.form).toHaveLength(2);
  });

  it('runs with injuries on, deterministically', () => {
    const a = simulateSeason({ teams, seed: 7, params: { injuries: true } });
    const b = simulateSeason({ teams, seed: 7, params: { injuries: true } });
    expect(a.table).toEqual(b.table);
    expect(a.playerStats.some((s) => s.ref.startsWith('reserve:'))).toBe(true);
  });

  it('breaks a full tie with head to head, then a seeded draw', () => {
    const twins = [flatTeam('A', 80), flatTeam('B', 80), ...syntheticLeague().slice(2)];
    const s = simulateSeason({ teams: twins, seed: 1, params: { chaos: 0 } });
    expect(new Set(s.table.map((r) => r.teamId)).size).toBe(20);
  });
});

describe('Monte Carlo', () => {
  it('runs 1,000 seasons and gives plausible title chances', () => {
    const teams = syntheticLeague();
    const started = Date.now();
    const mc = monteCarlo(teams, { seed: 1, runs: 1000 });
    expect(Date.now() - started).toBeLessThan(20000);
    expect(mc.runs).toBe(1000);
    const total = mc.teams.reduce((s, t) => s + t.titleChance, 0);
    expect(total).toBeCloseTo(1, 5);
    const best = mc.teams.find((t) => t.teamId === 'T01')!;
    const worst = mc.teams.find((t) => t.teamId === 'T20')!;
    expect(best.titleChance).toBeGreaterThan(worst.titleChance);
    expect(best.avgPoints).toBeGreaterThan(worst.avgPoints);
    expect(worst.bottom3Chance).toBeGreaterThan(best.bottom3Chance);
    expect(mc.teams[0]!.teamId).toBe('T01');
    for (const t of mc.teams) expect(t.positionCounts.reduce((a, b) => a + b, 0)).toBe(1000);
  });

  it('keeps a cumulative titles table over several seasons', () => {
    const res = simulateMultiSeason(syntheticLeague(), { seed: 3, seasons: 5 });
    expect(res.seasons).toHaveLength(5);
    expect(res.titles.reduce((s, t) => s + t.titles, 0)).toBe(5);
    expect(new Set(res.seasons.map((s) => s.seed)).size).toBe(5);
  });
});

describe('rng', () => {
  it('is deterministic and roughly uniform, with a sane Poisson mean', () => {
    const a = new Rng(5);
    const b = new Rng(5);
    for (let i = 0; i < 10; i++) expect(a.next()).toBe(b.next());
    const r = new Rng(9);
    let sum = 0;
    for (let i = 0; i < 20000; i++) sum += r.poisson(1.4);
    expect(sum / 20000).toBeGreaterThan(1.35);
    expect(sum / 20000).toBeLessThan(1.45);
  });
});
