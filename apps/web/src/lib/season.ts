/** Read-side helpers for season playback: names, live scores at a minute, tables and moment text. */
import type { FixtureView, KeyMomentView, MatchEventView, SeasonTeamView, SeasonView, StandingView } from '@deadline-day/protocol';
import { FULL_TIME } from '@deadline-day/protocol';
import { surname } from './auction';

export interface SeasonIndex {
  view: SeasonView;
  teams: Map<string, SeasonTeamView>;
  /** player ref -> display name */
  names: Map<string, string>;
  byMatchday: Map<number, FixtureView[]>;
  fixtures: Map<number, FixtureView>;
}

export function indexSeason(view: SeasonView): SeasonIndex {
  const names = new Map<string, string>();
  for (const t of view.teams) for (const p of t.players) names.set(p.ref, p.name);
  for (const e of view.extras) names.set(e.ref, e.name);
  const byMatchday = new Map<number, FixtureView[]>();
  for (const f of view.fixtures) {
    const list = byMatchday.get(f.matchday) ?? [];
    list.push(f);
    byMatchday.set(f.matchday, list);
  }
  return {
    view,
    teams: new Map(view.teams.map((t) => [t.id, t])),
    names,
    byMatchday,
    fixtures: new Map(view.fixtures.map((f) => [f.id, f])),
  };
}

/** Team page key that survives Run It Back: participant for auction teams, club for AI clubs. */
export const teamKey = (t: SeasonTeamView) => t.participantId ?? t.clubId ?? t.id;

export const isAuctionTeam = (t: SeasonTeamView | undefined) => !!t && t.kind !== 'ai';

/** Events that have happened by `minute` (all of them at full time). */
export function eventsBy(f: FixtureView, minute: number): MatchEventView[] {
  return minute >= FULL_TIME ? f.events : f.events.filter((e) => e.minute <= minute);
}

export function scoreAt(f: FixtureView, minute: number): { home: number; away: number } {
  if (minute >= FULL_TIME) return { home: f.homeGoals, away: f.awayGoals };
  let home = 0;
  let away = 0;
  for (const e of f.events) {
    if (e.type !== 'goal' || e.minute > minute) continue;
    if (e.teamId === f.homeId) home++;
    else away++;
  }
  return { home, away };
}

/** The table after `completed` matchdays; before kick-off, everyone on zero in pre-season strength order. */
export function tableAfter(index: SeasonIndex, completed: number): StandingView[] {
  if (completed > 0) return index.view.standings[completed - 1] ?? [];
  return index.view.teams.map((t, i) => ({
    teamId: t.id,
    played: 0,
    won: 0,
    drawn: 0,
    lost: 0,
    goalsFor: 0,
    goalsAgainst: 0,
    goalDifference: 0,
    points: 0,
    position: i + 1,
    form: '',
  }));
}

/** Places gained (positive) or lost since the previous matchday. */
export function movement(index: SeasonIndex, completed: number, teamId: string): number {
  if (completed < 2) return 0;
  const before = index.view.standings[completed - 2]?.find((r) => r.teamId === teamId)?.position;
  const now = index.view.standings[completed - 1]?.find((r) => r.teamId === teamId)?.position;
  return before && now ? before - now : 0;
}

export const ordinal = (n: number) => {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] ?? s[v] ?? s[0]}`;
};

/** One line for the Key Moments feed. `final` = the matchday has reached full time. */
export function momentText(index: SeasonIndex, m: KeyMomentView, final: boolean): string {
  const team = index.teams.get(m.teamId)?.name ?? 'A team';
  const other = m.otherTeamId ? (index.teams.get(m.otherTeamId)?.name ?? 'their rivals') : '';
  switch (m.kind) {
    case 'auction_derby':
      return `Auction derby: ${team} v ${other}`;
    case 'hat_trick': {
      const who = m.playerRef ? (index.names.get(m.playerRef) ?? 'A player') : 'A player';
      return final && (m.goals ?? 3) > 3 ? `${who} scores ${m.goals} for ${team} against ${other}` : `Hat-trick! ${who} for ${team} against ${other}`;
    }
    case 'big_win':
      return `${team} thrash ${other} ${m.goals}-${m.conceded}`;
    case 'upset':
      return `Upset: ${team} (${ordinal(m.teamPosition ?? 0)}) beat ${other} (${ordinal(m.otherPosition ?? 0)}) ${m.goals}-${m.conceded}`;
    case 'new_leader':
      return other ? `${team} go top, ahead of ${other}` : `${team} top the first table`;
  }
}

export const MOMENT_LABEL: Record<KeyMomentView['kind'], string> = {
  auction_derby: 'Derby',
  hat_trick: 'Hat-trick',
  big_win: 'Big win',
  upset: 'Upset',
  new_leader: 'New leader',
};

/** Scorers of one side, e.g. "Mbappé 12', 67'". */
export function scorerLines(index: SeasonIndex, f: FixtureView, teamId: string, minute: number): string[] {
  const goals = eventsBy(f, minute).filter((e) => e.type === 'goal' && e.teamId === teamId);
  const by = new Map<string, number[]>();
  for (const g of goals) by.set(g.playerRef, [...(by.get(g.playerRef) ?? []), g.minute]);
  return [...by].map(([ref, mins]) => `${surname(index.names.get(ref) ?? '?')} ${mins.map((x) => `${x}'`).join(', ')}`);
}

export const pct = (x: number) => (x >= 0.995 ? '100%' : x > 0 && x < 0.005 ? '<1%' : `${Math.round(x * 100)}%`);
