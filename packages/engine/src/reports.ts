/**
 * Team season reports and head to head (section 10, team pages and results). Pure functions over a
 * season's fixtures and per-matchday tables, so they work on a fresh simulation or on stored rows.
 */

export interface ReportFixture {
  id: number | string;
  matchday: number;
  homeId: string;
  awayId: string;
  homeGoals: number;
  awayGoals: number;
}

export interface ReportStanding {
  teamId: string;
  position: number;
}

export type FormResult = 'W' | 'D' | 'L';

export interface Split {
  played: number;
  won: number;
  drawn: number;
  lost: number;
  goalsFor: number;
  goalsAgainst: number;
  points: number;
}

export interface BiggestWin {
  fixtureId: ReportFixture['id'];
  matchday: number;
  opponentId: string;
  home: boolean;
  goalsFor: number;
  goalsAgainst: number;
}

export interface Run {
  length: number;
  /** First and last matchday of the run. */
  from: number;
  to: number;
}

export interface TeamReport {
  teamId: string;
  /** League position after each matchday (index 0 = after matchday 1). */
  positions: number[];
  /** Result on each matchday, in matchday order. */
  results: FormResult[];
  home: Split;
  away: Split;
  biggestWin: BiggestWin | null;
  longestUnbeaten: Run | null;
}

const emptySplit = (): Split => ({ played: 0, won: 0, drawn: 0, lost: 0, goalsFor: 0, goalsAgainst: 0, points: 0 });

function add(split: Split, gf: number, ga: number, points: { win: number; draw: number; loss: number }): FormResult {
  split.played++;
  split.goalsFor += gf;
  split.goalsAgainst += ga;
  if (gf > ga) {
    split.won++;
    split.points += points.win;
    return 'W';
  }
  if (gf < ga) {
    split.lost++;
    split.points += points.loss;
    return 'L';
  }
  split.drawn++;
  split.points += points.draw;
  return 'D';
}

/** Form timeline, home and away splits, biggest win (largest margin, then most goals, then earliest) and longest unbeaten run. */
export function teamReport(
  teamId: string,
  fixtures: readonly ReportFixture[],
  standings: readonly (readonly ReportStanding[])[],
  points = { win: 3, draw: 1, loss: 0 },
): TeamReport {
  const games = fixtures.filter((f) => f.homeId === teamId || f.awayId === teamId).sort((a, b) => a.matchday - b.matchday);
  const home = emptySplit();
  const away = emptySplit();
  const results: FormResult[] = [];
  let biggestWin = null as BiggestWin | null;
  let best = null as Run | null;
  let current = null as Run | null;

  for (const f of games) {
    const isHome = f.homeId === teamId;
    const gf = isHome ? f.homeGoals : f.awayGoals;
    const ga = isHome ? f.awayGoals : f.homeGoals;
    const r = add(isHome ? home : away, gf, ga, points);
    results.push(r);

    if (r === 'W') {
      const margin = gf - ga;
      const bestMargin = biggestWin ? biggestWin.goalsFor - biggestWin.goalsAgainst : -1;
      if (!biggestWin || margin > bestMargin || (margin === bestMargin && gf > biggestWin.goalsFor)) {
        biggestWin = { fixtureId: f.id, matchday: f.matchday, opponentId: isHome ? f.awayId : f.homeId, home: isHome, goalsFor: gf, goalsAgainst: ga };
      }
    }

    if (r === 'L') {
      current = null;
    } else {
      current = current === null ? { length: 1, from: f.matchday, to: f.matchday } : { length: current.length + 1, from: current.from, to: f.matchday };
      if (!best || current.length > best.length) best = current;
    }
  }

  return {
    teamId,
    positions: standings.map((table) => table.find((r) => r.teamId === teamId)?.position ?? 0),
    results,
    home,
    away,
    biggestWin,
    longestUnbeaten: best,
  };
}

export interface HeadToHeadRecord {
  aId: string;
  bId: string;
  played: number;
  aWins: number;
  draws: number;
  bWins: number;
  aGoals: number;
  bGoals: number;
}

/**
 * Head to head between two sides over any set of fixtures. `sideOf` maps a fixture's team id to 'a', 'b'
 * or null, so the same two teams can be followed across seasons where their ids differ.
 */
export function headToHead(aId: string, bId: string, fixtures: readonly ReportFixture[], sideOf: (teamId: string) => 'a' | 'b' | null = (id) => (id === aId ? 'a' : id === bId ? 'b' : null)): HeadToHeadRecord {
  const rec: HeadToHeadRecord = { aId, bId, played: 0, aWins: 0, draws: 0, bWins: 0, aGoals: 0, bGoals: 0 };
  for (const f of fixtures) {
    const h = sideOf(f.homeId);
    const w = sideOf(f.awayId);
    if (!h || !w || h === w) continue;
    const aGoals = h === 'a' ? f.homeGoals : f.awayGoals;
    const bGoals = h === 'a' ? f.awayGoals : f.homeGoals;
    rec.played++;
    rec.aGoals += aGoals;
    rec.bGoals += bGoals;
    if (aGoals > bGoals) rec.aWins++;
    else if (aGoals < bGoals) rec.bWins++;
    else rec.draws++;
  }
  return rec;
}
