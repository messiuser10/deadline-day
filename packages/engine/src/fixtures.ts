/**
 * Fixtures (section 9, step 4): shuffle the teams with the seed, circle method for the first half,
 * then the same matchdays mirrored with home and away swapped. No team plays more than 2 home or
 * 2 away matches in a row.
 */
import { Rng } from './rng';

export interface Fixture {
  /** 1-based. */
  matchday: number;
  homeId: string;
  awayId: string;
}

type Round = [home: number, away: number][];

/** Longest run of consecutive home (or away) matches of any team in a list of rounds. */
export function longestRun(rounds: readonly Round[], teams: number): number {
  let worst = 0;
  for (let t = 0; t < teams; t++) {
    let run = 0;
    let last: 'H' | 'A' | null = null;
    for (const round of rounds) {
      const m = round.find(([h, a]) => h === t || a === t);
      if (!m) continue;
      const side = m[0] === t ? 'H' : 'A';
      run = side === last ? run + 1 : 1;
      last = side;
      worst = Math.max(worst, run);
    }
  }
  return worst;
}

/** Circle method rounds; `orient` decides which side of each pairing is at home. */
function circleRounds(n: number, orient: (round: number, pairIndex: number) => boolean): Round[] {
  const fixed = n - 1;
  const rounds: Round[] = [];
  for (let r = 0; r < n - 1; r++) {
    const pairs: Round = [];
    const first: [number, number] = [fixed, r];
    pairs.push(orient(r, 0) ? first : [first[1], first[0]]);
    for (let i = 1; i < n / 2; i++) {
      const a = (r + i) % (n - 1);
      const b = (r - i + n - 1) % (n - 1);
      pairs.push(orient(r, i) ? [a, b] : [b, a]);
    }
    rounds.push(pairs);
  }
  return rounds;
}

const mirror = (rounds: readonly Round[]): Round[] =>
  rounds.map((round) => round.map(([h, a]) => [a, h] as [number, number]));

const templateCache = new Map<number, Round[]>();

/**
 * A double round robin template for n teams (n even) whose home/away runs never exceed 2.
 * The Berger orientation is tried first under every rotation of the round order; if none passes
 * (it does for 20 teams), a deterministic search over orientations takes over.
 */
export function doubleRoundRobinTemplate(n: number): Round[] {
  if (n < 2 || n % 2 !== 0) throw new Error('Fixtures need an even number of teams');
  const cached = templateCache.get(n);
  if (cached) return cached;
  const berger = (r: number, i: number) => (i === 0 ? r % 2 === 1 : i % 2 === 1);
  const tryOrientation = (orient: (r: number, i: number) => boolean): Round[] | null => {
    const base = circleRounds(n, orient);
    for (let shift = 0; shift < base.length; shift++) {
      for (const reversed of [false, true]) {
        let first = [...base.slice(shift), ...base.slice(0, shift)];
        if (reversed) first = first.reverse();
        const all = [...first, ...mirror(first)];
        if (longestRun(all, n) <= 2) return all;
      }
    }
    return null;
  };
  let result = tryOrientation(berger);
  const rng = new Rng(n);
  for (let attempt = 0; !result && attempt < 2000; attempt++) {
    const flips = Array.from({ length: n - 1 }, () => Array.from({ length: n / 2 }, () => rng.chance(0.5)));
    result = tryOrientation((r, i) => flips[r]![i]!);
  }
  if (!result) throw new Error(`Could not build a balanced schedule for ${n} teams`);
  templateCache.set(n, result);
  return result;
}

/** The full season: 2 x (n - 1) matchdays, every pair twice, home and away swapped in the second half. */
export function generateFixtures(teamIds: readonly string[], seed: number): Fixture[] {
  const order = new Rng(seed).shuffle(teamIds);
  const template = doubleRoundRobinTemplate(order.length);
  const fixtures: Fixture[] = [];
  template.forEach((round, r) => {
    for (const [h, a] of round) fixtures.push({ matchday: r + 1, homeId: order[h]!, awayId: order[a]! });
  });
  return fixtures;
}
