/**
 * Key Moments for season playback (section 10): hat-tricks, 4-goal margins, upsets (a team at least
 * 6 places lower beating a top-5 side), new league leaders and fixtures between two auction teams.
 */
import type { MatchEvent } from './match';
import type { StandingRow, TeamKind } from './season';

export type KeyMomentKind = 'auction_derby' | 'hat_trick' | 'big_win' | 'upset' | 'new_leader';

/** Minute used for moments that are only known at full time. */
export const FULL_TIME_MINUTE = 95;
export const BIG_WIN_MARGIN = 4;
export const UPSET_PLACES = 6;
export const UPSET_TOP = 5;

export interface KeyMoment {
  matchday: number;
  /** Match minute it happened: 0 for kick-off, FULL_TIME_MINUTE for results. */
  minute: number;
  kind: KeyMomentKind;
  /** Index into the input fixtures, or null for table moments. */
  fixtureIndex: number | null;
  /** The scorer's team, the winner, the new leader, or the home side of a derby. */
  teamId: string;
  otherTeamId: string | null;
  playerRef: string | null;
  /** Hat-tricks: the player's goals in the match. Wins: the winner's goals. */
  goals: number | null;
  /** Wins: the loser's goals. */
  conceded: number | null;
  /** Upsets: table positions before the matchday (pre-season strength rank on matchday 1). */
  teamPosition: number | null;
  otherPosition: number | null;
}

export interface KeyMomentFixture {
  matchday: number;
  homeId: string;
  awayId: string;
  homeGoals: number;
  awayGoals: number;
  events: readonly MatchEvent[];
}

export interface KeyMomentInput {
  fixtures: readonly KeyMomentFixture[];
  /** standings[i] is the table after matchday i + 1. */
  standings: readonly (readonly StandingRow[])[];
  kinds: Readonly<Record<string, TeamKind>>;
  /** Pre-season strength rank (1 = strongest), the "table" before matchday 1. */
  preseasonRank: Readonly<Record<string, number>>;
}

const KIND_ORDER: Record<KeyMomentKind, number> = { auction_derby: 0, hat_trick: 1, big_win: 2, upset: 3, new_leader: 4 };

const blank = (m: Pick<KeyMoment, 'matchday' | 'minute' | 'kind' | 'teamId'>): KeyMoment => ({
  fixtureIndex: null,
  otherTeamId: null,
  playerRef: null,
  goals: null,
  conceded: null,
  teamPosition: null,
  otherPosition: null,
  ...m,
});

export function findKeyMoments(input: KeyMomentInput): KeyMoment[] {
  const out: KeyMoment[] = [];
  const byMatchday = new Map<number, number[]>();
  input.fixtures.forEach((f, i) => {
    const list = byMatchday.get(f.matchday) ?? [];
    list.push(i);
    byMatchday.set(f.matchday, list);
  });
  const matchdays = [...byMatchday.keys()].sort((a, b) => a - b);
  const isAuction = (id: string) => (input.kinds[id] ?? 'ai') !== 'ai';

  for (const md of matchdays) {
    const before = md === 1 ? null : input.standings[md - 2];
    const positionBefore = (id: string): number =>
      before ? (before.find((r) => r.teamId === id)?.position ?? 99) : (input.preseasonRank[id] ?? 99);

    for (const i of byMatchday.get(md)!) {
      const f = input.fixtures[i]!;
      if (isAuction(f.homeId) && isAuction(f.awayId)) {
        out.push({ ...blank({ matchday: md, minute: 0, kind: 'auction_derby', teamId: f.homeId }), fixtureIndex: i, otherTeamId: f.awayId });
      }

      const goals = [...f.events].filter((e) => e.type === 'goal').sort((a, b) => a.minute - b.minute);
      const tally = new Map<string, MatchEvent[]>();
      for (const g of goals) tally.set(g.playerRef, [...(tally.get(g.playerRef) ?? []), g]);
      for (const [ref, list] of tally) {
        if (list.length < 3) continue;
        const third = list[2]!;
        out.push({
          ...blank({ matchday: md, minute: third.minute, kind: 'hat_trick', teamId: third.teamId }),
          fixtureIndex: i,
          otherTeamId: third.teamId === f.homeId ? f.awayId : f.homeId,
          playerRef: ref,
          goals: list.length,
        });
      }

      if (f.homeGoals === f.awayGoals) continue;
      const homeWon = f.homeGoals > f.awayGoals;
      const winner = homeWon ? f.homeId : f.awayId;
      const loser = homeWon ? f.awayId : f.homeId;
      const scored = Math.max(f.homeGoals, f.awayGoals);
      const conceded = Math.min(f.homeGoals, f.awayGoals);
      const result = { fixtureIndex: i, otherTeamId: loser, goals: scored, conceded };
      if (scored - conceded >= BIG_WIN_MARGIN) {
        out.push({ ...blank({ matchday: md, minute: FULL_TIME_MINUTE, kind: 'big_win', teamId: winner }), ...result });
      }
      const wPos = positionBefore(winner);
      const lPos = positionBefore(loser);
      if (lPos <= UPSET_TOP && wPos - lPos >= UPSET_PLACES) {
        out.push({ ...blank({ matchday: md, minute: FULL_TIME_MINUTE, kind: 'upset', teamId: winner }), ...result, teamPosition: wPos, otherPosition: lPos });
      }
    }

    const leader = input.standings[md - 1]?.[0]?.teamId;
    const previous = before?.[0]?.teamId ?? null;
    if (leader && leader !== previous) {
      out.push({ ...blank({ matchday: md, minute: FULL_TIME_MINUTE, kind: 'new_leader', teamId: leader }), otherTeamId: previous });
    }
  }

  return out.sort((a, b) => a.matchday - b.matchday || a.minute - b.minute || KIND_ORDER[a.kind] - KIND_ORDER[b.kind]);
}
