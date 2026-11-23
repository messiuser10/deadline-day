import { FULL_TIME, type FixtureView, type MatchClock } from '@deadline-day/protocol';
import { Card, CardTitle, cx, Modal, Pill } from '../../components/ui';
import { eventsBy, isAuctionTeam, scoreAt, scorerLines, type SeasonIndex } from '../../lib/season';
import { TeamName } from './parts';

/** Minute shown for a fixture on screen: live on the current matchday, full time before it. */
export function minuteFor(f: FixtureView, clock: MatchClock): number {
  if (f.matchday < clock.matchday) return FULL_TIME;
  if (f.matchday > clock.matchday) return -1;
  return clock.minute;
}

export function MatchdayResults({ index, clock, matchday, onOpen }: { index: SeasonIndex; clock: MatchClock; matchday: number; onOpen: (id: number) => void }) {
  const list = index.byMatchday.get(matchday) ?? [];
  const live = matchday === clock.matchday && !clock.fullTime;
  const status = matchday > clock.matchday || (live && clock.minute === 0) ? 'Kick-off soon' : live ? `${clock.minute}'` : 'Full time';
  // Auction teams first, then the rest in fixture order.
  const sorted = [...list].sort((a, b) => Number(involvesAuction(index, b)) - Number(involvesAuction(index, a)));
  return (
    <Card>
      <CardTitle action={<Pill tone={live ? 'green' : 'neutral'}>{status}</Pill>}>Matchday {matchday}</CardTitle>
      <ul className="grid gap-2 sm:grid-cols-2">
        {sorted.map((f) => (
          <li key={f.id}>
            <FixtureCard index={index} fixture={f} minute={minuteFor(f, clock)} onOpen={() => onOpen(f.id)} />
          </li>
        ))}
      </ul>
    </Card>
  );
}

function involvesAuction(index: SeasonIndex, f: FixtureView): boolean {
  return isAuctionTeam(index.teams.get(f.homeId)) || isAuctionTeam(index.teams.get(f.awayId));
}

function FixtureCard({ index, fixture: f, minute, onOpen }: { index: SeasonIndex; fixture: FixtureView; minute: number; onOpen: () => void }) {
  const home = index.teams.get(f.homeId);
  const away = index.teams.get(f.awayId);
  const started = minute >= 0;
  const score = started ? scoreAt(f, minute) : null;
  const highlight = isAuctionTeam(home) || isAuctionTeam(away);
  const scorers = (teamId: string) => (started ? scorerLines(index, f, teamId, minute) : []);
  const homeScorers = scorers(f.homeId);
  const awayScorers = scorers(f.awayId);
  const winner = minute >= FULL_TIME && score ? (score.home > score.away ? 'home' : score.away > score.home ? 'away' : null) : null;
  return (
    <button
      type="button"
      onClick={onOpen}
      className={cx(
        'flex w-full flex-col gap-1.5 rounded-xl px-3 py-2.5 text-left text-sm ring-1 transition hover:bg-white/5',
        highlight ? 'bg-gold-400/[0.07] ring-gold-400/30' : 'bg-night-950/40 ring-white/5',
      )}
      aria-label={`${home?.name} ${score ? score.home : ''} ${away?.name} ${score ? score.away : ''}. Open the match ticker`}
    >
      <div className="grid grid-cols-[1fr_auto] items-center gap-x-3 gap-y-1">
        <TeamName team={home} className={cx(winner === 'away' && 'opacity-70')} />
        <span className="font-display text-lg font-bold tabular-nums">{score ? score.home : '-'}</span>
        <TeamName team={away} className={cx(winner === 'home' && 'opacity-70')} />
        <span className="font-display text-lg font-bold tabular-nums">{score ? score.away : '-'}</span>
      </div>
      {(homeScorers.length > 0 || awayScorers.length > 0) && (
        <div className="grid grid-cols-2 gap-2 border-t border-white/5 pt-1.5 text-[0.7rem] leading-snug text-white/55">
          <span>{homeScorers.join(' · ')}</span>
          <span className="text-right">{awayScorers.join(' · ')}</span>
        </div>
      )}
    </button>
  );
}

const EVENT_LABEL = { goal: 'Goal', assist: 'Assist', yellow: 'Yellow card', red: 'Red card' } as const;

/** Minute-by-minute ticker from the stored events; a live match only shows what has happened so far. */
export function TickerModal({ index, fixtureId, clock, onClose }: { index: SeasonIndex; fixtureId: number | null; clock: MatchClock; onClose: () => void }) {
  const f = fixtureId !== null ? index.fixtures.get(fixtureId) : undefined;
  const minute = f ? minuteFor(f, clock) : -1;
  const home = f ? index.teams.get(f.homeId) : undefined;
  const away = f ? index.teams.get(f.awayId) : undefined;
  const score = f && minute >= 0 ? scoreAt(f, minute) : null;
  const events = f && minute >= 0 ? eventsBy(f, minute) : [];
  // Assists sit with their goal; show goals and cards as rows.
  const rows = events.filter((e) => e.type !== 'assist');
  const assistFor = (goalIdx: number) => {
    const goal = rows[goalIdx]!;
    return events.find((e) => e.type === 'assist' && e.minute === goal.minute && e.teamId === goal.teamId && e.playerRef !== goal.playerRef);
  };
  return (
    <Modal open={!!f} onClose={onClose} title={f ? `Matchday ${f.matchday}` : 'Match'}>
      {f && (
        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3 rounded-2xl bg-night-950/50 p-3">
            <TeamName team={home} size="md" tag={false} className="flex-col text-center" />
            <div className="text-center">
              <p className="font-display text-4xl font-bold tabular-nums">{score ? `${score.home}-${score.away}` : 'v'}</p>
              <p className="text-xs text-white/50">{minute < 0 ? 'Not started' : minute >= FULL_TIME ? 'Full time' : `${minute}'`}</p>
            </div>
            <TeamName team={away} size="md" tag={false} className="flex-col text-center" />
          </div>
          {minute < 0 ? (
            <p className="text-center text-sm text-white/55">This match has not kicked off yet.</p>
          ) : (
            <ol className="flex flex-col gap-1 text-sm">
              <li className="py-1 text-center text-xs uppercase tracking-wider text-white/40">Kick-off</li>
              {rows.map((e, i) => {
                const isHome = e.teamId === f.homeId;
                const assist = e.type === 'goal' ? assistFor(i) : undefined;
                const showHalf = e.minute > 45 && (i === 0 || rows[i - 1]!.minute <= 45);
                return (
                  <li key={`${e.minute}-${e.type}-${e.playerRef}`} className="contents">
                    {showHalf && <span className="block py-1 text-center text-xs uppercase tracking-wider text-white/40">Half time</span>}
                    <span className={cx('flex items-center gap-2 rounded-lg px-2 py-1.5', isHome ? 'flex-row' : 'flex-row-reverse text-right', e.type === 'goal' && 'bg-pitch-500/10')}>
                      <span className="w-9 shrink-0 font-display tabular-nums text-white/60">{e.minute}'</span>
                      <EventIcon type={e.type} />
                      <span className="min-w-0">
                        <span className="block truncate font-semibold">{index.names.get(e.playerRef) ?? 'Unknown'}</span>
                        <span className="block text-xs text-white/50">
                          {EVENT_LABEL[e.type]}
                          {assist && ` · assist ${index.names.get(assist.playerRef) ?? ''}`}
                        </span>
                      </span>
                    </span>
                  </li>
                );
              })}
              {minute < 46 && minute >= 0 && rows.length === 0 && <li className="py-2 text-center text-white/45">Nothing yet.</li>}
              {minute >= FULL_TIME && <li className="py-1 text-center text-xs uppercase tracking-wider text-white/40">Full time</li>}
            </ol>
          )}
        </div>
      )}
    </Modal>
  );
}

function EventIcon({ type }: { type: FixtureView['events'][number]['type'] }) {
  if (type === 'goal') {
    return (
      <svg viewBox="0 0 24 24" className="size-4 shrink-0 text-pitch-400" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
        <circle cx="12" cy="12" r="9" />
        <path d="M12 7l4 3-1.5 4.5h-5L8 10l4-3Z" fill="currentColor" />
      </svg>
    );
  }
  return <span aria-hidden="true" className={cx('h-4 w-3 shrink-0 rounded-[2px]', type === 'red' ? 'bg-red-500' : 'bg-gold-400')} />;
}
